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

        // Track in scrape map
        if (!scrapeMap[username]) {
          scrapeMap[username] = {
            commentCount: 0,
            posts: [],
            lastCommentAt: c.timestamp,
            totalLikes: 0,
            likeEntries: 0,
          };
        }
        const entry = scrapeMap[username];
        if (!entry.posts.includes(item.id)) {
          entry.posts.push(item.id);
          entry.commentCount += 1;
        }
        if (c.timestamp > entry.lastCommentAt) {
          entry.lastCommentAt = c.timestamp;
        }
        entry.totalLikes += likeCount;
        entry.likeEntries += 1;

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

  for (const [username, scrapeEntry] of Object.entries(scrapeMap)) {
    const existing = mergedMap[username];
    if (existing) {
      // Merge: add new post IDs, update counts
      const existingPosts = existing.posts || [];
      const newPosts = scrapeEntry.posts.filter(p => !existingPosts.includes(p));
      const allPosts = [...existingPosts, ...newPosts];

      mergedMap[username] = {
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
      // New commenter
      mergedMap[username] = {
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

  // 5. Build warm intros list (2+ comments, sorted by commentCount desc)
  const warmIntros = Object.entries(mergedMap)
    .filter(([, e]) => e.commentCount >= 2)
    .sort((a, b) => b[1].commentCount - a[1].commentCount)
    .map(([username, e]) => ({
      username,
      commentCount: e.commentCount,
      lastCommentAt: e.lastCommentAt,
      tier: e.tier,
    }));

  // 6. Build recent comments list (last 20, newest first)
  const recentComments = allComments
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 20);

  // 7. Write full results to Firebase
  const fullPayload = {
    fetchedAt: now,
    postsScanned: items.length,
    totalComments,
    uniqueCommenters: Object.keys(mergedMap).length,
    commenterMap: mergedMap,
    warmIntros,
    recentComments,
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

  console.log(`\n  📈 Summary:`);
  console.log(`    Posts scanned: ${items.length}`);
  console.log(`    Total comments: ${totalComments}`);
  console.log(`    Unique commenters (all-time merged): ${Object.keys(mergedMap).length}`);
  console.log(`    Superfans (3+ posts): ${superfans.length}`);
  console.log(`    Repeat commenters (2 posts): ${repeats.length}`);
  console.log(`    API calls used: ${apiCalls} of 200/hr limit`);

  console.log('\n✅ IG Comments scrape complete\n');
}

main().catch((err) => {
  console.error('\n❌ IG Comments scrape failed:', err);
  process.exit(1);
});
