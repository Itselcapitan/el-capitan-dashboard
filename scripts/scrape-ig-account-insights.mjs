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

async function fetchMetric(metric, opts = {}) {
  // Account-level Insights in 2026 split into two API patterns:
  //
  //   Time-series (period=day):
  //     reach, follower_count, online_followers
  //     Returns values[] array with one entry per day.
  //
  //   Aggregate (metric_type=total_value):
  //     website_clicks, profile_views, profile_links_taps,
  //     accounts_engaged, total_interactions, likes, comments,
  //     shares, saves, replies, follows_and_unfollows, views,
  //     content_views, *_demographics
  //     Returns single total_value for the requested period.
  //
  // The metric_type approach also requires metric_type=total_value
  // explicitly OR the API errors out. We pass opts.useAggregate to
  // pick which format per metric.
  const params = {
    metric,
    access_token: FB_PAGE_ACCESS_TOKEN,
  };
  if (opts.useAggregate) {
    params.metric_type = 'total_value';
    // Aggregate metrics typically use a since/until window. Default
    // to last 28 days for monthly aggregate values. Smaller windows
    // available if needed.
    const sinceTs = Math.floor((Date.now() - 28 * 864e5) / 1000);
    const untilTs = Math.floor(Date.now() / 1000);
    params.since = String(sinceTs);
    params.until = String(untilTs);
  } else {
    params.period = opts.period || 'day';
  }
  const qs = new URLSearchParams(params).toString();
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

  // Confirmed valid metrics from Meta's error response (May 2026):
  //   reach, follower_count, website_clicks, profile_views,
  //   online_followers, accounts_engaged, total_interactions, likes,
  //   comments, shares, saves, replies, profile_links_taps, views,
  //   content_views, follows_and_unfollows
  //
  // Format split:
  //   useAggregate=false: reach, follower_count, online_followers
  //                       (period=day time-series)
  //   useAggregate=true:  everything else
  //                       (metric_type=total_value over a window)
  const targets = [
    // PRIMARY GOAL — bio link click metric. Two related fields:
    //   website_clicks   — clicks on the bio website link
    //   profile_links_taps — broader: any tap on bio links
    //                        (includes IG-internal links, story
    //                        highlights, etc.)
    { metric: 'website_clicks', useAggregate: true },
    { metric: 'profile_links_taps', useAggregate: true },

    // Funnel metrics
    { metric: 'profile_views', useAggregate: true },
    { metric: 'reach', useAggregate: false }, // time series
    { metric: 'accounts_engaged', useAggregate: true },

    // Engagement aggregates
    { metric: 'total_interactions', useAggregate: true },
    { metric: 'likes', useAggregate: true },
    { metric: 'comments', useAggregate: true },
    { metric: 'shares', useAggregate: true },
    { metric: 'saves', useAggregate: true },
    { metric: 'replies', useAggregate: true },

    // Follower change (replaced "follows" in 2026)
    { metric: 'follows_and_unfollows', useAggregate: true },

    // Content reach
    { metric: 'views', useAggregate: true },
    { metric: 'content_views', useAggregate: true },
  ];

  const results = {};
  let okCount = 0;
  let errCount = 0;

  for (const target of targets) {
    const r = await fetchMetric(target.metric, target);
    if (r.error) {
      results[target.metric] = { error: r.error };
      errCount += 1;
      console.warn(`  ✗ ${target.metric}: ${r.error.slice(0, 100)}`);
      continue;
    }
    const data = r.data?.[0];
    if (!data) {
      results[target.metric] = { error: 'no data returned' };
      errCount += 1;
      console.warn(`  ✗ ${target.metric}: empty response`);
      continue;
    }

    // Two response shapes:
    //   total_value approach: { total_value: { value: N } }
    //   period=day approach:  { values: [{value: N, end_time: ...}, ...] }
    const values = data.values || [];
    const totalValue = data.total_value?.value;
    const breakdownTotal = data.total_value?.breakdowns?.[0]?.results?.reduce
      ? data.total_value.breakdowns[0].results.reduce((s, r) => s + (r.value || 0), 0)
      : null;
    const lastValue = values.length ? values[values.length - 1].value : null;
    const sumLast7 = values.length
      ? values.slice(-7).reduce((s, v) => s + (v.value || 0), 0)
      : null;

    results[target.metric] = {
      latest: lastValue,
      last7Sum: sumLast7,
      total: totalValue ?? breakdownTotal ?? null, // 28-day aggregate window
      valuesByDay: values.map(v => ({ value: v.value, end_time: v.end_time })),
      title: data.title,
      description: data.description,
    };
    okCount += 1;
    const display = totalValue !== undefined
      ? `28d total=${totalValue}`
      : (lastValue !== null ? `latest=${lastValue}${sumLast7 !== null ? ` 7dSum=${sumLast7}` : ''}` : 'no values');
    console.log(`  ✓ ${target.metric}: ${display}`);
  }

  console.log(`\n  Account insights: ${okCount} ok, ${errCount} errors\n`);

  // Persist all results — including errors so we know which fields
  // didn't work for next time
  await patchFirebase('analytics/latest/igAccountInsights', {
    fetchedAt: new Date().toISOString(),
    metrics: results,
  });
  console.log('  ✓ Wrote to analytics/latest/igAccountInsights');

  // Also snapshot a slim daily summary for trend tracking. Uses the
  // 28-day aggregate windows since most account metrics now come back
  // that way per Meta's 2026 API.
  const dateKey = new Date().toISOString().slice(0, 10);
  const summary = {
    date: dateKey,
    websiteClicks28d: results.website_clicks?.total ?? null,
    profileLinksTaps28d: results.profile_links_taps?.total ?? null,
    profileViews28d: results.profile_views?.total ?? null,
    accountsEngaged28d: results.accounts_engaged?.total ?? null,
    totalInteractions28d: results.total_interactions?.total ?? null,
    views28d: results.views?.total ?? null,
    reachLatest: results.reach?.latest ?? null,
    reach7dSum: results.reach?.last7Sum ?? null,
    fetchedAt: new Date().toISOString(),
  };
  await patchFirebase(`analytics/history/${dateKey}/igAccountSummary`, summary);
  console.log(`  ✓ Snapshotted daily summary to analytics/history/${dateKey}/igAccountSummary`);

  // Compute the headline diagnostic: bio link CTR over the 28-day window.
  // This is the actual measurement of the dashboard's flagged 1% link-
  // click rate problem, replacing the previous indirect estimate.
  if (summary.websiteClicks28d !== null && summary.profileViews28d > 0) {
    const ctr = summary.websiteClicks28d / summary.profileViews28d;
    console.log(`\n  🎯 Website-clicks CTR (28d): ${(ctr * 100).toFixed(2)}% (${summary.websiteClicks28d} clicks / ${summary.profileViews28d} profile views)`);
  }
  if (summary.profileLinksTaps28d !== null && summary.profileViews28d > 0) {
    const ctr = summary.profileLinksTaps28d / summary.profileViews28d;
    console.log(`  🎯 ALL bio-link taps CTR (28d): ${(ctr * 100).toFixed(2)}% (${summary.profileLinksTaps28d} taps / ${summary.profileViews28d} profile views)`);
  }

  console.log('\n✅ IG Account-Level Insights scrape complete\n');
}

main().catch(err => {
  console.error('\n❌ Account insights scrape failed:', err);
  process.exit(1);
});
