/**
 * Creator Tracking — Meta Graph API "Business Discovery" → Firebase
 *
 * Tracks PUBLIC Instagram creators Reid wants to learn from (e.g. duer.wav).
 * Business Discovery returns a public Business/Creator account's follower
 * count + recent media with like/comment counts, FREE, using Reid's own
 * token — no Apify required.
 *
 * Caveat: Business Discovery only works on Business/Creator accounts (not
 * personal), and does NOT expose view counts/insights for other people's
 * posts — only public likes + comments. That's still enough to see what
 * formats/topics are landing for them.
 *
 * Writes:
 *   analytics/latest/creatorTracking            — current snapshot per creator
 *   analytics/history/<date>/creatorTracking    — {username: {followers, mediaCount}} for growth trend
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

// Creators to track. Add/remove usernames here.
const TRACKED_CREATORS = ['duer.wav'];

const MEDIA_LIMIT = 12;

if (!FB_PAGE_ACCESS_TOKEN || !IG_BUSINESS_ACCOUNT_ID) {
  console.error('Missing FB_PAGE_ACCESS_TOKEN / IG_BUSINESS_ACCOUNT_ID');
  process.exit(1);
}

async function graphGet(path, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: FB_PAGE_ACCESS_TOKEN }).toString();
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.message} (code ${json.error.code})`);
  return json;
}

async function writeFirebase(path, data) {
  const auth = FIREBASE_DB_SECRET ? `?auth=${FIREBASE_DB_SECRET}` : '';
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json${auth}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} failed: ${res.status} ${await res.text()}`);
}

async function readFirebase(path) {
  const auth = FIREBASE_DB_SECRET ? `?auth=${FIREBASE_DB_SECRET}` : '';
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json${auth}`);
  if (!res.ok) return null;
  return res.json();
}

// Firebase RTDB keys can't contain . # $ [ ] / — usernames like "duer.wav"
// must be sanitized for use as a key. The real username stays in the value.
function keyOf(username) {
  return username.replace(/[.#$/[\]]/g, '_');
}

function detectFormat(m) {
  if (m.media_product_type === 'REELS' || m.media_type === 'VIDEO') return 'Reel';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'Carousel';
  return 'Image';
}

async function fetchCreator(username) {
  // Business Discovery: nest the target's fields inside our own node query.
  const fields = `business_discovery.username(${username}){`
    + `followers_count,media_count,name,biography,profile_picture_url,`
    + `media.limit(${MEDIA_LIMIT}){id,caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink}`
    + `}`;
  const json = await graphGet(IG_BUSINESS_ACCOUNT_ID, { fields });
  const bd = json.business_discovery;
  if (!bd) throw new Error('no business_discovery payload');

  const media = (bd.media?.data || []).map(m => ({
    id: m.id,
    caption: (m.caption || '').slice(0, 200),
    format: detectFormat(m),
    likes: m.like_count || 0,
    comments: m.comments_count || 0,
    engagement: (m.like_count || 0) + (m.comments_count || 0),
    timestamp: m.timestamp,
    permalink: m.permalink,
  }));

  // Sort posts by engagement so the UI can show "what's working" first.
  const byEng = [...media].sort((a, b) => b.engagement - a.engagement);
  const followers = bd.followers_count || 0;
  const avgEng = media.length ? Math.round(media.reduce((s, x) => s + x.engagement, 0) / media.length) : 0;
  // Engagement rate vs followers (likes+comments per post / followers).
  const engRate = followers > 0 && media.length
    ? +(media.reduce((s, x) => s + x.engagement, 0) / media.length / followers * 100).toFixed(2)
    : 0;

  return {
    username,
    name: bd.name || username,
    biography: (bd.biography || '').slice(0, 300),
    profilePic: bd.profile_picture_url || null,
    followers,
    mediaCount: bd.media_count || 0,
    avgEngagement: avgEng,
    engRatePct: engRate,
    topPost: byEng[0] || null,
    recentPosts: media,
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log('\n👀 Creator tracking (Business Discovery) starting...');
  const dateKey = new Date().toISOString().slice(0, 10);
  const prev = await readFirebase('analytics/latest/creatorTracking');

  const creators = {};
  const historyTrend = {};
  for (const username of TRACKED_CREATORS) {
    const key = keyOf(username);
    try {
      const c = await fetchCreator(username);
      // Compute deltas vs last write if available.
      const prevC = prev?.creators?.[key];
      c.followerDelta = prevC ? (c.followers - prevC.followers) : null;
      creators[key] = c;
      historyTrend[key] = { followers: c.followers, mediaCount: c.mediaCount, avgEngagement: c.avgEngagement };
      const dStr = c.followerDelta != null ? ` (${c.followerDelta >= 0 ? '+' : ''}${c.followerDelta} since last)` : '';
      console.log(`  ✓ ${username}: ${c.followers} followers${dStr}, ${c.recentPosts.length} posts, ${c.engRatePct}% eng rate`);
      if (c.topPost) console.log(`     top post (${c.topPost.engagement} eng, ${c.topPost.format}): "${c.topPost.caption.slice(0, 50)}"`);
    } catch (err) {
      console.warn(`  ✗ ${username}: ${err.message}`);
      // Preserve last-known so a transient error doesn't blank the card.
      if (prev?.creators?.[key]) creators[key] = { ...prev.creators[key], _stale: true };
    }
  }

  await writeFirebase('analytics/latest/creatorTracking', {
    creators,
    trackedCount: Object.keys(creators).length,
    fetchedAt: new Date().toISOString(),
  });
  console.log('  ✓ Wrote analytics/latest/creatorTracking');

  if (Object.keys(historyTrend).length) {
    await writeFirebase(`analytics/history/${dateKey}/creatorTracking`, historyTrend);
    console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/creatorTracking`);
  }

  console.log('\n✅ Creator tracking complete\n');
}

main().catch(err => { console.error('❌ Creator tracking failed:', err); process.exit(1); });
