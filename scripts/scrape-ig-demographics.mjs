/**
 * IG Demographics & Optimal Posting Times — Meta Graph API → Firebase
 *
 * Pulls audience demographics and online-followers timing data:
 *   - online_followers (hour-by-hour when followers are active)
 *   - audience_gender_age (gender + age range breakdown)
 *   - audience_city (top cities)
 *   - audience_country (top countries)
 *
 * Makes exactly 5 API calls. Writes structured results to Firebase
 * for the dashboard's "Best Posting Times" heatmap and demographics
 * cards.
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
  const params = {
    metric,
    access_token: FB_PAGE_ACCESS_TOKEN,
  };
  if (opts.useAggregate) {
    params.metric_type = 'total_value';
    params.period = 'day';
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

  // Find peak hour
  let peakHour = 0;
  let peakCount = 0;
  for (const [h, count] of Object.entries(hourly)) {
    if (count > peakCount) {
      peakCount = count;
      peakHour = Number(h);
    }
  }

  // Build a 3-hour peak window centered on (or starting at) peak hour
  const windowStart = peakHour;
  const windowEnd = (peakHour + 3) % 24;
  const peakWindow = `${formatHour(windowStart)}-${formatHour(windowEnd)}`;

  return {
    hourly,
    peakHour,
    peakWindow,
  };
}

function parseGenderAge(json) {
  const results = json.data?.[0]?.total_value?.breakdowns?.[0]?.results;
  if (!results?.length) return { error: 'no breakdown results' };

  let maleTotal = 0;
  let femaleTotal = 0;
  let otherTotal = 0;
  const ageBuckets = {};

  for (const r of results) {
    const dim = r.dimension_values?.[0] || '';
    const val = r.value || 0;
    // Format: "F.18-24", "M.25-34", "U.35-44"
    const [gender, ageRange] = dim.split('.');

    if (gender === 'M') maleTotal += val;
    else if (gender === 'F') femaleTotal += val;
    else otherTotal += val;

    if (ageRange) {
      ageBuckets[ageRange] = (ageBuckets[ageRange] || 0) + val;
    }
  }

  const grandTotal = maleTotal + femaleTotal + otherTotal;
  if (grandTotal === 0) return { error: 'zero total audience' };

  const gender = {
    male: Math.round((maleTotal / grandTotal) * 1000) / 10,
    female: Math.round((femaleTotal / grandTotal) * 1000) / 10,
  };

  const ageGroups = Object.entries(ageBuckets)
    .map(([range, count]) => ({
      range,
      pct: Math.round((count / grandTotal) * 1000) / 10,
    }))
    .sort((a, b) => b.pct - a.pct);

  return { gender, ageGroups };
}

function parseLocationMetric(json) {
  const results = json.data?.[0]?.total_value?.breakdowns?.[0]?.results;
  if (!results?.length) return { error: 'no breakdown results' };

  const grandTotal = results.reduce((s, r) => s + (r.value || 0), 0);
  if (grandTotal === 0) return { error: 'zero total' };

  return results
    .map(r => ({
      name: r.dimension_values?.[0] || 'Unknown',
      pct: Math.round((r.value / grandTotal) * 1000) / 10,
    }))
    .sort((a, b) => b.pct - a.pct);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n👥 IG Demographics & Posting Times scrape starting...');

  const targets = [
    { metric: 'online_followers', useAggregate: false },
    { metric: 'audience_gender_age', useAggregate: true },
    { metric: 'audience_city', useAggregate: true },
    { metric: 'audience_country', useAggregate: true },
    { metric: 'audience_locale', useAggregate: true },
  ];

  const results = {};
  let okCount = 0;
  let errCount = 0;

  // ── 1. online_followers (time-series) ──

  const onlineRaw = await fetchMetric('online_followers', { useAggregate: false });
  if (onlineRaw.error) {
    results.onlineFollowers = { error: onlineRaw.error };
    errCount += 1;
    console.warn(`  ✗ online_followers: ${onlineRaw.error.slice(0, 100)}`);
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

  // ── 2. audience_gender_age (aggregate) ──

  const genderAgeRaw = await fetchMetric('audience_gender_age', { useAggregate: true });
  if (genderAgeRaw.error) {
    results.gender = { error: genderAgeRaw.error };
    results.ageGroups = { error: genderAgeRaw.error };
    errCount += 1;
    console.warn(`  ✗ audience_gender_age: ${genderAgeRaw.error.slice(0, 100)}`);
  } else {
    const parsed = parseGenderAge(genderAgeRaw);
    if (parsed.error) {
      results.gender = { error: parsed.error };
      results.ageGroups = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ audience_gender_age: ${parsed.error}`);
    } else {
      results.gender = parsed.gender;
      results.ageGroups = parsed.ageGroups;
      okCount += 1;
      console.log(`  ✓ audience_gender_age: ${parsed.gender.male}% male, ${parsed.gender.female}% female, top age ${parsed.ageGroups[0]?.range} (${parsed.ageGroups[0]?.pct}%)`);
    }
  }

  // ── 3. audience_city (aggregate) ──

  const cityRaw = await fetchMetric('audience_city', { useAggregate: true });
  if (cityRaw.error) {
    results.topCities = { error: cityRaw.error };
    errCount += 1;
    console.warn(`  ✗ audience_city: ${cityRaw.error.slice(0, 100)}`);
  } else {
    const parsed = parseLocationMetric(cityRaw);
    if (parsed.error) {
      results.topCities = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ audience_city: ${parsed.error}`);
    } else {
      results.topCities = parsed;
      okCount += 1;
      console.log(`  ✓ audience_city: #1 ${parsed[0]?.name} (${parsed[0]?.pct}%), ${parsed.length} cities total`);
    }
  }

  // ── 4. audience_country (aggregate) ──

  const countryRaw = await fetchMetric('audience_country', { useAggregate: true });
  if (countryRaw.error) {
    results.topCountries = { error: countryRaw.error };
    errCount += 1;
    console.warn(`  ✗ audience_country: ${countryRaw.error.slice(0, 100)}`);
  } else {
    const parsed = parseLocationMetric(countryRaw);
    if (parsed.error) {
      results.topCountries = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ audience_country: ${parsed.error}`);
    } else {
      results.topCountries = parsed;
      okCount += 1;
      console.log(`  ✓ audience_country: #1 ${parsed[0]?.name} (${parsed[0]?.pct}%), ${parsed.length} countries total`);
    }
  }

  // ── 5. audience_locale (aggregate) ──

  const localeRaw = await fetchMetric('audience_locale', { useAggregate: true });
  if (localeRaw.error) {
    results.topLocales = { error: localeRaw.error };
    errCount += 1;
    console.warn(`  ✗ audience_locale: ${localeRaw.error.slice(0, 100)}`);
  } else {
    const parsed = parseLocationMetric(localeRaw);
    if (parsed.error) {
      results.topLocales = { error: parsed.error };
      errCount += 1;
      console.warn(`  ✗ audience_locale: ${parsed.error}`);
    } else {
      results.topLocales = parsed;
      okCount += 1;
      console.log(`  ✓ audience_locale: #1 ${parsed[0]?.name} (${parsed[0]?.pct}%), ${parsed.length} locales total`);
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
