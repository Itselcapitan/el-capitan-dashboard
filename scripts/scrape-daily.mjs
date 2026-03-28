/**
 * Daily Multi-Platform Scrape — Apify → Firebase
 *
 * Scrapes IG profile + posts, TikTok profile + posts, SC public profile.
 * Diff-based: only deeply processes new/changed content.
 * Computes deltas, generates categorized alerts, logs job metadata.
 *
 * Env vars: APIFY_TOKEN, FIREBASE_DB_URL
 */

import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';

const IG_USERNAME = 'itselcapitan_';
const TT_USERNAME = 'itselcapitan';
const SC_URL = 'https://soundcloud.com/itselcapitan';

const POSTS_PER_WEEK_TARGET = 5;

if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN environment variable');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });

// ─── Firebase helpers ───────────────────────────────────────────

async function readFirebase(path) {
  const url = `${FIREBASE_DB_URL}/${path}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function writeFirebase(path, data) {
  const url = `${FIREBASE_DB_URL}/${path}.json`;
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

// ─── Scrapers ───────────────────────────────────────────────────

async function scrapeIG() {
  console.log('\n📸 Scraping Instagram...');
  const [profileRun, postsRun] = await Promise.all([
    client.actor('apify/instagram-profile-scraper').call({ usernames: [IG_USERNAME] }),
    client.actor('apify/instagram-post-scraper').call({ username: [IG_USERNAME], resultsLimit: 12 }),
  ]);

  const { items: profiles } = await client.dataset(profileRun.defaultDatasetId).listItems();
  const { items: posts } = await client.dataset(postsRun.defaultDatasetId).listItems();

  if (!profiles.length) throw new Error('No IG profile data');
  const p = profiles[0];

  const totalLikes = posts.reduce((s, x) => s + (x.likesCount || 0), 0);
  const totalComments = posts.reduce((s, x) => s + (x.commentsCount || 0), 0);
  const engRate = p.followersCount > 0
    ? ((totalLikes + totalComments) / posts.length / p.followersCount * 100)
    : 0;

  console.log(`  IG: ${p.followersCount} followers, ${posts.length} posts scraped, ${engRate.toFixed(1)}% eng`);

  return {
    ig: {
      followers: p.followersCount || 0,
      following: p.followsCount || 0,
      posts: p.postsCount || 0,
      engRate: parseFloat(engRate.toFixed(1)),
      avgLikes: posts.length ? Math.round(totalLikes / posts.length) : 0,
      avgComments: posts.length ? Math.round(totalComments / posts.length) : 0,
    },
    igPosts: posts.map(x => ({
      id: x.id || x.shortCode,
      shortCode: x.shortCode,
      caption: (x.caption || '').slice(0, 200),
      likesCount: x.likesCount || 0,
      commentsCount: x.commentsCount || 0,
      type: x.type || x.productType || 'unknown',
      timestamp: x.timestamp,
      url: x.url,
      hashtags: x.hashtags || [],
    })),
  };
}

async function scrapeTikTok() {
  console.log('\n🎵 Scraping TikTok...');
  const run = await client.actor('clockworks/tiktok-profile-scraper').call({
    profiles: [TT_USERNAME],
    resultsPerPage: 12,
    profileSorting: 'latest',
  });

  const { items: posts } = await client.dataset(run.defaultDatasetId).listItems();
  if (!posts.length) {
    console.log('  TikTok: no posts found');
    return { tiktok: { followers: 0, hearts: 0, videos: 0, avgPlays: 0, avgLikes: 0 }, ttPosts: [] };
  }

  const author = posts[0].authorMeta || {};
  const totalPlays = posts.reduce((s, x) => s + (x.playCount || 0), 0);
  const totalLikes = posts.reduce((s, x) => s + (x.diggCount || 0), 0);

  console.log(`  TT: ${author.fans} followers, ${author.heart} hearts, ${posts.length} posts scraped`);

  return {
    tiktok: {
      followers: author.fans || 0,
      hearts: author.heart || 0,
      videos: author.video || 0,
      following: author.following || 0,
      avgPlays: posts.length ? Math.round(totalPlays / posts.length) : 0,
      avgLikes: posts.length ? Math.round(totalLikes / posts.length) : 0,
    },
    ttPosts: posts.map(x => ({
      id: x.id,
      text: (x.text || '').slice(0, 200),
      playCount: x.playCount || 0,
      diggCount: x.diggCount || 0,
      shareCount: x.shareCount || 0,
      commentCount: x.commentCount || 0,
      collectCount: x.collectCount || 0,
      createTimeISO: x.createTimeISO,
      url: x.webVideoUrl,
      hashtags: (x.hashtags || []).map(h => h.name),
    })),
  };
}

async function scrapeSoundCloud() {
  // PUBLIC DATA ONLY — no Artist Pro analytics, no login credentials
  // Artist Pro analytics should be added manually via screenshots
  console.log('\n🔊 Scraping SoundCloud (public profile only)...');
  try {
    const run = await client.actor('cryptosignals/soundcloud-scraper').call({
      action: 'user',
      url: SC_URL,
      maxItems: 1,
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (!items.length) {
      console.log('  SC: no profile data');
      return { sc: { followers: 0, following: 0, tracks: 0 } };
    }

    const u = items[0];
    console.log(`  SC: ${u.followers} followers, ${u.tracks} tracks`);

    return {
      sc: {
        followers: u.followers || 0,
        following: u.following || 0,
        tracks: u.tracks || 0,
        // trackList and likes are unreliable from this scraper — excluded
      },
    };
  } catch (err) {
    console.error('  SC scrape failed (non-critical):', err.message);
    return { sc: { followers: 0, following: 0, tracks: 0 } };
  }
}

// ─── Diff-based processing ──────────────────────────────────────

function diffPosts(newPosts, previousPosts, idKey = 'id') {
  const prevMap = new Map((previousPosts || []).map(p => [p[idKey] || p.shortCode, p]));

  const newItems = [];
  const updated = [];
  const unchanged = [];

  for (const post of newPosts) {
    const key = post[idKey] || post.shortCode;
    const prev = prevMap.get(key);
    if (!prev) {
      newItems.push(post);
    } else {
      // Check if engagement changed >10%
      const prevEng = (prev.likesCount || prev.diggCount || 0);
      const currEng = (post.likesCount || post.diggCount || 0);
      const change = prevEng > 0 ? Math.abs((currEng - prevEng) / prevEng) : (currEng > 0 ? 1 : 0);
      if (change > 0.1) {
        updated.push(post);
      } else {
        unchanged.push(post);
      }
    }
  }

  return { newItems, updated, unchanged, newCount: newItems.length, updatedCount: updated.length };
}

// ─── Delta calculations ─────────────────────────────────────────

function computeDeltas(current, previous) {
  if (!previous) return null;

  const delta = (curr, prev, key) => {
    const c = curr?.[key] ?? 0;
    const p = prev?.[key] ?? 0;
    return { value: c - p, pct: p > 0 ? parseFloat(((c - p) / p * 100).toFixed(1)) : 0 };
  };

  return {
    ig: {
      followers: delta(current.ig, previous.ig, 'followers'),
      engRate: delta(current.ig, previous.ig, 'engRate'),
      avgLikes: delta(current.ig, previous.ig, 'avgLikes'),
    },
    tiktok: {
      followers: delta(current.tiktok, previous.tiktok, 'followers'),
      hearts: delta(current.tiktok, previous.tiktok, 'hearts'),
      avgPlays: delta(current.tiktok, previous.tiktok, 'avgPlays'),
    },
    sc: {
      followers: delta(current.sc, previous.sc, 'followers'),
    },
  };
}

// ─── Categorized smart alerts ───────────────────────────────────

function generateAlerts(data, deltas, previousData, igDiff, ttDiff) {
  const alerts = [];

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentIGPosts = (data.igPosts || []).filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > weekAgo;
  }).length;
  const recentTTPosts = (data.ttPosts || []).filter(p => {
    const ts = p.createTimeISO ? new Date(p.createTimeISO).getTime() : 0;
    return ts > weekAgo;
  }).length;
  const totalWeekPosts = recentIGPosts + recentTTPosts;

  // ── RISK alerts ──

  if (totalWeekPosts < POSTS_PER_WEEK_TARGET) {
    alerts.push({
      level: totalWeekPosts <= 2 ? 'red' : 'amber',
      category: 'risk',
      type: 'cadence',
      msg: `Only ${totalWeekPosts}/${POSTS_PER_WEEK_TARGET} posts this week (${recentIGPosts} IG + ${recentTTPosts} TT)`,
    });
  }

  if (deltas) {
    if (deltas.ig.followers.value < -3) {
      alerts.push({ level: 'red', category: 'risk', type: 'growth',
        msg: `IG lost ${Math.abs(deltas.ig.followers.value)} followers today` });
    }
    if (deltas.ig.engRate.value < -1) {
      alerts.push({ level: 'amber', category: 'risk', type: 'engagement',
        msg: `IG engagement rate dropped ${deltas.ig.engRate.value.toFixed(1)}% (now ${data.ig.engRate}%)` });
    }
    if (deltas.tiktok.followers && deltas.tiktok.followers.value < -3) {
      alerts.push({ level: 'amber', category: 'risk', type: 'growth',
        msg: `TT lost ${Math.abs(deltas.tiktok.followers.value)} followers today` });
    }
  }

  // ── PERFORMANCE alerts ──

  // Breakout posts — only flag NEW or UPDATED posts (diff-based)
  const avgIG = data.ig?.avgLikes || 1;
  const newOrUpdatedIG = [...(igDiff?.newItems || []), ...(igDiff?.updated || [])];
  newOrUpdatedIG.filter(p => p.likesCount > avgIG * 2).forEach(p => {
    alerts.push({
      level: 'green', category: 'performance', type: 'breakout',
      msg: `IG breakout: "${(p.caption || '').slice(0, 40)}..." — ${p.likesCount} likes (${Math.round(p.likesCount / avgIG)}x avg)`,
    });
  });

  const avgTT = data.tiktok?.avgPlays || 1;
  const newOrUpdatedTT = [...(ttDiff?.newItems || []), ...(ttDiff?.updated || [])];
  newOrUpdatedTT.filter(p => p.playCount > avgTT * 2).forEach(p => {
    alerts.push({
      level: 'green', category: 'performance', type: 'breakout',
      msg: `TT breakout: "${(p.text || '').slice(0, 40)}..." — ${p.playCount} plays (${Math.round(p.playCount / avgTT)}x avg)`,
    });
  });

  if (deltas) {
    if (deltas.ig.followers.value > 5) {
      alerts.push({ level: 'green', category: 'performance', type: 'growth',
        msg: `IG +${deltas.ig.followers.value} followers today` });
    }
    if (deltas.tiktok.followers && deltas.tiktok.followers.value > 3) {
      alerts.push({ level: 'green', category: 'performance', type: 'growth',
        msg: `TT +${deltas.tiktok.followers.value} followers today` });
    }
  }

  // ── OPPORTUNITY alerts ──

  // TikTok outperforming IG
  if (data.tiktok?.avgPlays > 0 && data.ig?.avgLikes > 0) {
    const ttEngPerPost = data.tiktok.avgPlays + (data.tiktok.avgLikes || 0);
    const igEngPerPost = data.ig.avgLikes + data.ig.avgComments;
    if (ttEngPerPost > igEngPerPost * 3) {
      alerts.push({
        level: 'green', category: 'opportunity', type: 'platform',
        msg: `TikTok outperforming IG ${Math.round(ttEngPerPost / igEngPerPost)}x per post — shift more content there`,
      });
    }
  }

  // Profile visits high but link clicks weak (from hardcoded MSE baseline)
  if (data.ig.profileVisitRate > 15 && data.ig.linkClickRate && data.ig.linkClickRate < 2) {
    alerts.push({
      level: 'amber', category: 'opportunity', type: 'conversion',
      msg: `${data.ig.profileVisitRate}% profile visit rate but only ${data.ig.linkClickRate}% link clicks — fix bio CTA`,
    });
  }

  // Breakout post has no follow-up content planned
  const breakoutPosts = newOrUpdatedIG.filter(p => p.likesCount > avgIG * 2);
  if (breakoutPosts.length > 0) {
    alerts.push({
      level: 'amber', category: 'opportunity', type: 'follow-up',
      msg: `${breakoutPosts.length} breakout post(s) — create follow-up content to capitalize`,
    });
  }

  return alerts;
}

// ─── Cost estimation ────────────────────────────────────────────

function estimateCost(igData, ttData) {
  // Apify pricing (approximate):
  // IG profile scraper: ~$0.003/profile
  // IG post scraper: ~$0.0017/post
  // TikTok profile scraper: ~$0.004/result
  // SC scraper: free
  const igCost = 0.003 + (igData.igPosts?.length || 0) * 0.0017;
  const ttCost = (ttData.ttPosts?.length || 0) * 0.004;
  return parseFloat((igCost + ttCost).toFixed(4));
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10);

  console.log(`\n🚀 Daily scrape starting — ${dateKey}\n`);

  // Get previous data for diffs + deltas
  const previousData = await readFirebase('analytics/latest');

  // Run all scrapers in parallel
  const [igData, ttData, scData] = await Promise.all([
    scrapeIG(),
    scrapeTikTok(),
    scrapeSoundCloud(),
  ]);

  // Diff-based processing
  const igDiff = diffPosts(igData.igPosts, previousData?.igPosts, 'id');
  const ttDiff = diffPosts(ttData.ttPosts, previousData?.ttPosts, 'id');

  console.log(`\n📋 Diff: IG ${igDiff.newCount} new, ${igDiff.updatedCount} updated | TT ${ttDiff.newCount} new, ${ttDiff.updatedCount} updated`);

  // Merge all platform data
  const allData = {
    scrapedAt: now,
    ig: igData.ig,
    igPosts: igData.igPosts,
    tiktok: ttData.tiktok,
    ttPosts: ttData.ttPosts,
    sc: scData.sc,
  };

  // Compute deltas
  const deltas = computeDeltas(allData, previousData);
  allData.deltas = deltas;

  // Generate categorized alerts (using diff data for smarter detection)
  const alerts = generateAlerts(allData, deltas, previousData, igDiff, ttDiff);
  allData.alerts = alerts;

  console.log(`\n📊 Deltas:`, JSON.stringify(deltas, null, 2));
  console.log(`\n🚨 Alerts (${alerts.length}):`);
  ['performance', 'risk', 'opportunity'].forEach(cat => {
    const catAlerts = alerts.filter(a => a.category === cat);
    if (catAlerts.length) {
      console.log(`  ${cat.toUpperCase()}:`);
      catAlerts.forEach(a => console.log(`    [${a.level}] ${a.msg}`));
    }
  });

  // History snapshot (lighter — no posts array)
  const historySnapshot = {
    scrapedAt: now,
    ig: igData.ig,
    tiktok: ttData.tiktok,
    sc: scData.sc,
    deltas,
    alertCount: alerts.length,
  };

  const cost = estimateCost(igData, ttData);
  const duration = Date.now() - startMs;

  // Write data + job log to Firebase
  console.log('\n💾 Writing to Firebase...');
  await Promise.all([
    writeFirebase('analytics/latest', allData),
    writeFirebase(`analytics/history/${dateKey}`, historySnapshot),
    writeFirebase(`jobs/daily/${dateKey}`, {
      status: 'success',
      startedAt: now,
      completedAt: new Date().toISOString(),
      duration,
      records: {
        igPosts: igData.igPosts.length,
        ttPosts: ttData.ttPosts.length,
        scProfile: 1,
      },
      diff: {
        igNew: igDiff.newCount,
        igUpdated: igDiff.updatedCount,
        ttNew: ttDiff.newCount,
        ttUpdated: ttDiff.updatedCount,
      },
      estimatedCost: cost,
      alertCount: alerts.length,
      error: null,
    }),
  ]);

  console.log(`\n✅ Done! Cost: ~$${cost} | Duration: ${(duration / 1000).toFixed(1)}s | Alerts: ${alerts.length}`);
}

main().catch(async err => {
  console.error('❌ Scrape failed:', err);
  // Log failure to Firebase
  const dateKey = new Date().toISOString().slice(0, 10);
  try {
    await writeFirebase(`jobs/daily/${dateKey}`, {
      status: 'failed',
      startedAt: new Date().toISOString(),
      error: err.message,
    });
  } catch (_) { /* best effort */ }
  process.exit(1);
});
