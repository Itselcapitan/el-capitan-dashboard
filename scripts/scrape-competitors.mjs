/**
 * Bi-Weekly Competitor Reel Scrape — Apify → Firebase
 *
 * REELS-FIRST: Scrapes latest content, filters to prefer reels.
 * ACCUMULATION: Merges new reels into a persistent pool (competitors/allReels)
 *   keyed by shortCode — never loses historical data.
 * HOOKS: Extracts the first 10-12 words of each reel caption as a hook.
 * TOP PERFORMERS: Maintains a hall-of-fame capped at MAX_POOL_SIZE reels,
 *   dropping oldest low-performers when full.
 * Runs Tue + Fri via GitHub Actions.
 *
 * Env vars: APIFY_TOKEN, FIREBASE_DB_URL, FIREBASE_DB_SECRET
 */

import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';

// Maximum reels to keep in the accumulated pool.
// At 5 reels × 8 accounts × 2 scrapes/week = ~80 new reels/week.
// 400 ≈ ~5 weeks of full history.
const MAX_POOL_SIZE = 400;

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

// ─── Reel detection ─────────────────────────────────────────────

function isReel(post) {
  const type = (post.type || '').toLowerCase();
  const product = (post.productType || '').toLowerCase();
  return type.includes('video') || product.includes('reel') || product.includes('clip');
}

// ─── Hook extraction ────────────────────────────────────────────
// Extract the opening hook from a reel caption: first 10-12 words,
// stopping at punctuation or a newline so it reads naturally.

function extractHook(caption) {
  if (!caption) return '';
  // Take up to the first newline or 200 chars
  const firstLine = caption.split('\n')[0].trim().slice(0, 200);
  const words = firstLine.split(/\s+/);
  // Grab 10-12 words. If word 10 ends a sentence, stop there; otherwise go to 12.
  let hookWords = words.slice(0, 10);
  const joined = hookWords.join(' ');
  // Extend if the 10th word doesn't end with punctuation and we have more words
  if (words.length > 10 && !/[.!?,]$/.test(hookWords[hookWords.length - 1])) {
    hookWords = words.slice(0, Math.min(12, words.length));
  }
  return hookWords.join(' ').replace(/[,]$/, ''); // trim trailing comma
}

// ─── Scraper ────────────────────────────────────────────────────

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
    hook: extractHook(p.caption || ''),
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

// ─── Pool accumulation ──────────────────────────────────────────
// The pool is stored in Firebase as competitors/allReels — a flat object
// keyed by shortCode. Each entry includes firstSeenAt so we know when
// we first discovered the reel.

function mergeIntoPool(existingPool, newReels, tierMap) {
  const pool = { ...(existingPool || {}) };
  const now = new Date().toISOString();
  let addedCount = 0;
  let updatedCount = 0;

  for (const reel of newReels) {
    if (!reel.shortCode) continue;
    const key = reel.shortCode;
    const tier = tierMap[reel.ownerUsername] || 'STUDY';

    if (pool[key]) {
      // Update engagement counts (they grow over time)
      const prev = pool[key];
      const engChanged =
        reel.likesCount !== prev.likesCount ||
        reel.commentsCount !== prev.commentsCount;
      if (engChanged) {
        pool[key] = {
          ...prev,
          likesCount: reel.likesCount,
          commentsCount: reel.commentsCount,
          lastUpdatedAt: now,
        };
        updatedCount++;
      }
    } else {
      // New reel — store full data
      pool[key] = {
        shortCode: reel.shortCode,
        ownerUsername: reel.ownerUsername,
        tier,
        caption: reel.caption,
        hook: reel.hook,
        likesCount: reel.likesCount,
        commentsCount: reel.commentsCount,
        isReel: reel.isReel,
        timestamp: reel.timestamp,
        url: reel.url,
        hashtags: reel.hashtags,
        firstSeenAt: now,
        lastUpdatedAt: now,
      };
      addedCount++;
    }
  }

  return { pool, addedCount, updatedCount };
}

