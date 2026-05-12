/**
 * IG Comments Scraper — Meta Graph API → Firebase
 *
 * Pulls comments from recent Instagram posts and builds a commenter
 * frequency map to identify warm-intro candidates (repeat commenters),
 * superfans, and high-engagement commenters.
 *
 * Merges with existing commenter data in Firebase so history accumulates
 * across runs. Writes full results to analytics/latest/igComments and a
 * slim daily snapshot to analytics/history/{date}/igComments.
 *
 * API budget: 1 (media list) + 25 (comments per post) = 26 calls.
 *
 * Env vars: FB_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID,
 *           FIREBASE_DB_URL, FIREBASE_DB_SECRET
 */

const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';

const GRAPH_API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const MEDIA_LIMIT = 25;
const COMMENTS_LIMIT = 50;
const HIGH_FOLLOWER_THRESHOLD = 15000;
const MAX_PROFILE_LOOKUPS = 20; // cap API calls for follower count checks

// Firebase keys can't contain . $ # [ ] /
function sanitizeKey(str) {
  return str.replace(/[.$#\[\]/]/g, '_');
}

if (!FB_PAGE_ACCESS_TOKEN) {
  console.error('Missing FB_PAGE_ACCESS_TOKEN environment variable');
  process.exit(1);
}
if (!IG_BUSINESS_ACCOUNT_ID) {
  console.error('Missing IG_BUSINESS_ACCOUNT_ID environment variable');
  process.exit(1);
}

// ─── Firebase helpers ───────────────────────────────────────────

async function patchFirebase(path, data) {
  const auth = FIREBASE_DB_SECRET ? `?auth=${FIREBASE_DB_SECRET}` : '';
  const url = `${FIREBASE_DB_URL}/${path}.json${auth}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase PATCH ${path} failed: ${res.status} ${text}`);
  }
}

