/**
 * Weekly Strategy Generator (AI-Enhanced)
 *
 * Reads all Firebase data (analytics, competitors, state),
 * calls Gemini 2.0 Flash to generate AI-powered strategy,
 * falls back to rule-based logic if AI is unavailable.
 *
 * Runs every Monday at 8:03 AM ET via GitHub Actions.
 *
 * Env vars: FIREBASE_DB_URL, FIREBASE_DB_SECRET, GEMINI_API_KEY
 */

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

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

// ─── Gemini AI helpers ──────────────────────────────────────────

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text();
      console.error(`  Gemini API error: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { console.error('  Gemini returned empty response'); return null; }
    return JSON.parse(text);
  } catch (err) {
    console.error(`  Gemini call failed: ${err.message}`);
    return null;
  }
}

function buildDataSummary(latest, history, competitors, state) {
  const ig = latest?.ig || {};
  const tt = latest?.tiktok || {};
  const sc = latest?.sc || {};

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentIG = (latest?.igPosts || []).filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > weekAgo;
  }).length;
  const recentTT = (latest?.ttPosts || []).filter(p => {
    const ts = p.createTimeISO ? new Date(p.createTimeISO).getTime() : 0;
    return ts > weekAgo;
  }).length;

  const tracks = (state?.tracks || [])
    .filter(t => t.status === 'PUSH' || t.status === 'FINISH')
    .map(t => ({ name: t.name, status: t.status, momentum: t.momentumScore || 0, readiness: t.readinessScore || 0, nextAction: t.nextAction || '' }));

  const campaigns = (state?.campaigns || [])
    .map(c => ({ name: c.name, status: c.status, spent: c.spent || 0, budget: c.budget || 0 }));

  const acctAvgs = competitors?.patterns?.accountAvgs || {};
  const compSummary = Object.entries(acctAvgs)
    .sort(([,a], [,b]) => (b.avgEng || 0) - (a.avgEng || 0))
    .slice(0, 8)
    .map(([name, d]) => ({ name, avgLikes: Math.round(d.avgEng || 0), reels: d.reels || d.posts || 0, reelPct: d.reelPct || 0 }));

  const topReels = (competitors?.patterns?.top10 || []).slice(0, 5)
    .map(r => ({ account: r.ownerUsername, likes: r.likesCount || 0, caption: (r.caption || '').slice(0, 60) }));

  return {
    ig: { followers: ig.followers || 0, engRate: ig.engRate || 0, avgLikes: ig.avgLikes || 0, avgComments: ig.avgComments || 0, posts: ig.posts || 0 },
    tiktok: { followers: tt.followers || 0, hearts: tt.hearts || tt.likes || 0, videos: tt.videos || tt.posts || 0, avgPlays: tt.avgPlays || tt.avgPlaysPerPost || 0 },
    sc: { followers: sc.followers || 0, tracks: sc.tracks || 0 },
    trends7d: {
      igFollowers: computeTrend(history, 'ig', 'followers', 7),
      igEngRate: +computeTrend(history, 'ig', 'engRate', 7).toFixed(1),
      ttFollowers: computeTrend(history, 'tiktok', 'followers', 7),
      scFollowers: computeTrend(history, 'sc', 'followers', 7),
    },
    postsThisWeek: { ig: recentIG, tt: recentTT, total: recentIG + recentTT, target: POSTS_PER_WEEK_TARGET },
    tracks,
    campaigns,
    competitors: { summary: compSummary, topReels },
    currentAlerts: (latest?.alerts || []).map(a => ({ msg: a.msg, level: a.level, category: a.category })),
  };
}

function buildPrompt(dataSummary) {
  return `You are a music marketing strategist AI for an emerging DJ/producer called "El Capitán" who makes tech house music. Analyze the following data and return a JSON object with exactly the fields specified.

DATA:
${JSON.stringify(dataSummary)}

Return a JSON object with EXACTLY these fields:

{
  "artistScoreInsight": "1-2 sentences explaining the artist's current standing. Reference specific metrics like follower count, engagement rate, posting cadence. Be direct and actionable.",

  "trendAnalysis": "2-3 sentences analyzing recent trends across platforms. Identify what's working and what needs attention. Reference specific numbers from the trends data.",

  "performanceAlerts": [
    { "message": "specific observation about current performance", "level": "green or amber or red" }
  ],

  "opportunityAlerts": [
    { "message": "specific opportunity to capitalize on right now", "level": "green or amber or red" }
  ],

  "avoidItems": [
    { "title": "SHORT TITLE IN CAPS", "reason": "1 sentence explaining why based on the data" }
  ],

  "postingCadenceAnalysis": {
    "you": { "rate": "e.g. ~3/wk", "commentary": "1 sentence about current posting pace" },
    "competitors": [
      { "name": "ACCOUNT NAME", "rate": "e.g. ~6/wk", "commentary": "1 sentence" }
    ]
  },

  "priorityFormats": [
    { "format": "content format name", "evidence": "data-backed reason from competitor data", "impact": "HIGH or MED" }
  ],

  "priorities": [
    { "priority": "action title", "reason": "data-backed reason", "urgency": 1-10, "impact": 1-10 }
  ],

  "postIdeas": [
    { "idea": "specific post concept using real track names from data", "reason": "why this works now based on data", "format": "Reel or Post or Story or Carousel" }
  ],

  "trackToPush": {
    "name": "track name from the tracks data (or null if no tracks)",
    "reason": "why this track deserves focus this week",
    "momentum": number,
    "readiness": number
  },

  "campaignAction": {
    "action": "start or maintain or pause or stop",
    "suggestion": "specific recommendation",
    "reason": "data-backed reason"
  }
}

RULES:
- performanceAlerts: exactly 2-3 items
- opportunityAlerts: exactly 2-3 items
- avoidItems: exactly 3-4 items based on what the DATA shows doesn't work, not generic advice
- postingCadenceAnalysis.competitors: include up to 4 from the competitor data
- priorityFormats: exactly 5-8 items ranked by impact, based on what works for competitors at this follower level
- priorities: exactly 3 items
- postIdeas: exactly 3 items, use actual track names from the data if available
- Use ONLY the data provided. Do not invent metrics or track names.
- Be specific: reference actual numbers, track names, and platform names.
- Tone: direct, confident, slightly informal. Like a strategist briefing an artist.
- If trackToPush has no tracks available, set it to null.
- Return valid JSON only.`;
}

function validateAIResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const result = {};

  // String fields
  if (typeof parsed.artistScoreInsight === 'string' && parsed.artistScoreInsight.length > 10)
    result.artistScoreInsight = parsed.artistScoreInsight;
  if (typeof parsed.trendAnalysis === 'string' && parsed.trendAnalysis.length > 10)
    result.trendAnalysis = parsed.trendAnalysis;

  // Alert arrays
  for (const field of ['performanceAlerts', 'opportunityAlerts']) {
    if (Array.isArray(parsed[field]) && parsed[field].length >= 1 && parsed[field].every(a => a.message && a.level))
      result[field] = parsed[field].slice(0, 5);
  }

  // Avoid items
  if (Array.isArray(parsed.avoidItems) && parsed.avoidItems.length >= 1 && parsed.avoidItems.every(a => a.title && a.reason))
    result.avoidItems = parsed.avoidItems.slice(0, 6);

  // Posting cadence
  if (parsed.postingCadenceAnalysis?.you?.rate && parsed.postingCadenceAnalysis?.you?.commentary)
    result.postingCadenceAnalysis = parsed.postingCadenceAnalysis;

  // Priority formats
  if (Array.isArray(parsed.priorityFormats) && parsed.priorityFormats.length >= 3 && parsed.priorityFormats.every(f => f.format && f.evidence && f.impact))
    result.priorityFormats = parsed.priorityFormats.slice(0, 10);

  // Priorities
  if (Array.isArray(parsed.priorities) && parsed.priorities.length >= 1 && parsed.priorities.every(p => p.priority && p.reason))
    result.priorities = parsed.priorities.slice(0, 5);

  // Post ideas
  if (Array.isArray(parsed.postIdeas) && parsed.postIdeas.length >= 1 && parsed.postIdeas.every(p => p.idea && p.format))
    result.postIdeas = parsed.postIdeas.slice(0, 5);

  // Track to push
  if (parsed.trackToPush === null || (parsed.trackToPush?.name && parsed.trackToPush?.reason))
    result.trackToPush = parsed.trackToPush;

  // Campaign action
  if (parsed.campaignAction?.action && parsed.campaignAction?.suggestion)
    result.campaignAction = parsed.campaignAction;

  const validCount = Object.keys(result).length;
  console.log(`  Validated ${validCount}/11 AI fields`);
  return validCount > 0 ? result : null;
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

// ─── Rule-based fallbacks ───────────────────────────────────────

function computePriorities(latest, state, history) {
  const candidates = [];

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

  const engTrend = computeTrend(history, 'ig', 'engRate', 7);
  if (engTrend < -0.5) {
    candidates.push({
      priority: 'Reverse engagement decline',
      reason: `IG eng rate dropped ${engTrend.toFixed(1)}% this week`,
      urgency: 8, impact: 9,
    });
  }

  const followerTrend = computeTrend(history, 'ig', 'followers', 7);
  if (followerTrend < 3) {
    candidates.push({
      priority: 'Boost follower growth',
      reason: `Only +${followerTrend} IG followers this week`,
      urgency: 6, impact: 7,
    });
  }

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

  const topCompReel = (competitors?.patterns?.top10 || [])[0];
  if (topCompReel) {
    const captionSnippet = (topCompReel.caption || '').slice(0, 60).replace(/\n/g, ' ');
    ideas.push({
      idea: `Replicate top competitor format from @${topCompReel.ownerUsername}`,
      reason: `Got ${topCompReel.likesCount} likes: "${captionSnippet}..."`,
      format: topCompReel.isReel ? 'Reel' : 'Post',
    });
  }

  ideas.push({
    idea: 'Three Heaters Monday roundup',
    reason: 'Recurring format builds consistency + audience expectation',
    format: 'Reel',
  });

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

  const exhausted = active.find(c => c.spent && c.budget && (c.spent / c.budget) > 0.9);
  if (exhausted) {
    return { action: 'pause', suggestion: `Pause "${exhausted.name}" — budget nearly exhausted`, reason: `${Math.round((exhausted.spent / exhausted.budget) * 100)}% spent` };
  }

  return { action: 'maintain', suggestion: `Keep "${active[0].name}" running`, reason: `${active.length} active campaign(s)` };
}

function pickTopAlerts(alerts) {
  if (!alerts || !alerts.length) return [];

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

  // Attempt AI-enhanced strategy
  let aiFields = null;
  if (GEMINI_API_KEY) {
    console.log('\n🤖 Calling Gemini AI for enhanced strategy...');
    const dataSummary = buildDataSummary(latest, history, competitors, state);
    const prompt = buildPrompt(dataSummary);
    const raw = await callGemini(prompt);
    if (raw) {
      aiFields = validateAIResponse(raw);
      if (aiFields) {
        console.log('  ✓ AI strategy generated successfully');
      } else {
        console.log('  ⚠️ AI response failed validation — using rule-based fallback');
      }
    }
  } else {
    console.log('\n⚠️  No GEMINI_API_KEY — using rule-based strategy');
  }

  // Build strategy: AI-enhanced fields with rule-based fallbacks
  const strategy = {
    generatedAt: now,
    weekOf: dateKey,
    aiGenerated: !!aiFields,
    // Core fields: AI override or rule-based fallback
    priorities: aiFields?.priorities || computePriorities(latest, state, history),
    postIdeas: aiFields?.postIdeas || computePostIdeas(latest, competitors, state),
    trackToPush: aiFields?.trackToPush !== undefined ? aiFields.trackToPush : pickTrackToPush(state?.tracks),
    campaignAction: aiFields?.campaignAction || evaluateCampaigns(state?.campaigns, latest),
    alertsToHandle: pickTopAlerts(latest?.alerts),
    // AI-only fields (null if AI unavailable — dashboard shows static defaults)
    artistScoreInsight: aiFields?.artistScoreInsight || null,
    trendAnalysis: aiFields?.trendAnalysis || null,
    performanceAlerts: aiFields?.performanceAlerts || null,
    opportunityAlerts: aiFields?.opportunityAlerts || null,
    avoidItems: aiFields?.avoidItems || null,
    postingCadenceAnalysis: aiFields?.postingCadenceAnalysis || null,
    priorityFormats: aiFields?.priorityFormats || null,
  };

  console.log('\n🎯 PRIORITIES:');
  strategy.priorities.forEach((p, i) => console.log(`  ${i + 1}. ${p.priority} — ${p.reason}`));

  console.log('\n📱 POST IDEAS:');
  strategy.postIdeas.forEach((p, i) => console.log(`  ${i + 1}. [${p.format}] ${p.idea}`));

  console.log('\n🎵 TRACK TO PUSH:', strategy.trackToPush?.name || 'None');
  console.log('📢 CAMPAIGN:', strategy.campaignAction.suggestion);

  if (strategy.artistScoreInsight)
    console.log('\n💡 AI INSIGHT:', strategy.artistScoreInsight);
  if (strategy.trendAnalysis)
    console.log('📊 TREND ANALYSIS:', strategy.trendAnalysis);

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
      aiGenerated: !!aiFields,
      records: {
        priorities: strategy.priorities.length,
        postIdeas: strategy.postIdeas.length,
        alertsToHandle: strategy.alertsToHandle.length,
      },
      estimatedCost: 0,
      error: null,
    }),
  ]);

  console.log(`\n✅ Strategy generated! ${aiFields ? '(AI-enhanced)' : '(rule-based)'} Duration: ${(duration / 1000).toFixed(1)}s`);
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
