/**
 * Bi-Weekly Competitor Scrape — Apify → Firebase
 *
 * Reels-first: scrapes latest content, filters to prefer reels.
 * Diff-based: only deeply processes new/changed reels.
 * Identifies winning hooks, CTAs, and format trends.
 * Runs Tue + Fri via GitHub Actions.
 *
 * Env vars: APIFY_TOKEN, FIREBASE_DB_URL, FIREBASE_DB_SECRET
 */

import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';

if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN environment variable');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });

const COMPETITORS = [
  { handle: 'chalantmusic', tier: 'HIGHEST' },
  { handle: 'wally_sounds', tier: 'HIGHEST' },
  { handle: 'zachhzachhzachh', tier: 'HIGHEST' },
  { handle: 'teeeebbbbb', tier: 'HIGH' },
  { handle: 'keepdansyn', tier: 'HIGH' },
  { handle: 'bolothedj', tier: 'STUDY' },
  { handle: 'sidequestdj', tier: 'HIGH' },
  { handle: 'lukealexvnder', tier: 'STUDY' },
];

// ─── Firebase helpers ───────────────────────────────────────────

async function readFirebase(path) {
  const auth = FIREBASE_DB_SECRET ? `?auth=${FIREBASE_DB_SECRET}` : '';
  const url = `${FIREBASE_DB_URL}/${path}.json${auth}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function writeFirebase(path, data) {
  const auth = FIREBASE_DB_SECRET ? `?auth=${FIREBASE_DB_SECRET}` : '';
  const url = `${FIREBASE_DB_URL}/${path}.json${auth}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase PUT ${path} failed: ${res.status} ${text}`);
  }
  console.log(`  ✓ Wrote ${path}`);
}

// ─── Reels-first scraper ────────────────────────────────────────

function isReel(post) {
  const type = (post.type || '').toLowerCase();
  const product = (post.productType || '').toLowerCase();
  return type.includes('video') || product.includes('reel') || product.includes('clip');
}

async function scrapeCompetitorContent(handle) {
  console.log(`  Scraping @${handle}...`);
  const run = await client.actor('apify/instagram-post-scraper').call({
    username: [handle],
    resultsLimit: 10, // Fetch more to filter for reels
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const reels = items.filter(isReel);

  // Prefer reels — fall back to all posts only if <3 reels found
  const results = reels.length >= 3 ? reels.slice(0, 5) : items.slice(0, 5);

  return results.map(p => ({
    shortCode: p.shortCode,
    caption: (p.caption || '').slice(0, 300),
    likesCount: p.likesCount || 0,
    commentsCount: p.commentsCount || 0,
    type: p.type || p.productType || 'unknown',
    isReel: isReel(p),
    timestamp: p.timestamp,
    url: p.url,
    hashtags: p.hashtags || [],
    ownerUsername: p.ownerUsername || handle,
  }));
}

// ─── Diff against previous scrape ───────────────────────────────

function diffReels(newReels, previousReels) {
  const prevCodes = new Set((previousReels || []).map(r => r.shortCode));
  const newItems = newReels.filter(r => !prevCodes.has(r.shortCode));
  const existing = newReels.filter(r => prevCodes.has(r.shortCode));

  // Check for significant engagement changes on existing reels
  const prevMap = new Map((previousReels || []).map(r => [r.shortCode, r]));
  const updated = existing.filter(r => {
    const prev = prevMap.get(r.shortCode);
    if (!prev) return false;
    const change = prev.likesCount > 0
      ? Math.abs((r.likesCount - prev.likesCount) / prev.likesCount)
      : (r.likesCount > 0 ? 1 : 0);
    return change > 0.1;
  });

  return { newItems, updated, newCount: newItems.length, updatedCount: updated.length };
}

// ─── Pattern analysis ───────────────────────────────────────────

function analyzePatterns(allReels) {
  const sorted = [...allReels].sort((a, b) => (b.likesCount + b.commentsCount) - (a.likesCount + a.commentsCount));
  const top10 = sorted.slice(0, 10);

  // Reel vs non-reel breakdown
  const reelCount = allReels.filter(r => r.isReel).length;
  const postCount = allReels.length - reelCount;

  // Hashtag frequency
  const hashCounts = {};
  allReels.forEach(r => {
    (r.hashtags || []).forEach(h => {
      const tag = typeof h === 'string' ? h : h.name || h;
      hashCounts[tag] = (hashCounts[tag] || 0) + 1;
    });
  });
  const topHashtags = Object.entries(hashCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Avg engagement by account
  const byAccount = {};
  allReels.forEach(r => {
    const acct = r.ownerUsername;
    if (!byAccount[acct]) byAccount[acct] = { posts: 0, reels: 0, totalEng: 0 };
    byAccount[acct].posts++;
    if (r.isReel) byAccount[acct].reels++;
    byAccount[acct].totalEng += (r.likesCount + r.commentsCount);
  });
  const accountAvgs = Object.entries(byAccount).map(([acct, d]) => ({
    account: acct,
    avgEng: Math.round(d.totalEng / d.posts),
    posts: d.posts,
    reels: d.reels,
    reelPct: d.posts > 0 ? Math.round(d.reels / d.posts * 100) : 0,
  })).sort((a, b) => b.avgEng - a.avgEng);

  return { top10, topHashtags, accountAvgs, totalReels: allReels.length, reelCount, postCount };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10);

  console.log(`\n🔍 Competitor scrape starting — ${dateKey}\n`);

  // Get previous data for diff
  const previousData = await readFirebase('competitors/latest');

  // Scrape competitors sequentially to avoid rate limits
  const allReels = [];
  let failCount = 0;
  for (const comp of COMPETITORS) {
    try {
      const content = await scrapeCompetitorContent(comp.handle);
      content.forEach(r => { r.tier = comp.tier; });
      allReels.push(...content);
      const reelN = content.filter(r => r.isReel).length;
      console.log(`    Got ${content.length} items (${reelN} reels) from @${comp.handle}`);
    } catch (err) {
      failCount++;
      console.error(`    Failed @${comp.handle}: ${err.message}`);
    }
  }

  console.log(`\n📊 Total scraped: ${allReels.length} items`);

  // Diff against previous scrape
  const diff = diffReels(allReels, previousData?.reels);
  console.log(`📋 Diff: ${diff.newCount} new, ${diff.updatedCount} updated`);

  // Analyze patterns
  const patterns = analyzePatterns(allReels);

  const cost = allReels.length * 0.0017; // IG post scraper pricing

  const payload = {
    scrapedAt: now,
    competitors: COMPETITORS,
    reels: allReels,
    patterns,
    diff: { newCount: diff.newCount, updatedCount: diff.updatedCount },
  };

  const duration = Date.now() - startMs;

  console.log('\n💾 Writing to Firebase...');
  await Promise.all([
    writeFirebase('competitors/latest', payload),
    writeFirebase(`competitors/history/${dateKey}`, {
      scrapedAt: now,
      patterns,
      reelCount: allReels.length,
      diff: { newCount: diff.newCount, updatedCount: diff.updatedCount },
    }),
    writeFirebase(`jobs/competitors/${dateKey}`, {
      status: failCount === COMPETITORS.length ? 'failed' : 'success',
      startedAt: now,
      completedAt: new Date().toISOString(),
      duration,
      records: { reels: allReels.length, accounts: COMPETITORS.length - failCount },
      diff: { newReels: diff.newCount, updatedReels: diff.updatedCount },
      estimatedCost: parseFloat(cost.toFixed(4)),
      failedAccounts: failCount,
      error: null,
    }),
  ]);

  console.log(`\n✅ Done! ${allReels.length} items (${patterns.reelCount} reels) | Cost: ~$${cost.toFixed(4)} | ${diff.newCount} new`);
  console.log(`  Top accounts:`, patterns.accountAvgs.slice(0, 3).map(a => `@${a.account} (${a.avgEng} avg, ${a.reelPct}% reels)`).join(', '));
}

main().catch(async err => {
  console.error('❌ Competitor scrape failed:', err);
  const dateKey = new Date().toISOString().slice(0, 10);
  try {
    await writeFirebase(`jobs/competitors/${dateKey}`, {
      status: 'failed',
      startedAt: new Date().toISOString(),
      error: err.message,
    });
  } catch (_) { /* best effort */ }
  process.exit(1);
});
