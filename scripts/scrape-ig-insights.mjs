/**
 * IG Insights Scraper — Meta Graph API → Firebase
 *
 * Pulls per-post Insights data that Apify's public scraper can't see:
 * skip_rate, saved, shares, reach, follows-from-post, profile_visits, etc.
 *
 * Uses batch API calls (/?ids=id1,id2&fields=...) to fetch insights for
 * multiple posts in a single request, dropping API usage from ~26 calls
 * to ~4 calls (1 media list + 1 batch per media type + 1 summary write).
 *
 * Also detects Trial Reels via the is_shared_to_feed field.
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

// Max IDs per batch request — Meta allows up to 50
const BATCH_SIZE = 25;

if (!FB_PAGE_ACCESS_TOKEN) {
  console.error('Missing FB_PAGE_ACCESS_TOKEN environment variable');
  process.exit(1);
}
if (!IG_BUSINESS_ACCOUNT_ID) {
  console.error('Missing IG_BUSINESS_ACCOUNT_ID environment variable');
  process.exit(1);
}

// ─── Metric sets per media type ─────────────────────────────────

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

async function batchInsights(ids, metrics) {
  const idsStr = ids.join(',');
  const fields = `insights.metric(${metrics.join(',')})`;
  const qs = new URLSearchParams({
    ids: idsStr,
    fields,
    access_token: FB_PAGE_ACCESS_TOKEN,
  }).toString();
  const url = `${GRAPH_BASE}/?${qs}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`Batch API error: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

function camelCaseMetric(name) {
  if (name === 'reels_skip_rate') return 'skipRate';
  if (name === 'ig_reels_avg_watch_time') return 'avgWatchTimeMs';
  if (name === 'profile_visits') return 'profileVisits';
  if (name === 'total_interactions') return 'totalInteractions';
  if (name === 'saved') return 'saves';
  return name;
}

function parseInsightsFromBatchEntry(entry) {
  const flat = {};
  const insightsData = entry.insights?.data || [];
  for (const m of insightsData) {
    const value = m.values?.[0]?.value;
    if (value !== undefined) {
      flat[camelCaseMetric(m.name)] = value;
    }
  }
  return flat;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 IG Insights scrape starting (batch mode)...');
  console.log(`  IG Business Account: ${IG_BUSINESS_ACCOUNT_ID}`);

  // 1. Pull recent media list — includes is_shared_to_feed for Trial Reels detection
  const mediaList = await graphGet(`${IG_BUSINESS_ACCOUNT_ID}/media`, {
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink,is_shared_to_feed',
    limit: String(MEDIA_LIMIT),
  });

  const items = mediaList.data || [];
  console.log(`  Fetched ${items.length} media items`);

  if (!items.length) {
    console.log('  No media found — exiting');
    return;
  }

  // Classify items by type for batched metric requests
  const reelItems = [];
  const staticItems = [];
  for (const item of items) {
    const isReel =
      item.media_product_type === 'REELS' ||
      item.media_type === 'VIDEO' ||
      item.media_type === 'REEL';
    if (isReel) reelItems.push(item);
    else staticItems.push(item);
  }

  // Trial Reels: is_shared_to_feed=false on a RECENT reel (< 72 hours old)
  // indicates it's still in the trial/test phase. Older reels with
  // is_shared_to_feed=false just weren't cross-posted to the grid.
  const now = Date.now();
  const TRIAL_WINDOW_MS = 72 * 60 * 60 * 1000;
  const trialReels = items.filter(i => {
    if (i.is_shared_to_feed !== false) return false;
    const postAge = now - new Date(i.timestamp).getTime();
    return postAge < TRIAL_WINDOW_MS;
  });
  if (trialReels.length > 0) {
    console.log(`\n  🧪 Trial Reels detected: ${trialReels.length} reel(s) in testing phase (< 72h old, not shared to feed)`);
    for (const tr of trialReels) {
      const caption = (tr.caption || '').slice(0, 40).replace(/\n/g, ' ');
      console.log(`     - ${tr.id} "${caption}" (posted ${tr.timestamp})`);
    }
  }

  console.log(`\n  Media breakdown: ${reelItems.length} reels, ${staticItems.length} static`);

  // 2. Batch-fetch insights by type
  const insightsByMediaId = {};
  let okCount = 0;
  let errCount = 0;
  let apiCalls = 1; // media list call

  // Process reels in batches
  for (let i = 0; i < reelItems.length; i += BATCH_SIZE) {
    const chunk = reelItems.slice(i, i + BATCH_SIZE);
    const ids = chunk.map(c => c.id);
    try {
      const batchResult = await batchInsights(ids, REEL_METRICS);
      apiCalls += 1;

      for (const item of chunk) {
        const entry = batchResult[item.id];
        if (!entry || entry.error) {
          errCount += 1;
          console.warn(`  ✗ ${item.id}: ${entry?.error?.message || 'missing from batch response'}`);
          continue;
        }

        const flat = parseInsightsFromBatchEntry(entry);
        flat.mediaType = item.media_type;
        flat.mediaProductType = item.media_product_type || null;
        flat.caption = (item.caption || '').slice(0, 200);
        flat.timestamp = item.timestamp;
        flat.permalink = item.permalink;
        flat.fetchedAt = new Date().toISOString();
        flat.isReel = true;
        flat.isSharedToFeed = item.is_shared_to_feed ?? null;
        flat.isTrialReel = item.is_shared_to_feed === false && (now - new Date(item.timestamp).getTime()) < TRIAL_WINDOW_MS;

        insightsByMediaId[item.id] = flat;
        okCount += 1;

        const skipStr = flat.skipRate !== undefined ? `skip ${flat.skipRate.toFixed(0)}%` : '';
        const reachStr = flat.reach !== undefined ? `reach ${flat.reach}` : '';
        const savesStr = flat.saves !== undefined ? `saves ${flat.saves}` : '';
        const sharesStr = flat.shares !== undefined ? `shares ${flat.shares}` : '';
        const followsStr = flat.follows !== undefined ? `follows ${flat.follows}` : '';
        const trialStr = flat.isTrialReel ? ' [TRIAL]' : '';
        const captionPreview = (item.caption || '').slice(0, 30).replace(/\n/g, ' ');
        console.log(`  ✓ ${item.id} [REEL${trialStr}] ${reachStr} ${skipStr} ${savesStr} ${sharesStr} ${followsStr} — "${captionPreview}"`);
      }
    } catch (err) {
      // Batch failed — fall back to individual calls for this chunk
      console.warn(`  ⚠️ Batch failed for ${ids.length} reels: ${err.message}`);
      console.log(`  ↳ Falling back to individual calls...`);
      for (const item of chunk) {
        try {
          const result = await graphGet(item.id, {
            fields: `insights.metric(${REEL_METRICS.join(',')})`,
          });
          apiCalls += 1;
          const flat = parseInsightsFromBatchEntry(result);
          flat.mediaType = item.media_type;
          flat.mediaProductType = item.media_product_type || null;
          flat.caption = (item.caption || '').slice(0, 200);
          flat.timestamp = item.timestamp;
          flat.permalink = item.permalink;
          flat.fetchedAt = new Date().toISOString();
          flat.isReel = true;
          flat.isSharedToFeed = item.is_shared_to_feed ?? null;
          flat.isTrialReel = item.is_shared_to_feed === false;
          insightsByMediaId[item.id] = flat;
          okCount += 1;
          const captionPreview = (item.caption || '').slice(0, 30).replace(/\n/g, ' ');
          console.log(`  ✓ ${item.id} [REEL] (fallback) — "${captionPreview}"`);
        } catch (e2) {
          errCount += 1;
          console.warn(`  ✗ ${item.id}: ${e2.message}`);
        }
      }
    }
  }

  // Process static posts in batches
  for (let i = 0; i < staticItems.length; i += BATCH_SIZE) {
    const chunk = staticItems.slice(i, i + BATCH_SIZE);
    const ids = chunk.map(c => c.id);
    try {
      const batchResult = await batchInsights(ids, STATIC_METRICS);
      apiCalls += 1;

      for (const item of chunk) {
        const entry = batchResult[item.id];
        if (!entry || entry.error) {
          errCount += 1;
          console.warn(`  ✗ ${item.id}: ${entry?.error?.message || 'missing from batch response'}`);
          continue;
        }

        const flat = parseInsightsFromBatchEntry(entry);
        flat.mediaType = item.media_type;
        flat.mediaProductType = item.media_product_type || null;
        flat.caption = (item.caption || '').slice(0, 200);
        flat.timestamp = item.timestamp;
        flat.permalink = item.permalink;
        flat.fetchedAt = new Date().toISOString();
        flat.isReel = false;
        flat.isSharedToFeed = item.is_shared_to_feed ?? null;

        insightsByMediaId[item.id] = flat;
        okCount += 1;

        const reachStr = flat.reach !== undefined ? `reach ${flat.reach}` : '';
        const savesStr = flat.saves !== undefined ? `saves ${flat.saves}` : '';
        const captionPreview = (item.caption || '').slice(0, 30).replace(/\n/g, ' ');
        console.log(`  ✓ ${item.id} [STATIC] ${reachStr} ${savesStr} — "${captionPreview}"`);
      }
    } catch (err) {
      console.warn(`  ⚠️ Batch failed for ${ids.length} static posts: ${err.message}`);
      console.log(`  ↳ Falling back to individual calls...`);
      for (const item of chunk) {
        try {
          const result = await graphGet(item.id, {
            fields: `insights.metric(${STATIC_METRICS.join(',')})`,
          });
          apiCalls += 1;
          const flat = parseInsightsFromBatchEntry(result);
          flat.mediaType = item.media_type;
          flat.mediaProductType = item.media_product_type || null;
          flat.caption = (item.caption || '').slice(0, 200);
          flat.timestamp = item.timestamp;
          flat.permalink = item.permalink;
          flat.fetchedAt = new Date().toISOString();
          flat.isReel = false;
          flat.isSharedToFeed = item.is_shared_to_feed ?? null;
          insightsByMediaId[item.id] = flat;
          okCount += 1;
          const captionPreview = (item.caption || '').slice(0, 30).replace(/\n/g, ' ');
          console.log(`  ✓ ${item.id} [STATIC] (fallback) — "${captionPreview}"`);
        } catch (e2) {
          errCount += 1;
          console.warn(`  ✗ ${item.id}: ${e2.message}`);
        }
      }
    }
  }

  console.log(`\n  Insights pulled: ${okCount} ok, ${errCount} errors (${apiCalls} API calls — was ~${items.length + 1} before batching)`);

  // 3. Write to Firebase via PATCH so we merge instead of overwriting
  if (Object.keys(insightsByMediaId).length > 0) {
    await patchFirebase('analytics/latest/igInsights', insightsByMediaId);
    console.log(`  ✓ Wrote ${Object.keys(insightsByMediaId).length} insights records to analytics/latest/igInsights`);

    const dateKey = new Date().toISOString().slice(0, 10);
    await patchFirebase(`analytics/history/${dateKey}/igInsights`, insightsByMediaId);
    console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/igInsights`);
  }

  // 4. Aggregate stats
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

  // Trial Reels summary
  const trialReelInsights = Object.values(insightsByMediaId).filter(x => x.isTrialReel);
  const graduatedReels = Object.values(insightsByMediaId).filter(x => x.isReel && x.isSharedToFeed === true);

  console.log('\n  📈 Aggregates:');
  console.log(`    Reels analyzed: ${reels.length} (${trialReelInsights.length} trial, ${graduatedReels.length} graduated)`);
  console.log(`    Avg skip rate (reels): ${avgSkipRate !== null ? avgSkipRate + '%' : 'n/a'}`);
  console.log(`    Avg reach (reels): ${avgReach !== null ? avgReach : 'n/a'}`);
  console.log(`    Total saves (all media): ${totalSaves}`);
  console.log(`    Total shares (all media): ${totalShares}`);
  console.log(`    Total follows-from-post: ${totalFollows}`);

  // Trial vs graduated skip rate comparison
  if (trialReelInsights.length > 0 && graduatedReels.length > 0) {
    const trialAvgSkip = +(trialReelInsights.reduce((s, x) => s + (x.skipRate || 0), 0) / trialReelInsights.length).toFixed(1);
    const gradAvgSkip = +(graduatedReels.reduce((s, x) => s + (x.skipRate || 0), 0) / graduatedReels.length).toFixed(1);
    console.log(`    Trial Reels avg skip: ${trialAvgSkip}% vs Graduated avg skip: ${gradAvgSkip}%`);
  }

  // 5. Write aggregate summary
  await patchFirebase('analytics/latest/igInsightsSummary', {
    reelsAnalyzed: reels.length,
    trialReelsCount: trialReelInsights.length,
    graduatedReelsCount: graduatedReels.length,
    avgSkipRate,
    avgReach,
    totalSaves,
    totalShares,
    totalFollows,
    apiCallsUsed: apiCalls,
    fetchedAt: new Date().toISOString(),
  });
  console.log(`  ✓ Wrote summary to analytics/latest/igInsightsSummary`);

  // 6. Write Trial Reels snapshot if any exist
  if (trialReelInsights.length > 0) {
    const trialData = {};
    for (const tr of trialReelInsights) {
      const id = Object.entries(insightsByMediaId).find(([, v]) => v === tr)?.[0];
      if (id) trialData[id] = tr;
    }
    await patchFirebase('analytics/latest/igTrialReels', {
      count: trialReelInsights.length,
      reels: trialData,
      fetchedAt: new Date().toISOString(),
    });
    console.log(`  ✓ Wrote ${trialReelInsights.length} trial reel(s) to analytics/latest/igTrialReels`);
  }

  console.log('\n✅ IG Insights scrape complete\n');
}

main().catch((err) => {
  console.error('\n❌ IG Insights scrape failed:', err);
  process.exit(1);
});