async function readFirebase(path) {
  const auth = FIREBASE_DB_SECRET ? `?auth=${FIREBASE_DB_SECRET}` : '';
  const url = `${FIREBASE_DB_URL}/${path}.json${auth}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ─── Graph API helper ──────────────────────────────────────────

async function graphGet(path, params = {}) {
  const qs = new URLSearchParams({
    ...params,
    access_token: FB_PAGE_ACCESS_TOKEN,
  }).toString();
  const url = `${GRAPH_BASE}/${path}?${qs}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`Graph API error: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

// ─── Tier classification ────────────────────────────────────────

function classifyTier(commentCount) {
  if (commentCount >= 3) return 'superfan';
  if (commentCount >= 2) return 'repeat';
  return 'new';
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n💬 IG Comments scrape starting...');
  console.log(`  IG Business Account: ${IG_BUSINESS_ACCOUNT_ID}`);

  // 1. Pull recent media list
  const mediaList = await graphGet(`${IG_BUSINESS_ACCOUNT_ID}/media`, {
    fields: 'id,caption,timestamp',
    limit: String(MEDIA_LIMIT),
  });

  const items = mediaList.data || [];
  console.log(`  Fetched ${items.length} media items`);

  if (!items.length) {
    console.log('  No media found — exiting');
    return;
  }

  // 2. Read existing commenter map from Firebase for merging
  console.log('  Reading existing commenter map from Firebase...');
  const existingMap = (await readFirebase('analytics/latest/igComments/commenterMap')) || {};
  const existingCount = Object.keys(existingMap).length;
  console.log(`  Found ${existingCount} existing commenters to merge with`);

  // 3. Fetch comments for each post
  let apiCalls = 1; // media list call
  let totalComments = 0;
  const allComments = []; // for recentComments list
  const scrapeMap = {}; // username → { commentCount, posts, lastCommentAt, totalLikes }
  const userIdMap = {}; // username → IG user ID (from `from` field) for profile lookups

  for (const item of items) {
    try {
      const result = await graphGet(`${item.id}/comments`, {
        fields: 'id,text,timestamp,from,username,like_count',
        limit: String(COMMENTS_LIMIT),
      });
      apiCalls += 1;

      const comments = result.data || [];
      const captionPreview = (item.caption || '').slice(0, 30).replace(/\n/g, ' ');
      console.log(`  ✓ ${item.id} — ${comments.length} comments — "${captionPreview}"`);

      for (const c of comments) {
        const username = c.username || c.from?.username;
        if (!username) continue;

        totalComments += 1;
        const likeCount = c.like_count || 0;

        // Track in scrape map (sanitize key for Firebase compatibility)
        const key = sanitizeKey(username);
        if (!scrapeMap[key]) {
          scrapeMap[key] = {
            commentCount: 0,
            posts: [],
            lastCommentAt: c.timestamp,
            totalLikes: 0,
            likeEntries: 0,
          };
        }
        const entry = scrapeMap[key];
        if (!entry.posts.includes(item.id)) {
          entry.posts.push(item.id);
          entry.commentCount += 1;
        }
        if (c.timestamp > entry.lastCommentAt) {
          entry.lastCommentAt = c.timestamp;
        }
        entry.totalLikes += likeCount;
        entry.likeEntries += 1;

        // Track user ID for high-follower profile lookups
        const fromId = c.from?.id;
        if (fromId && !userIdMap[key]) {
          userIdMap[key] = fromId;
        }

        // Collect for recentComments
        allComments.push({
          username,
          text: (c.text || '').slice(0, 300),
          mediaId: item.id,
          timestamp: c.timestamp,
          likeCount,
        });
      }
    } catch (err) {
      apiCalls += 1;
      console.warn(`  ✗ ${item.id}: ${err.message}`);
    }
  }

  const uniqueCommenters = Object.keys(scrapeMap).length;
  console.log(`\n  Comments pulled: ${totalComments} total, ${uniqueCommenters} unique commenters (${apiCalls} API calls used)`);

  // 4. Merge with existing commenter map
  const now = new Date().toISOString();
  const mergedMap = { ...existingMap };

  for (const [key, scrapeEntry] of Object.entries(scrapeMap)) {
    const existing = mergedMap[key];
    if (existing) {
      const existingPosts = existing.posts || [];
      const newPosts = scrapeEntry.posts.filter(p => !existingPosts.includes(p));
      const allPosts = [...existingPosts, ...newPosts];

      mergedMap[key] = {
        username: existing.username || key,
        commentCount: (existing.commentCount || 0) + newPosts.length,
        posts: allPosts,
        lastCommentAt: scrapeEntry.lastCommentAt > (existing.lastCommentAt || '')
          ? scrapeEntry.lastCommentAt
          : existing.lastCommentAt,
        firstSeenAt: existing.firstSeenAt || now,
        avgLikeCount: scrapeEntry.likeEntries > 0
          ? +(scrapeEntry.totalLikes / scrapeEntry.likeEntries).toFixed(1)
          : (existing.avgLikeCount || 0),
        tier: classifyTier((existing.commentCount || 0) + newPosts.length),
      };
    } else {
      mergedMap[key] = {
        username: key,
        commentCount: scrapeEntry.commentCount,
        posts: scrapeEntry.posts,
        lastCommentAt: scrapeEntry.lastCommentAt,
        firstSeenAt: now,
        avgLikeCount: scrapeEntry.likeEntries > 0
          ? +(scrapeEntry.totalLikes / scrapeEntry.likeEntries).toFixed(1)
          : 0,
        tier: classifyTier(scrapeEntry.commentCount),
      };
    }
  }

  // Recalculate tiers for all entries (in case thresholds changed)
  for (const entry of Object.values(mergedMap)) {
    entry.tier = classifyTier(entry.commentCount);
  }

  // 4b. High-follower profile lookups
  // Check commenter follower counts via Graph API — only works for
  // business/creator accounts, personal accounts silently fail.
  // Prioritize repeat commenters (most likely to be relevant contacts).
  console.log('\n  🔍 Checking commenter follower counts...');
  const existingHighProfile = (await readFirebase('analytics/latest/igComments/highProfileCommenters')) || {};

  // Sort by comment count desc, then only look up new/unchecked users
  const lookupCandidates = Object.entries(userIdMap)
    .filter(([key]) => !existingHighProfile[key]?.checkedAt) // skip already-checked
    .sort((a, b) => (scrapeMap[b[0]]?.commentCount || 0) - (scrapeMap[a[0]]?.commentCount || 0))
    .slice(0, MAX_PROFILE_LOOKUPS);

  let highProfileCount = 0;
  const highProfileMap = { ...existingHighProfile };

  for (const [key, userId] of lookupCandidates) {
    try {
      const profile = await graphGet(userId, {
        fields: 'username,followers_count,media_count,biography',
      });
      apiCalls += 1;
      const fc = profile.followers_count || 0;
      highProfileMap[key] = {
        username: profile.username || key,
        followersCount: fc,
        mediaCount: profile.media_count || 0,
        bio: (profile.biography || '').slice(0, 200),
        isHighProfile: fc >= HIGH_FOLLOWER_THRESHOLD,
        checkedAt: now,
        commentCount: mergedMap[key]?.commentCount || 0,
        tier: mergedMap[key]?.tier || 'new',
      };
      if (fc >= HIGH_FOLLOWER_THRESHOLD) {
        highProfileCount += 1;
        console.log(`  ⭐ ${profile.username}: ${fc.toLocaleString()} followers — HIGH PROFILE`);
      }
    } catch {
      // Silently skip — likely a personal (non-business) account
      highProfileMap[key] = {
        username: key,
        followersCount: 0,
        isHighProfile: false,
        checkedAt: now,
        note: 'personal account (not queryable)',
      };
    }
  }

  // Count total high-profile across all time
  const allHighProfile = Object.values(highProfileMap).filter(h => h.isHighProfile);
  console.log(`  Checked ${lookupCandidates.length} profiles, ${highProfileCount} new high-profile (${allHighProfile.length} total all-time, ${apiCalls} API calls)`);

  // 5. Build warm intros list (2+ comments, sorted by commentCount desc)
  const warmIntros = Object.entries(mergedMap)
    .filter(([, e]) => e.commentCount >= 2)
    .sort((a, b) => b[1].commentCount - a[1].commentCount)
    .map(([key, e]) => ({
      username: e.username || key,
      commentCount: e.commentCount,
      lastCommentAt: e.lastCommentAt,
      tier: e.tier,
      followersCount: highProfileMap[key]?.followersCount || null,
      isHighProfile: highProfileMap[key]?.isHighProfile || false,
    }));

  // 6. Build recent comments list (last 20, newest first)
  const recentComments = allComments
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 20);

  // 6b. Build high-profile contacts list (15k+ followers)
  const highProfileContacts = allHighProfile
    .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0))
    .map(h => ({
      username: h.username,
      followersCount: h.followersCount,
      mediaCount: h.mediaCount || 0,
      bio: h.bio || '',
      commentCount: mergedMap[sanitizeKey(h.username)]?.commentCount || h.commentCount || 0,
      tier: mergedMap[sanitizeKey(h.username)]?.tier || h.tier || 'new',
      checkedAt: h.checkedAt,
    }));

  // 7. Write full results to Firebase
  const fullPayload = {
    fetchedAt: now,
    postsScanned: items.length,
    totalComments,
    uniqueCommenters: Object.keys(mergedMap).length,
    commenterMap: mergedMap,
    warmIntros,
    recentComments,
    highProfileCommenters: highProfileMap,
    highProfileContacts,
  };

  await patchFirebase('analytics/latest/igComments', fullPayload);
  console.log(`  ✓ Wrote ${Object.keys(mergedMap).length} commenters to analytics/latest/igComments`);

  // 8. Write slim daily snapshot (no full commenterMap)
  const dateKey = now.slice(0, 10);
  const dailySnapshot = {
    fetchedAt: now,
    postsScanned: items.length,
    totalComments,
    uniqueCommenters: Object.keys(mergedMap).length,
    warmIntros,
    highProfileContacts,
  };

  await patchFirebase(`analytics/history/${dateKey}/igComments`, dailySnapshot);
  console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/igComments`);

  // 9. Print warm-intro summary table
  const superfans = warmIntros.filter(w => w.tier === 'superfan');
  const repeats = warmIntros.filter(w => w.tier === 'repeat');

  console.log('\n  🔥 Warm-Intro Candidates:');
  console.log(`  ───────────────────────────────────────────────`);
  console.log(`  ${'Username'.padEnd(25)} ${'Comments'.padEnd(10)} ${'Tier'.padEnd(10)} Last Comment`);
  console.log(`  ───────────────────────────────────────────────`);

  if (warmIntros.length === 0) {
    console.log('  (none yet — need more data)');
  }
  for (const w of warmIntros) {
    const lastDate = w.lastCommentAt ? w.lastCommentAt.slice(0, 10) : 'unknown';
    console.log(`  ${w.username.padEnd(25)} ${String(w.commentCount).padEnd(10)} ${w.tier.padEnd(10)} ${lastDate}`);
  }

  // Print high-profile contacts
  if (highProfileContacts.length) {
    console.log('\n  ⭐ High-Profile Commenters (15k+ followers):');
    console.log(`  ───────────────────────────────────────────────`);
    console.log(`  ${'Username'.padEnd(25)} ${'Followers'.padEnd(12)} ${'Comments'.padEnd(10)} Bio`);
    console.log(`  ───────────────────────────────────────────────`);
    for (const h of highProfileContacts) {
      console.log(`  ${h.username.padEnd(25)} ${String(h.followersCount.toLocaleString()).padEnd(12)} ${String(h.commentCount).padEnd(10)} ${(h.bio || '').slice(0, 40)}`);
    }
  }

  console.log(`\n  📈 Summary:`);
  console.log(`    Posts scanned: ${items.length}`);
  console.log(`    Total comments: ${totalComments}`);
  console.log(`    Unique commenters (all-time merged): ${Object.keys(mergedMap).length}`);
  console.log(`    Superfans (3+ posts): ${superfans.length}`);
  console.log(`    Repeat commenters (2 posts): ${repeats.length}`);
  console.log(`    High-profile contacts (15k+): ${highProfileContacts.length}`);
  console.log(`    API calls used: ${apiCalls} of 200/hr limit`);

  console.log('\n✅ IG Comments scrape complete\n');
}

main().catch((err) => {
  console.error('\n❌ IG Comments scrape failed:', err);
  process.exit(1);
});
