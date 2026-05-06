/**
 * IG Stories Insights Scraper — Meta Graph API → Firebase
 *
 * Pulls per-story Insights for currently live Instagram Stories
 * (stories expire after 24h, so this may return 0 stories).
 *
 * Metrics per story: exits, replies, reach, impressions, taps_forward,
 * taps_back, navigation. Also computes completion rate and a simple
 * engagement signal (rewatch > reply > passive).
 *
 * Runs daily alongside other scrape scripts. Writes to Firebase under
 * analytics/latest/igStories and analytics/history/{date}/igStories.
 *
 * API budget: 1 call for story list + N per-story insight calls
 * (typically 0-10 stories). Max ~11 calls.
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

// ─── Story metrics ──────────────────────────────────────────────

const STORY_METRICS = [
  'exits',
  'replies',
  'reach',
  'impressions',
  'taps_forward',
  'taps_back',
  'navigation',
];

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n📖 IG Stories Insights scrape starting...');
  console.log(`  IG Business Account: ${IG_BUSINESS_ACCOUNT_ID}`);

  // 1. Pull currently live stories (only stories from last 24h)
  let storyList;
  try {
    storyList = await graphGet(`${IG_BUSINESS_ACCOUNT_ID}/stories`, {
      fields: 'id,media_type,timestamp,caption,permalink',
    });
  } catch (err) {
    // Some accounts don't have stories enabled for API access
    console.warn(`  ⚠ Could not fetch stories: ${err.message}`);
    console.log('  Writing empty result and exiting gracefully.');

    const emptyResult = {
      fetchedAt: new Date().toISOString(),
      storyCount: 0,
      stories: {},
      summary: {
        totalStories: 0,
        avgReach: 0,
        avgCompletionRate: 0,
        totalReplies: 0,
        totalTapsBack: 0,
      },
    };

    const dateKey = new Date().toISOString().slice(0, 10);
    await patchFirebase('analytics/latest/igStories', emptyResult);
    await patchFirebase(`analytics/history/${dateKey}/igStories`, emptyResult);
    console.log('\n✅ IG Stories scrape complete (no stories available)\n');
    return;
  }

  const items = storyList.data || [];
  console.log(`  Found ${items.length} live stories`);

  // If no stories are currently live, write an empty result
  if (!items.length) {
    console.log('  No stories live in the last 24h — writing empty result');

    const emptyResult = {
      fetchedAt: new Date().toISOString(),
      storyCount: 0,
      stories: {},
      summary: {
        totalStories: 0,
        avgReach: 0,
        avgCompletionRate: 0,
        totalReplies: 0,
        totalTapsBack: 0,
      },
    };

    const dateKey = new Date().toISOString().slice(0, 10);
    await patchFirebase('analytics/latest/igStories', emptyResult);
    await patchFirebase(`analytics/history/${dateKey}/igStories`, emptyResult);
    console.log('  ✓ Wrote empty result to Firebase');
    console.log('\n✅ IG Stories scrape complete (0 stories)\n');
    return;
  }

  // 2. For each story, fetch insights
  const stories = {};
  let okCount = 0;
  let errCount = 0;
  let apiCalls = 1; // 1 for the story list call

  for (const item of items) {
    try {
      const result = await graphGet(item.id, {
        fields: `insights.metric(${STORY_METRICS.join(',')})`,
      });
      apiCalls += 1;

      // Flatten insight values
      const flat = {};
      const insightsData = result.insights?.data || [];
      for (const m of insightsData) {
        const value = m.values?.[0]?.value ?? 0;
        // camelCase the metric names
        const key = m.name === 'taps_forward' ? 'tapsForward'
          : m.name === 'taps_back' ? 'tapsBack'
          : m.name;
        flat[key] = value;
      }

      // Compute derived metrics
      const impressions = flat.impressions || 0;
      const exits = flat.exits || 0;
      const completionRate = impressions > 0
        ? +((impressions - exits) / impressions * 100).toFixed(1)
        : 0;

      const tapsBack = flat.tapsBack || 0;
      const replies = flat.replies || 0;
      const engagementSignal = tapsBack > 0 ? 'rewatch'
        : replies > 0 ? 'reply'
        : 'passive';

      stories[item.id] = {
        timestamp: item.timestamp,
        mediaType: item.media_type || 'IMAGE',
        exits,
        replies,
        reach: flat.reach || 0,
        impressions,
        tapsForward: flat.tapsForward || 0,
        tapsBack,
        navigation: flat.navigation || 0,
        completionRate,
        engagementSignal,
        fetchedAt: new Date().toISOString(),
      };
      okCount += 1;

      // One-line summary per story
      console.log(`  ✓ ${item.id} [${item.media_type || 'IMAGE'}] reach=${flat.reach || 0} impressions=${impressions} completion=${completionRate}% signal=${engagementSignal}`);
    } catch (err) {
      errCount += 1;
      console.warn(`  ✗ ${item.id}: ${err.message}`);
    }
  }

  console.log(`\n  Stories pulled: ${okCount} ok, ${errCount} errors (${apiCalls} API calls)`);

  // 3. Compute summary
  const storyValues = Object.values(stories);
  const totalStories = storyValues.length;
  const avgReach = totalStories > 0
    ? Math.round(storyValues.reduce((s, x) => s + x.reach, 0) / totalStories)
    : 0;
  const avgCompletionRate = totalStories > 0
    ? +(storyValues.reduce((s, x) => s + x.completionRate, 0) / totalStories).toFixed(1)
    : 0;
  const totalReplies = storyValues.reduce((s, x) => s + x.replies, 0);
  const totalTapsBack = storyValues.reduce((s, x) => s + x.tapsBack, 0);

  const payload = {
    fetchedAt: new Date().toISOString(),
    storyCount: totalStories,
    stories,
    summary: {
      totalStories,
      avgReach,
      avgCompletionRate,
      totalReplies,
      totalTapsBack,
    },
  };

  // 4. Write to Firebase
  await patchFirebase('analytics/latest/igStories', payload);
  console.log(`  ✓ Wrote ${totalStories} stories to analytics/latest/igStories`);

  const dateKey = new Date().toISOString().slice(0, 10);
  await patchFirebase(`analytics/history/${dateKey}/igStories`, payload);
  console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/igStories`);

  // 5. Print aggregate summary
  console.log('\n  📈 Stories Summary:');
  console.log(`    Total stories: ${totalStories}`);
  console.log(`    Avg reach: ${avgReach}`);
  console.log(`    Avg completion rate: ${avgCompletionRate}%`);
  console.log(`    Total replies (DMs): ${totalReplies}`);
  console.log(`    Total taps back (re-watch signal): ${totalTapsBack}`);

  console.log('\n✅ IG Stories Insights scrape complete\n');
}

main().catch((err) => {
  console.error('\n❌ IG Stories scrape failed:', err);
  process.exit(1);
});
