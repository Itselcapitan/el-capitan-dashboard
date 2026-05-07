/**
 * IG Demographics & Optimal Posting Times — Meta Graph API → Firebase
 *
 * Pulls audience demographics and online-followers timing data using
 * the 2025+ Graph API format:
 *   - online_followers (period=lifetime, hour-by-hour)
 *   - follower_demographics (metric_type=total_value with breakdown)
 *     - breakdown=age, gender, city, country
 *
 * The old audience_gender_age / audience_city / audience_country metrics
 * were deprecated in Graph API v18+. They're now accessed via the unified
 * follower_demographics metric with breakdown parameters.
 *
 * Makes 5 API calls. Writes structured results to Firebase for the
 * dashboard's "Best Posting Times" heatmap and demographics cards.
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

async function fetchInsights(params) {
  const qs = new URLSearchParams({
    ...params,
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

// ─── Parsing helpers ────────────────────────────────────────────

function formatHour(h) {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function parseOnlineFollowers(json) {
  const data = json.data?.[0];
  if (!data) return { error: 'no data returned' };

  const values = data.values || [];
  if (!values.length) return { error: 'empty values array' };

  // Use the latest day's hourly breakdown
  const latest = values[values.length - 1];
  const hourly = latest.value || {};

  let peakHour = 0;
  let peakCount = 0;
  for (const [h, count] of Object.entries(hourly)) {
    if (count > peakCount) {
      peakCount = count;
      peakHour = Number(h);
    }
  }

  const windowStart = peakHour;
  const windowEnd = (peakHour + 3) % 24;
  const peakWindow = `${formatHour(windowStart)}-${formatHour(windowEnd)}`;

  return { hourly, peakHour, peakWindow };
}

function parseDemographicBreakdown(json, dimensionName) {
  // The follower_demographics response has breakdowns in total_value
  const results = json.data?.[0]?.total_value?.breakdowns?.[0]?.results;
  if (!results?.length) return { error: `no ${dimensionName} breakdown results` };

  const grandTotal = results.reduce((s, r) => s + (r.value || 0), 0);
  if (grandTotal === 0) return { error: `zero total for ${dimensionName}` };

  return results.map(r => {
    const dimValue = r.dimension_values?.[0] || 'Unknown';
    return {
      name: dimValue,
      value: r.value || 0,
      pct: Math.round(((r.value || 0) / grandTotal) * 1000) / 10,
    };
  }).sort((a, b) => b.pct - a.pct);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n👥 IG Demographics & Posting Times scrape starting...');

  const results = {};
  let okCount = 0;
  let errCount = 0;

  // 28-day window for demographic queries
  const sinceTs = String(Math.floor((Date.now() - 28 * 864e5) / 1000));
  const untilTs = String(Math.floor(Date.now() / 1000));

  // ── 1. online_followers (period=lifetime gives hourly breakdown) ──

  const onlineRaw = await fetchInsights({
    metric: 'online_followers',
    period: 'lifetime',
  });
  if (onlineRaw.error) {
    results.onlineFollowers = { error: onlineRaw.error };
    errCount += 1;
    console.warn(`  ✗ online_followers: ${onlineRaw.error.slice(0, 120)}`);
  } else {
    const parsed = parseOnlineFollowers(onlineRaw);
    if (parsed.error) {
      results.onlineFollowers = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ online_followers: ${parsed.error}`);
    } else {
      results.onlineFollowers = parsed;
      okCount += 1;
      console.log(`  ✓ online_followers: peak at ${formatHour(parsed.peakHour)}, window ${parsed.peakWindow}`);
    }
  }

  // ── 2. follower_demographics breakdown=age (gives gender+age combos) ──

  const ageRaw = await fetchInsights({
    metric: 'follower_demographics',
    period: 'lifetime',
    metric_type: 'total_value',
    breakdown: 'age',
    since: sinceTs,
    until: untilTs,
  });
  if (ageRaw.error) {
    results.ageGroups = { error: ageRaw.error };
    errCount += 1;
    console.warn(`  ✗ follower_demographics(age): ${ageRaw.error.slice(0, 120)}`);
  } else {
    const parsed = parseDemographicBreakdown(ageRaw, 'age');
    if (parsed.error) {
      results.ageGroups = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ follower_demographics(age): ${parsed.error}`);
    } else {
      results.ageGroups = parsed.map(a => ({ range: a.name, pct: a.pct }));
      okCount += 1;
      console.log(`  ✓ follower_demographics(age): top ${parsed[0]?.name} (${parsed[0]?.pct}%)`);
    }
  }

  // ── 3. follower_demographics breakdown=gender ──

  const genderRaw = await fetchInsights({
    metric: 'follower_demographics',
    period: 'lifetime',
    metric_type: 'total_value',
    breakdown: 'gender',
    since: sinceTs,
    until: untilTs,
  });
  if (genderRaw.error) {
    results.gender = { error: genderRaw.error };
    errCount += 1;
    console.warn(`  ✗ follower_demographics(gender): ${genderRaw.error.slice(0, 120)}`);
  } else {
    const parsed = parseDemographicBreakdown(genderRaw, 'gender');
    if (parsed.error) {
      results.gender = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ follower_demographics(gender): ${parsed.error}`);
    } else {
      const genderMap = {};
      for (const g of parsed) {
        const key = g.name.toLowerCase();
        if (key === 'm' || key === 'male') genderMap.male = g.pct;
        else if (key === 'f' || key === 'female') genderMap.female = g.pct;
      }
      results.gender = {
        male: genderMap.male || 0,
        female: genderMap.female || 0,
      };
      okCount += 1;
      console.log(`  ✓ follower_demographics(gender): ${results.gender.male}% male, ${results.gender.female}% female`);
    }
  }

  // ── 4. follower_demographics breakdown=city ──

  const cityRaw = await fetchInsights({
    metric: 'follower_demographics',
    period: 'lifetime',
    metric_type: 'total_value',
    breakdown: 'city',
    since: sinceTs,
    until: untilTs,
  });
  if (cityRaw.error) {
    results.topCities = { error: cityRaw.error };
    errCount += 1;
    console.warn(`  ✗ follower_demographics(city): ${cityRaw.error.slice(0, 120)}`);
  } else {
    const parsed = parseDemographicBreakdown(cityRaw, 'city');
    if (parsed.error) {
      results.topCities = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ follower_demographics(city): ${parsed.error}`);
    } else {
      results.topCities = parsed.map(c => ({ name: c.name, pct: c.pct }));
      okCount += 1;
      console.log(`  ✓ follower_demographics(city): #1 ${parsed[0]?.name} (${parsed[0]?.pct}%), ${parsed.length} cities total`);
    }
  }

  // ── 5. follower_demographics breakdown=country ──

  const countryRaw = await fetchInsights({
    metric: 'follower_demographics',
    period: 'lifetime',
    metric_type: 'total_value',
    breakdown: 'country',
    since: sinceTs,
    until: untilTs,
  });
  if (countryRaw.error) {
    results.topCountries = { error: countryRaw.error };
    errCount += 1;
    console.warn(`  ✗ follower_demographics(country): ${countryRaw.error.slice(0, 120)}`);
  } else {
    const parsed = parseDemographicBreakdown(countryRaw, 'country');
    if (parsed.error) {
      results.topCountries = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ follower_demographics(country): ${parsed.error}`);
    } else {
      results.topCountries = parsed.map(c => ({ name: c.name, pct: c.pct }));
      okCount += 1;
      console.log(`  ✓ follower_demographics(country): #1 ${parsed[0]?.name} (${parsed[0]?.pct}%), ${parsed.length} countries total`);
    }
  }

  console.log(`\n  Demographics: ${okCount} ok, ${errCount} errors\n`);

  // ── Write to Firebase ──

  const payload = {
    fetchedAt: new Date().toISOString(),
    ...results,
  };

  await patchFirebase('analytics/latest/igDemographics', payload);
  console.log('  ✓ Wrote to analytics/latest/igDemographics');

  const dateKey = new Date().toISOString().slice(0, 10);
  await patchFirebase(`analytics/history/${dateKey}/igDemographics`, payload);
  console.log(`  ✓ Snapshotted to analytics/history/${dateKey}/igDemographics`);

  console.log('\n✅ IG Demographics & Posting Times scrape complete\n');
}

main().catch(err => {
  console.error('\n❌ Demographics scrape failed:', err);
  process.exit(1);
});
