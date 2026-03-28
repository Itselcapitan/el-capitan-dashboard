/**
 * Weekly Strategy Generator
 *
 * Reads all Firebase data (analytics, competitors, state),
 * generates a strategy brief with priorities, post ideas,
 * track focus, campaign action, and top alerts.
 *
 * Runs every Monday at 8:03 AM ET via GitHub Actions.
 * No Apify needed — only reads Firebase.
 *
 * Env vars: FIREBASE_DB_URL, FIREBASE_DB_SECRET
 */

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';

const POSTS_PER_WEEK_TARGET = 5;

// ─── Firebase helpers ───────────────────────────────────────────

async function readFirebase(path) {
  const url = `${FIREBASE_DB_URL}/${path}.json`;
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

// ─── Trend computation ──────────────────────────────────────────

function computeTrend(history, platform, metric, days) {
  if (!history) return 0;
  const entries = Object.values(history)
    .filter(h => h[platform] && h[platform][metric] != null)
    .sort((a, b) => (a.scrapedAt || '').localeCompare(b.scrapedAt || ''));

  const recent = entries.slice(-days);
  if (recent.length < 2) return 0;

  const first = recent[0][platform][metric];
  const last = recent[recent.length - 1][platform][metric];
  return last - first;
}

// ─── Strategy generators ────────────────────────────────────────

function computePriorities(latest, state, history) {
  const candidates = [];

  // Posting cadence gap
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentIG = (latest?.igPosts || []).filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > weekAgo;
  }).length;
  const recentTT = (latest?.ttPosts || []).filter(p => {
    const ts = p.createTimeISO ? new Date(p.createTimeISO).getTime() : 0;
    return ts > weekAgo;
  }).length;
  const weekPosts = recentIG + recentTT;

  if (weekPosts < POSTS_PER_WEEK_TARGET) {
    candidates.push({
      priority: 'Post more content',
      reason: `Only ${weekPosts}/${POSTS_PER_WEEK_TARGET} posts last week (${recentIG} IG + ${recentTT} TT)`,
      urgency: 9, impact: 8,
    });
  }

  // Blocked tracks needing attention
  const tracks = state?.tracks || [];
  const pushTracks = tracks.filter(t => t.status === 'PUSH' || t.status === 'FINISH');
  const blocked = pushTracks.filter(t => (t.readinessScore || 0) < 50);
  if (blocked.length) {
    const top = blocked.sort((a, b) => (b.momentumScore || 0) - (a.momentumScore || 0))[0];
    candidates.push({
      priority: `Unblock ${top.name}`,
      reason: top.nextAction || `Readiness: ${top.readinessScore || 0}%`,
      urgency: 7, impact: 7,
    });
  }

  // Engagement declining
  const engTrend = computeTrend(history, 'ig', 'engRate', 7);
  if (engTrend < -0.5) {
    candidates.push({
      priority: 'Reverse engagement decline',
      reason: `IG eng rate dropped ${engTrend.toFixed(1)}% this week`,
      urgency: 8, impact: 9,
    });
  }

  // Follower growth stalling
  const followerTrend = computeTrend(history, 'ig', 'followers', 7);
  if (followerTrend < 3) {
    candidates.push({
      priority: 'Boost follower growth',
      reason: `Only +${followerTrend} IG followers this week`,
      urgency: 6, impact: 7,
    });
  }

  // Overdue tasks
  const overdue = (state?.tasks || []).filter(t => {
    if (t.done) return false;
    return t.dueDate && new Date(t.dueDate) < new Date();
  });
  if (overdue.length > 2) {
    candidates.push({
      priority: `Clear ${overdue.length} overdue tasks`,
      reason: `Oldest: "${(overdue[0].text || '').slice(0, 40)}"`,
      urgency: 6, impact: 5,
    });
  }

  // SC growth opportunity
  const scTrend = computeTrend(history, 'sc', 'followers', 7);
  if (scTrend > 3) {
    candidates.push({
      priority: 'Capitalize on SoundCloud momentum',
      reason: `+${scTrend} SC followers this week — release more tracks`,
      urgency: 5, impact: 6,
    });
  }

  return candidates
    .sort((a, b) => (b.urgency * b.impact) - (a.urgency * a.impact))
    .slice(0, 3);
}

function computePostIdeas(latest, competitors, state) {
  const ideas = [];
  const tracks = state?.tracks || [];

  // 1. Hot track that needs content
  const hotTrack = tracks
    .filter(t => (t.status === 'PUSH' || t.status === 'FINISH') && (t.momentumScore || 0) > 40)
    .sort((a, b) => (b.momentumScore || 0) - (a.momentumScore || 0))[0];
  if (hotTrack) {
    ideas.push({
      idea: `"Should I drop this?" reel for ${hotTrack.name}`,
      reason: `Momentum: ${hotTrack.momentumScore} | Status: ${hotTrack.status}`,
      format: 'Reel',
    });
  }

  // 2. Best competitor format to replicate
  const topCompReel = (competitors?.patterns?.top10 || [])[0];
  if (topCompReel) {
    const captionSnippet = (topCompReel.caption || '').slice(0, 60).replace(/\n/g, ' ');
    ideas.push({
      idea: `Replicate top competitor format from @${topCompReel.ownerUsername}`,
      reason: `Got ${topCompReel.likesCount} likes: "${captionSnippet}..."`,
      format: topCompReel.isReel ? 'Reel' : 'Post',
    });
  }

  // 3. Recurring format
  ideas.push({
    idea: 'Three Heaters Monday roundup',
    reason: 'Recurring format builds consistency + audience expectation',
    format: 'Reel',
  });

  // 4. Track nearing release
  const nearRelease = tracks
    .filter(t => t.status === 'FINISH' && (t.readinessScore || 0) >= 70)
    .sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0))[0];
  if (nearRelease && ideas.length < 3) {
    ideas.push({
      idea: `Teaser reel for upcoming release: ${nearRelease.name}`,
      reason: `Readiness: ${nearRelease.readinessScore}% — build anticipation`,
      format: 'Reel',
    });
  }

  return ideas.slice(0, 3);
}