// Prune pool to MAX_POOL_SIZE, keeping:
// 1. Top performers (highest likes+comments) — always safe
// 2. Most recently seen reels — ensure recency
// 3. At least 1 reel per competitor account
function prunePool(pool, maxSize) {
  const entries = Object.entries(pool);
  if (entries.length <= maxSize) return pool;

  // Score each entry: engagement + recency bonus
  const scored = entries.map(([key, r]) => {
    const engScore = (r.likesCount || 0) + (r.commentsCount || 0) * 3;
    const ageMs = Date.now() - new Date(r.firstSeenAt || 0).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 30 - ageDays) * 100; // 0-3000 bonus for <30 days old
    return { key, r, score: engScore + recencyBonus };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Keep top maxSize entries
  const kept = new Set(scored.slice(0, maxSize).map(e => e.key));

  // Ensure at least 1 per account (protect small accounts)
  const accountBestMap = {};
  for (const { key, r } of scored) {
    const acct = r.ownerUsername;
    if (!accountBestMap[acct]) {
      accountBestMap[acct] = key;
      kept.add(key);
    }
  }

  const pruned = {};
  for (const key of kept) {
    pruned[key] = pool[key];
  }

  const removedCount = entries.length - Object.keys(pruned).length;
  if (removedCount > 0) {
    console.log(`  ✂️  Pruned ${removedCount} low-performing old reels from pool`);
  }
  return pruned;
}

// ─── Diff against previous scrape ───────────────────────────────

function diffReels(newReels, previousReels) {
  const prevCodes = new Set((previousReels || []).map(r => r.shortCode));
  const newItems = newReels.filter(r => !prevCodes.has(r.shortCode));
  const existing = newReels.filter(r => prevCodes.has(r.shortCode));

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
// Runs on the FULL accumulated pool for richer insights.

function analyzePatterns(allReels) {
  const sorted = [...allReels].sort((a, b) =>
    (b.likesCount + b.commentsCount) - (a.likesCount + a.commentsCount)
  );
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

  // Posting day/hour distribution (reels only, from timestamp)
  const dayDist = Array(7).fill(0);   // Sun-Sat
  const hourDist = Array(24).fill(0); // 0-23 UTC
  allReels.filter(r => r.isReel && r.timestamp).forEach(r => {
    const d = new Date(r.timestamp);
    dayDist[d.getUTCDay()]++;
    hourDist[d.getUTCHours()]++;
  });
  const peakDay = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayDist.indexOf(Math.max(...dayDist))];
  const peakHour = hourDist.indexOf(Math.max(...hourDist));

  // Top hooks from highest-engagement reels
  const topHooks = sorted.slice(0, 15)
    .filter(r => r.hook)
    .map(r => ({ hook: r.hook, account: r.ownerUsername, likes: r.likesCount }));

  return {
    top10,
    topHashtags,
    accountAvgs,
    totalReels: allReels.length,
    reelCount,
    postCount,
    dayDist,
    hourDist,
    peakDay,
    peakHour,
    topHooks,
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10);

  console.log(`\n🎬 Competitor REEL scrape starting — ${dateKey}\n`);

  // Build a tier lookup map for merge
  const tierMap = {};
  COMPETITORS.forEach(c => { tierMap[c.handle] = c.tier; });

  // Load previous snapshot (for diff) and accumulated pool
  const [previousData, existingPoolRaw] = await Promise.all([
    readFirebase('competitors/latest'),
    readFirebase('competitors/allReels'),
  ]);

  const existingPool = existingPoolRaw || {};
  const existingPoolSize = Object.keys(existingPool).length;
  console.log(`📦 Existing reel pool: ${existingPoolSize} reels\n`);

  // Scrape competitors sequentially to avoid rate limits
  const freshReels = [];
  let failCount = 0;

  for (const comp of COMPETITORS) {
    try {
      const content = await scrapeCompetitorContent(comp.handle);
      content.forEach(r => { r.tier = comp.tier; });
      freshReels.push(...content);
      const reelN = content.filter(r => r.isReel).length;
      console.log(`    Got ${content.length} items (${reelN} reels) from @${comp.handle}`);
    } catch (err) {
      failCount++;
      console.error(`    Failed @${comp.handle}: ${err.message}`);
    }
  }

  console.log(`\n📊 Fresh scrape: ${freshReels.length} items (${freshReels.filter(r => r.isReel).length} reels)`);

  // Diff against previous snapshot
  const diff = diffReels(freshReels, previousData?.reels);
  console.log(`📋 Snapshot diff: ${diff.newCount} new reels, ${diff.updatedCount} updated\n`);

  // Merge into accumulated pool
  const { pool: mergedPool, addedCount, updatedCount: poolUpdated } = mergeIntoPool(existingPool, freshReels, tierMap);
  console.log(`➕ Pool: +${addedCount} new, ${poolUpdated} updated engagements`);

  // Prune to cap
  const prunedPool = prunePool(mergedPool, MAX_POOL_SIZE);
  const poolSize = Object.keys(prunedPool).length;
  console.log(`🏊 Pool size after merge: ${poolSize} reels`);

  // Analyze patterns on FULL accumulated pool (not just fresh scrape)
  const poolReels = Object.values(prunedPool);
  const patterns = analyzePatterns(poolReels);
  // Also analyze fresh-only patterns for the snapshot
  const freshPatterns = analyzePatterns(freshReels);

  const cost = freshReels.length * 0.0017; // IG post scraper pricing
  const duration = Date.now() - startMs;

  // ── Write to Firebase ──
  console.log('\n💾 Writing to Firebase...');

  const latestPayload = {
    scrapedAt: now,
    competitors: COMPETITORS,
    reels: freshReels,                  // current snapshot (this scrape only)
    patterns: freshPatterns,            // patterns on current snapshot
    poolPatterns: patterns,             // patterns on FULL accumulated pool
    poolSize,
    diff: { newCount: diff.newCount, updatedCount: diff.updatedCount },
  };

  await Promise.all([
    // Current snapshot (backward compat — strategy script reads this)
    writeFirebase('competitors/latest', latestPayload),
    // Accumulated reel pool (keyed by shortCode for dedup)
    writeFirebase('competitors/allReels', prunedPool),
    // Historical summary
    writeFirebase(`competitors/history/${dateKey}`, {
      scrapedAt: now,
      patterns: freshPatterns,
      poolPatterns: patterns,
      reelCount: freshReels.length,
      poolSize,
      diff: { newCount: diff.newCount, updatedCount: diff.updatedCount },
    }),
    // Job log
    writeFirebase(`jobs/competitors/${dateKey}`, {
      status: failCount === COMPETITORS.length ? 'failed' : 'success',
      startedAt: now,
      completedAt: new Date().toISOString(),
      duration,
      records: {
        freshReels: freshReels.length,
        poolSize,
        newToPool: addedCount,
        accounts: COMPETITORS.length - failCount,
      },
      diff: { newReels: diff.newCount, updatedReels: diff.updatedCount },
      estimatedCost: parseFloat(cost.toFixed(4)),
      failedAccounts: failCount,
      error: null,
    }),
  ]);

  console.log(`\n✅ Done!`);
  console.log(`   Fresh reels: ${freshReels.length} (${freshPatterns.reelCount} reels)`);
  console.log(`   Pool total: ${poolSize} accumulated reels | +${addedCount} new this run`);
  console.log(`   Cost: ~$${cost.toFixed(4)} | Peak day: ${patterns.peakDay} | Peak hour: ${patterns.peakHour}:00 UTC`);
  console.log(`   Top hooks:`);
  patterns.topHooks.slice(0, 3).forEach(h => console.log(`     "@${h.account}": ${h.hook} (${h.likes} likes)`));
  console.log(`   Top accounts:`, patterns.accountAvgs.slice(0, 3).map(a => `@${a.account} (${a.avgEng} avg, ${a.reelPct}% reels)`).join(', '));
}

main().catch(async err => {
  console.error('❌ Competitor reel scrape failed:', err);
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
