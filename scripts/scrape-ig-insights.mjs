/**
 * IG Insights Scraper — Meta Graph API → Firebase
 *
 * Pulls per-post Insights data that Apify's public scraper can't see:
 * skip_rate, saved, shares, reach, follows-from-post, profile_visits, etc.
 *
 * Runs daily after scrape-daily.mjs in the same workflow. Writes to
 * Firebase under analytics/latest/igInsights/{mediaId} so it merges
 * cleanly with existing igPosts data without overwriting.
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

// How many recent media items to pull insights for. ~25 keeps us
// well under the 200 calls/hour BUC limit even with retries.
const MEDIA_LIMIT = 25;

if (!FB_PAGE_ACCESS_TOKEN) {
  console.error('Missing FB_PAGE_ACCESS_TOKEN environment variable');
  process.exit(1);
}
if (!IG_BUSINESS_ACCOUNT_ID) {
  console.error('Missing IG_BUSINESS_ACCOUNT_ID environment variable');
  process.exit(1);
}

// ─── Metric sets per media type ─────────────────────────────────
// Reels and feed videos get the reel-specific metrics; images and
// carousels get the subset that works on static media. Mixing the
// wrong metric with the wrong media type returns an error.

const REEL_METRICS = [
  'reach',
  'saved',
  'shares',
  'reels_skip_rate',
  'follows',
  'profile_visits',
  'ig_reels_avg_watch_time',
  'plays',
  'total_interactions',
  'comments',
  'likes',
  'views',
];

const STATIC_METRICS = [
  'reach',
  'saved',
  'shares',
  'follows',
  'profile_visits',
  'total_interactions',
  'comments',
  'likes',
  'views',
];

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

// ─── Graph API helpers ──────────────────────────────────────────

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

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 IG Insights scrape starting...');
  console.log(`  IG Business Account: ${IG_BUSINESS_ACCOUNT_ID}`);

  // 1. Pull recent media list
  const mediaList = await graphGet(`${IG_BUSINESS_ACCOUNT_ID}/media`, {
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink',
    limit: String(MEDIA_LIMIT),
  });

  const items = mediaList.data || [];
  console.log(`  Fetched ${items.length} media items`);

  if (!items.length) {
    console.log('  No media found — exiting');
    return;
  }

  // 2. For each, fetch insights with the right metric set
  const insightsByMediaId = {};
  let okCount = 0;
  let errCount = 0;
  let apiCalls = 1; // we already used 1 for the media list

  for (const item of items) {
    const isReel =
      item.media_product_type === 'REELS' ||
      item.media_type === 'VIDEO' ||
      item.media_type === 'REEL';
    const metrics = isReel ? REEL_METRICS : STATIC_METRICS;

    try {
      const result = await graphGet(item.id, {
        fields: `insights.metric(${metrics.join(',')})`,
      });
      apiCalls += 1;

      const flat = {};
      const insightsData = result.insights?.data || [];
      for (const m of insightsData) {
        const value = m.values?.[0]?.value;
        if (value !== undefined) {
          // camelCase the field names for the dashboard's existing convention
          const key = m.name === 'reels_skip_rate' ? 'skipRate'
            : m.name === 'ig_reels_avg_watch_time' ? 'avgWatchTimeMs'
            : m.name === 'profile_visits' ? 'profileVisits'
            : m.name === 'total_interactions' ? 'totalInteractions'
            : m.name === 'saved' ? 'saves'
            : m.name;
          flat[key] = value;
        }
      }

      flat.mediaType = item.media_type;
      flat.mediaProductType = item.media_product_type || null;
      flat.caption = (item.caption || '').slice(0, 200);
      flat.timestamp = item.timestamp;
      flat.permalink = item.permalink;
      flat.fetchedAt = new Date().toISOString();
      flat.isReel = isReel;

      insightsByMediaId[item.id] = flat;
      okCount += 1;

      // Print one-line summary
      const skipStr = flat.skipRate !== undefined ? `skip ${flat.skipRate.toFixed(0)}%` : '';
      const reachStr = flat.reach !== undefined ? `reach ${flat.reach}` : '';
      const savesStr = flat.saves !== undefined ? `saves ${flat.saves}` : '';
      const sharesStr = flat.shares !== undefined ? `shares ${flat.shares}` : '';
      const followsStr = flat.follows !== undefined ? `follows ${flat.follows}` : '';
      const captionPreview = (item.caption || '').slice(0, 30).replace(/\n/g, ' ');
      console.log(`  ✓ ${item.id} [${isReel ? 'REEL' : 'STATIC'}] ${reachStr} ${skipStr} ${savesStr} ${sharesStr} ${followsStr} — "${captionPreview}"`);
    } catch (err) {
      errCount += 1;
      console.warn(`  ✗ ${item.id}: ${err.message}`);
    }
  }

  console.log(`\n  Insights pulled: ${okCount} ok, ${errCount} errors (${apiCalls} API calls used of 200/hr limit)`);

  // 3. Write to Firebase via PATCH so we merge instead of overwriting
  if (Object.keys(insightsByMediaId).length > 0) {
    await patchFirebase('analytics/latest/igInsights', insightsByMediaId);
    console.log(`  ✓ Wrote ${Object.keys(insightsByMediaId).length} insights records to analytics/latest/igInsights`);

    // Also write a snapshot under history for trend tracking
    const dateKey = new Date().toISOString().slice(0, 10);
    await patchFirebase(`analytics/history/${dateKey}/igInsights`, insightsByMediaId);
    console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/igInsights`);
  }

  // 4. Aggregate stats for the run log
  const reels = Object.values(insightsByMediaId).filter(x => x.isReel);
  const avgSkipRate = reels.length
    ? +(reels.reduce((s, x) => s + (x.skipRate || 0), 0) / reels.length).toFixed(1)
    : null;
  const avgReach = reels.length
    ? Math.round(reels.reduce((s, x) => s + (x.reach || 0), 0) / reels.length)
    : null;
  const totalSaves = Object.values(insightsByMediaId).reduce((s, x) => s + (x.saves || 0), 0);
  const totalShares = Object.values(insightsByMediaId).reduce((s, x) => s + (x.shares || 0), 0);
  const totalFollows = Object.values(insightsByMediaId).reduce((s, x) => s + (x.follows || 0), 0);

  console.log('\n  📈 Aggregates:');
  console.log(`    Reels analyzed: ${reels.length}`);
  console.log(`    Avg skip rate (reels): ${avgSkipRate !== null ? avgSkipRate + '%' : 'n/a'}`);
  console.log(`    Avg reach (reels): ${avgReach !== null ? avgReach : 'n/a'}`);
  console.log(`    Total saves (all media): ${totalSaves}`);
  console.log(`    Total shares (all media): ${totalShares}`);
  console.log(`    Total follows-from-post: ${totalFollows}`);

  // 5. Write aggregate summary for daily-strategy to read
  await patchFirebase('analytics/latest/igInsightsSummary', {
    reelsAnalyzed: reels.length,
    avgSkipRate,
    avgReach,
    totalSaves,
    totalShares,
    totalFollows,
    apiCallsUsed: apiCalls,
    fetchedAt: new Date().toISOString(),
  });
  console.log(`  ✓ Wrote summary to analytics/latest/igInsightsSummary`);

  console.log('\n✅ IG Insights scrape complete\n');
}

main().catch((err) => {
  console.error('\n❌ IG Insights scrape failed:', err);
  process.exit(1);
});
