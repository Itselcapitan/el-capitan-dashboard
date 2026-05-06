/**
 * IG Ads Scraper — Meta Marketing API → Firebase
 *
 * Pulls ad campaign performance data from the Meta Marketing API:
 *   - Campaign list with status, objective, budgets
 *   - Per-campaign 30-day insights (spend, impressions, reach, clicks, CPM, CPC, CTR)
 *   - Conversion actions and cost-per-action breakdowns
 *
 * Writes full results to analytics/latest/igAds and a slim daily
 * snapshot to analytics/history/{YYYY-MM-DD}/igAds for trend tracking.
 *
 * Env vars: FB_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID,
 *           FIREBASE_DB_URL, FIREBASE_DB_SECRET,
 *           FB_AD_ACCOUNT_ID (optional — auto-discovered if not set)
 */

const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';
const FB_AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID || '';

const GRAPH_API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

if (!FB_PAGE_ACCESS_TOKEN) {
  console.error('Missing FB_PAGE_ACCESS_TOKEN environment variable');
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

// ─── Ad account discovery ───────────────────────────────────────

async function discoverAdAccount() {
  if (FB_AD_ACCOUNT_ID) {
    console.log(`  Using FB_AD_ACCOUNT_ID from env: ${FB_AD_ACCOUNT_ID}`);
    // Fetch account details for the name/currency
    try {
      const acct = await graphGet(FB_AD_ACCOUNT_ID, {
        fields: 'id,name,account_status,currency,business_name',
      });
      return {
        id: acct.id,
        name: acct.name || 'Unknown',
        currency: acct.currency || 'USD',
      };
    } catch (err) {
      console.warn(`  Could not fetch account details: ${err.message}`);
      return {
        id: FB_AD_ACCOUNT_ID,
        name: 'Unknown',
        currency: 'USD',
      };
    }
  }

  // Auto-discover from /me/adaccounts
  console.log('  FB_AD_ACCOUNT_ID not set — attempting auto-discovery...');
  let result;
  try {
    result = await graphGet('me/adaccounts', {
      fields: 'id,name,account_status,currency,business_name',
    });
  } catch (err) {
    console.log(`  Auto-discovery failed: ${err.message}`);
    console.log('  Set the FB_AD_ACCOUNT_ID secret if you have an ad account.');
    return null;
  }

  const accounts = result.data || [];
  if (!accounts.length) {
    return null;
  }

  // Prefer active accounts (account_status 1 = ACTIVE)
  const active = accounts.find(a => a.account_status === 1) || accounts[0];
  console.log(`  Discovered ad account: ${active.id} (${active.name || 'unnamed'})`);
  return {
    id: active.id,
    name: active.name || 'Unknown',
    currency: active.currency || 'USD',
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 IG Ads scrape starting...');
  let apiCalls = 0;

  // 1. Discover ad account
  const adAccount = await discoverAdAccount();
  apiCalls += 1;

  if (!adAccount) {
    console.log('  No ad accounts linked to this token — nothing to scrape.');
    console.log('  This is normal if no Meta ads have been set up yet.');
    // Write empty state so the dashboard knows we checked
    await patchFirebase('analytics/latest/igAds', {
      fetchedAt: new Date().toISOString(),
      adAccountId: null,
      adAccountName: null,
      currency: null,
      campaigns: {},
      summary: {
        totalCampaigns: 0,
        activeCampaigns: 0,
        totalSpend30d: 0,
        totalImpressions30d: 0,
        totalClicks30d: 0,
        avgCPM: 0,
        avgCPC: 0,
        avgCTR: 0,
      },
    });
    console.log('\n✅ IG Ads scrape complete (no ad account)\n');
    return;
  }

  console.log(`  Ad Account: ${adAccount.id} — ${adAccount.name} (${adAccount.currency})`);

  // 2. Get campaigns
  const campaignsResult = await graphGet(`${adAccount.id}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    limit: '25',
  });
  apiCalls += 1;

  const campaignList = campaignsResult.data || [];
  console.log(`  Found ${campaignList.length} campaigns`);

  if (!campaignList.length) {
    console.log('  No campaigns found — writing empty result.');
    await patchFirebase('analytics/latest/igAds', {
      fetchedAt: new Date().toISOString(),
      adAccountId: adAccount.id,
      adAccountName: adAccount.name,
      currency: adAccount.currency,
      campaigns: {},
      summary: {
        totalCampaigns: 0,
        activeCampaigns: 0,
        totalSpend30d: 0,
        totalImpressions30d: 0,
        totalClicks30d: 0,
        avgCPM: 0,
        avgCPC: 0,
        avgCTR: 0,
      },
    });
    console.log('\n✅ IG Ads scrape complete (no campaigns)\n');
    return;
  }

  // 3. Fetch insights for each campaign
  const campaigns = {};
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let activeCampaigns = 0;
  let insightsCount = 0;

  for (const c of campaignList) {
    if (c.status === 'ACTIVE') activeCampaigns += 1;

    const budget = {
      daily: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null, // API returns cents
      lifetime: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
    };

    const campaignData = {
      name: c.name,
      status: c.status,
      objective: c.objective || null,
      budget,
      startTime: c.start_time || null,
      stopTime: c.stop_time || null,
      insights30d: null,
    };

    // Fetch 30-day insights
    try {
      const insights = await graphGet(`${c.id}/insights`, {
        fields: 'impressions,reach,clicks,spend,cpm,cpc,ctr,actions,cost_per_action_type',
        date_preset: 'last_30d',
      });
      apiCalls += 1;

      const row = insights.data?.[0];
      if (row) {
        const spend = parseFloat(row.spend || '0');
        const impressions = parseInt(row.impressions || '0', 10);
        const clicks = parseInt(row.clicks || '0', 10);

        campaignData.insights30d = {
          impressions,
          reach: parseInt(row.reach || '0', 10),
          clicks,
          spend,
          cpm: parseFloat(row.cpm || '0'),
          cpc: parseFloat(row.cpc || '0'),
          ctr: parseFloat(row.ctr || '0'),
          actions: (row.actions || []).map(a => ({
            action_type: a.action_type,
            value: parseInt(a.value || '0', 10),
          })),
          costPerAction: (row.cost_per_action_type || []).map(a => ({
            action_type: a.action_type,
            value: parseFloat(a.value || '0'),
          })),
        };

        totalSpend += spend;
        totalImpressions += impressions;
        totalClicks += clicks;
        insightsCount += 1;

        const ctrStr = campaignData.insights30d.ctr.toFixed(2);
        console.log(`  ✓ ${c.name} [${c.status}] — $${spend.toFixed(2)} spend, ${impressions} impr, ${ctrStr}% CTR`);
      } else {
        console.log(`  - ${c.name} [${c.status}] — no insights (draft or no delivery)`);
      }
    } catch (err) {
      apiCalls += 1;
      // Some campaigns (drafts, archived with no data) will 400 on insights
      console.log(`  - ${c.name} [${c.status}] — skipped: ${err.message.slice(0, 80)}`);
    }

    campaigns[c.id] = campaignData;
  }

  // 4. Compute summary
  const campaignsWithInsights = Object.values(campaigns).filter(c => c.insights30d);
  const avgCPM = campaignsWithInsights.length
    ? +(campaignsWithInsights.reduce((s, c) => s + c.insights30d.cpm, 0) / campaignsWithInsights.length).toFixed(2)
    : 0;
  const avgCPC = campaignsWithInsights.length
    ? +(campaignsWithInsights.reduce((s, c) => s + c.insights30d.cpc, 0) / campaignsWithInsights.length).toFixed(2)
    : 0;
  const avgCTR = campaignsWithInsights.length
    ? +(campaignsWithInsights.reduce((s, c) => s + c.insights30d.ctr, 0) / campaignsWithInsights.length).toFixed(2)
    : 0;

  const summary = {
    totalCampaigns: campaignList.length,
    activeCampaigns,
    totalSpend30d: +totalSpend.toFixed(2),
    totalImpressions30d: totalImpressions,
    totalClicks30d: totalClicks,
    avgCPM,
    avgCPC,
    avgCTR,
  };

  console.log(`\n  Insights pulled for ${insightsCount}/${campaignList.length} campaigns (${apiCalls} API calls)`);
  console.log('\n  📈 30-Day Summary:');
  console.log(`    Total campaigns: ${summary.totalCampaigns} (${summary.activeCampaigns} active)`);
  console.log(`    Total spend: $${summary.totalSpend30d.toFixed(2)} ${adAccount.currency}`);
  console.log(`    Total impressions: ${summary.totalImpressions30d.toLocaleString()}`);
  console.log(`    Total clicks: ${summary.totalClicks30d.toLocaleString()}`);
  console.log(`    Avg CPM: $${summary.avgCPM.toFixed(2)}`);
  console.log(`    Avg CPC: $${summary.avgCPC.toFixed(2)}`);
  console.log(`    Avg CTR: ${summary.avgCTR.toFixed(2)}%`);

  // 5. Write full results to Firebase
  const fullPayload = {
    fetchedAt: new Date().toISOString(),
    adAccountId: adAccount.id,
    adAccountName: adAccount.name,
    currency: adAccount.currency,
    campaigns,
    summary,
  };

  await patchFirebase('analytics/latest/igAds', fullPayload);
  console.log('\n  ✓ Wrote full results to analytics/latest/igAds');

  // 6. Write slim daily snapshot for trend tracking
  const dateKey = new Date().toISOString().slice(0, 10);
  const slimCampaigns = {};
  for (const [id, c] of Object.entries(campaigns)) {
    if (c.insights30d) {
      slimCampaigns[id] = {
        name: c.name,
        status: c.status,
        spend: c.insights30d.spend,
        impressions: c.insights30d.impressions,
        clicks: c.insights30d.clicks,
      };
    }
  }

  await patchFirebase(`analytics/history/${dateKey}/igAds`, {
    fetchedAt: new Date().toISOString(),
    summary,
    campaigns: slimCampaigns,
  });
  console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/igAds`);

  console.log('\n✅ IG Ads scrape complete\n');
}

main().catch((err) => {
  console.error('\n❌ IG Ads scrape failed:', err);
  process.exit(1);
});
