/**
 * IG Account-Level Insights Scraper — Meta Graph API → Firebase
 *
 * Pulls account-level metrics that the per-post insights scraper
 * doesn't cover — specifically:
 *   - website_clicks (bio link clicks per day — THE conversion metric)
 *   - profile_views (top-of-funnel awareness)
 *   - reach / impressions (account-level reach)
 *   - accounts_engaged (newer aggregate metric)
 *
 * Runs daily after the per-post insights scrape. Account-level data
 * updates every 24 hours per Meta docs (vs hourly for per-post),
 * so once daily is sufficient.
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

if (!FB_PAGE_ACCESS_TOKEN) {
  console.error('Missing FB_PAGE_ACCESS_TOKEN');
  process.exit(1);
}
if (!IG_BUSINESS_ACCOUNT_ID) {
  console.error('Missing IG_BUSINESS_ACCOUNT_ID');
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

// ─── Graph API helper ───────────────────────────────────────────

async function fetchMetric(metric, period = 'day') {
  const qs = new URLSearchParams({
    metric,
    period,
    access_token: FB_PAGE_ACCESS_TOKEN,
  }).toString();
  const url = `${GRAPH_BASE}/${IG_BUSINESS_ACCOUNT_ID}/insights?${qs}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    return { error: json.error.message };
  }
  return json;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 IG Account-Level Insights scrape starting...');

  // Try the metrics we care about. Some endpoints reject mixed periods,
  // so each metric is fetched individually so a single failure doesn't
  // wipe out the rest.
  //
  // Metric inventory and what each measures:
  //   website_clicks   — daily bio link clicks (THE link-click rate fix)
  //   profile_views    — daily profile visits (top-of-funnel)
  //   reach            — unique accounts that saw any of your content
  //   accounts_engaged — newer aggregate (replaced impressions in 2024)
  //   total_interactions, likes, comments, shares, saves, replies, follows
  const targets = [
    'website_clicks',
    'profile_views',
    'reach',
    'accounts_engaged',
    'total_interactions',
    'likes',
    'comments',
    'shares',
    'saves',
    'replies',
    'follows',
  ];

  const results = {};
  let okCount = 0;
  let errCount = 0;

  for (const metric of targets) {
    const r = await fetchMetric(metric, 'day');
    if (r.error) {
      results[metric] = { error: r.error };
      errCount += 1;
      console.warn(`  ✗ ${metric}: ${r.error}`);
    } else {
      const data = r.data?.[0];
      if (!data) {
        results[metric] = { error: 'no data returned' };
        errCount += 1;
        console.warn(`  ✗ ${metric}: empty response`);
        continue;
      }
      // Account-level insights with metric_type=total_value return
      // a single value; legacy ones return values[] arrays. Handle both.
      const values = data.values || [];
      const total = data.total_value?.value;
      const lastValue = values.length ? values[values.length - 1].value : null;
      const sumLast7 = values.length
        ? values.slice(-7).reduce((s, v) => s + (v.value || 0), 0)
        : null;

      results[metric] = {
        latest: lastValue ?? total ?? null,
        last7Sum: sumLast7,
        valuesByDay: values.map(v => ({ value: v.value, end_time: v.end_time })),
        title: data.title,
        description: data.description,
      };
      okCount += 1;
      const display = lastValue !== null
        ? `latest=${lastValue}` + (sumLast7 !== null ? ` 7dSum=${sumLast7}` : '')
        : (total !== null ? `total=${total}` : 'no values');
      console.log(`  ✓ ${metric}: ${display}`);
    }
  }

  console.log(`\n  Account insights: ${okCount} ok, ${errCount} errors\n`);

  // Persist all results — including errors so we know which fields
  // didn't work for next time
  await patchFirebase('analytics/latest/igAccountInsights', {
    fetchedAt: new Date().toISOString(),
    metrics: results,
  });
  console.log('  ✓ Wrote to analytics/latest/igAccountInsights');

  // Also snapshot a slim daily summary for trend tracking
  const dateKey = new Date().toISOString().slice(0, 10);
  const summary = {
    date: dateKey,
    websiteClicksLatest: results.website_clicks?.latest ?? null,
    websiteClicks7dSum: results.website_clicks?.last7Sum ?? null,
    profileViewsLatest: results.profile_views?.latest ?? null,
    profileViews7dSum: results.profile_views?.last7Sum ?? null,
    reachLatest: results.reach?.latest ?? null,
    accountsEngagedLatest: results.accounts_engaged?.latest ?? null,
    fetchedAt: new Date().toISOString(),
  };
  await patchFirebase(`analytics/history/${dateKey}/igAccountSummary`, summary);
  console.log(`  ✓ Snapshotted daily summary to analytics/history/${dateKey}/igAccountSummary`);

  // Compute the headline diagnostic: bio link click-through rate.
  // Defined as website_clicks / profile_views (both account-level
  // 1-day numbers). This replaces the dashboard's previous estimate.
  if (summary.websiteClicksLatest !== null && summary.profileViewsLatest > 0) {
    const ctr = summary.websiteClicksLatest / summary.profileViewsLatest;
    console.log(`\n  🎯 Bio link CTR (today): ${(ctr * 100).toFixed(1)}% (${summary.websiteClicksLatest} clicks / ${summary.profileViewsLatest} profile views)`);
    if (summary.websiteClicks7dSum !== null && summary.profileViews7dSum > 0) {
      const ctr7d = summary.websiteClicks7dSum / summary.profileViews7dSum;
      console.log(`  🎯 Bio link CTR (7d): ${(ctr7d * 100).toFixed(1)}% (${summary.websiteClicks7dSum} clicks / ${summary.profileViews7dSum} profile views)`);
    }
  }

  console.log('\n✅ IG Account-Level Insights scrape complete\n');
}

main().catch(err => {
  console.error('\n❌ Account insights scrape failed:', err);
  process.exit(1);
});