function pickTrackToPush(tracks) {
  if (!tracks || !tracks.length) return null;

  const candidates = tracks
    .filter(t => t.status === 'PUSH' || t.status === 'FINISH')
    .filter(t => t.status !== 'KILL')
    .sort((a, b) => {
      // Score: momentum * 0.6 + readiness * 0.4
      const scoreA = (a.momentumScore || 0) * 0.6 + (a.readinessScore || 0) * 0.4;
      const scoreB = (b.momentumScore || 0) * 0.6 + (b.readinessScore || 0) * 0.4;
      return scoreB - scoreA;
    });

  const top = candidates[0];
  if (!top) return null;

  return {
    name: top.name,
    status: top.status,
    momentum: top.momentumScore || 0,
    readiness: top.readinessScore || 0,
    reason: top.nextAction || `M:${top.momentumScore || 0} R:${top.readinessScore || 0}`,
  };
}

function evaluateCampaigns(campaigns, latest) {
  if (!campaigns || !campaigns.length) {
    return { action: 'start', suggestion: 'No active campaigns — consider starting one for your highest-momentum track', reason: 'No campaigns found' };
  }

  const active = campaigns.filter(c => c.status === 'active' || c.status === 'running');
  if (!active.length) {
    return { action: 'start', suggestion: 'Start a release campaign for your top track', reason: 'No active campaigns' };
  }

  // Check if any campaign has exhausted budget
  const exhausted = active.find(c => c.spent && c.budget && (c.spent / c.budget) > 0.9);
  if (exhausted) {
    return { action: 'pause', suggestion: `Pause "${exhausted.name}" — budget nearly exhausted`, reason: `${Math.round((exhausted.spent / exhausted.budget) * 100)}% spent` };
  }

  return { action: 'maintain', suggestion: `Keep "${active[0].name}" running`, reason: `${active.length} active campaign(s)` };
}

function pickTopAlerts(alerts) {
  if (!alerts || !alerts.length) return [];

  // Priority: risk > opportunity > performance
  const categoryOrder = { risk: 0, opportunity: 1, performance: 2 };
  const levelOrder = { red: 0, amber: 1, green: 2 };

  return [...alerts]
    .sort((a, b) => {
      const catDiff = (categoryOrder[a.category] || 2) - (categoryOrder[b.category] || 2);
      if (catDiff !== 0) return catDiff;
      return (levelOrder[a.level] || 2) - (levelOrder[b.level] || 2);
    })
    .slice(0, 3);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10);

  console.log(`\n📋 Weekly Strategy Generator — ${dateKey}\n`);

  // Read all Firebase data
  const [latest, history, competitors, state] = await Promise.all([
    readFirebase('analytics/latest'),
    readFirebase('analytics/history'),
    readFirebase('competitors/latest'),
    readFirebase('state'),
  ]);

  if (!latest) {
    console.log('⚠️  No analytics data found — run daily scrape first');
    return;
  }

  console.log('  Data loaded from Firebase');

  // Generate strategy
  const strategy = {
    generatedAt: now,
    weekOf: dateKey,
    priorities: computePriorities(latest, state, history),
    postIdeas: computePostIdeas(latest, competitors, state),
    trackToPush: pickTrackToPush(state?.tracks),
    campaignAction: evaluateCampaigns(state?.campaigns, latest),
    alertsToHandle: pickTopAlerts(latest?.alerts),
  };

  console.log('\n🎯 PRIORITIES:');
  strategy.priorities.forEach((p, i) => console.log(`  ${i + 1}. ${p.priority} — ${p.reason}`));

  console.log('\n📱 POST IDEAS:');
  strategy.postIdeas.forEach((p, i) => console.log(`  ${i + 1}. [${p.format}] ${p.idea}`));

  console.log('\n🎵 TRACK TO PUSH:', strategy.trackToPush?.name || 'None');
  console.log('📢 CAMPAIGN:', strategy.campaignAction.suggestion);

  const duration = Date.now() - startMs;

  // Write to Firebase
  console.log('\n💾 Writing to Firebase...');
  await Promise.all([
    writeFirebase('strategy/latest', strategy),
    writeFirebase(`strategy/history/${dateKey}`, strategy),
    writeFirebase(`jobs/strategy/${dateKey}`, {
      status: 'success',
      startedAt: now,
      completedAt: new Date().toISOString(),
      duration,
      records: {
        priorities: strategy.priorities.length,
        postIdeas: strategy.postIdeas.length,
        alertsToHandle: strategy.alertsToHandle.length,
      },
      estimatedCost: 0, // No Apify calls
      error: null,
    }),
  ]);

  console.log(`\n✅ Strategy generated! Duration: ${(duration / 1000).toFixed(1)}s`);
}

main().catch(async err => {
  console.error('❌ Strategy generation failed:', err);
  const dateKey = new Date().toISOString().slice(0, 10);
  try {
    await writeFirebase(`jobs/strategy/${dateKey}`, {
      status: 'failed',
      startedAt: new Date().toISOString(),
      error: err.message,
    });
  } catch (_) { /* best effort */ }
  process.exit(1);
});
