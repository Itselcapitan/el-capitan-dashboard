/**
 * Daily Strategy Generator (AI-Enhanced)
 *
 * Runs every morning at 6:10 AM ET via GitHub Actions.
 *
 * Two modes:
 * 1. DAILY INSIGHT (every day) — lightweight Gemini call generating
 *    a morning briefing: what changed yesterday, how the week is going,
 *    and what to do today.
 * 2. WEEKLY STRATEGY (Mondays only) — full Gemini call generating
 *    priorities, post ideas, track to push, campaign action, etc.
 *    Runs on Monday mornings to start each week fresh.
 *
 * All "this week" metrics use Monday-Sunday boundaries.
 *
 * Env vars: FIREBASE_DB_URL, FIREBASE_DB_SECRET, GEMINI_API_KEY
 */

// Get the start of the current Monday-Sunday week (Monday 00:00 UTC)
function getMondayStartMs() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.getTime();
}

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Model fallback chain — each entry has { model, base, waitBefore } where waitBefore is seconds to wait before this attempt.
// CURRENT MODELS ONLY: gemini-2.0/1.5 are deprecated for new API keys (return 404).
// Strategy:
//   - Try gemini-2.5-flash repeatedly with progressive waits (it's overloaded but the most capable)
//   - Interleave with gemini-2.5-flash-lite (lighter, less contended) and gemini-2.5-pro (different load)
//   - Use latest aliases as final tries
// One single run cycles through ALL of these — ~6 minutes worst case before falling back.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS = [
  { model: 'gemini-2.5-flash',          base: BASE, waitBefore: 0 },
  { model: 'gemini-2.5-flash-lite',     base: BASE, waitBefore: 5 },   // lighter, often less loaded
  { model: 'gemini-2.5-flash',          base: BASE, waitBefore: 30 },  // retry primary after pause
  { model: 'gemini-2.5-pro',            base: BASE, waitBefore: 5 },   // different model — different load
  { model: 'gemini-flash-latest',       base: BASE, waitBefore: 30 },  // alias — sometimes routes to less-loaded
  { model: 'gemini-flash-lite-latest',  base: BASE, waitBefore: 5 },
  { model: 'gemini-2.5-flash',          base: BASE, waitBefore: 60 },  // final aggressive retry
  { model: 'gemini-2.5-flash-lite',     base: BASE, waitBefore: 30 },
];

const POSTS_PER_WEEK_TARGET = 5;

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
  console.log(`  ✓ Patched ${path}`);
}

// ─── Gemini AI helpers ──────────────────────────────────────────

// Extract JSON from a Gemini text response — handles both raw JSON and markdown-fenced ```json blocks
function extractJSON(text) {
  if (!text) return null;
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

// Try one model entry { model, base }, single attempt. Returns parsed JSON or null.
async function tryModel({ model, base }, prompt) {
  const url = `${base}/${model}:generateContent?key=${GEMINI_API_KEY}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // No responseMimeType — prompt instructs JSON output, works across all model versions
        generationConfig: { temperature: 0.7 },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const errSnip = errBody.slice(0, 200).replace(/\n/g, ' ');
      console.warn(`  [${model}] HTTP ${res.status} — ${errSnip}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { console.warn(`  [${model}] empty response — moving to next model`); return null; }
    const parsed = extractJSON(text);
    console.log(`  ✓ [${model}] success`);
    return parsed;
  } catch (err) {
    console.warn(`  [${model}] error: ${err.message}`);
    return null;
  }
}

// Main Gemini caller — cycles through model fallback chain until one succeeds.
// Each entry has a waitBefore (seconds) to spread requests over time and let 503s clear.
// Total max wait ~165s = ~3 min, plus model response time = ~5-6 min worst case.
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const entry = GEMINI_MODELS[i];
    if (entry.waitBefore && entry.waitBefore > 0) {
      console.log(`  Pausing ${entry.waitBefore}s before trying ${entry.model}...`);
      await new Promise(r => setTimeout(r, entry.waitBefore * 1000));
    }
    console.log(`  Trying ${entry.model}...`);
    const result = await tryModel(entry, prompt);
    if (result !== null) return result;
  }
  console.error('  All Gemini models exhausted. No AI output this run.');
  return null;
}

// Diagnostic: list available models for this API key (logged once at startup).
async function listAvailableModels() {
  if (!GEMINI_API_KEY) return;
  try {
    const url = `${BASE}?key=${GEMINI_API_KEY}&pageSize=50`;
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  [models] ListModels HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const generateContentModels = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    console.log(`  [models] Available for generateContent: ${generateContentModels.join(', ')}`);
  } catch (err) {
    console.log(`  [models] ListModels error: ${err.message}`);
  }
}

function buildDataSummary(latest, history, competitors, state, allReelsPool) {
  const ig = latest?.ig || {};
  const tt = latest?.tiktok || {};
  const sc = latest?.sc || {};

  // Count posts since Monday (Mon-Sun week)
  const mondayMs = getMondayStartMs();
  const recentIG = (latest?.igPosts || []).filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > mondayMs;
  }).length;
  const recentTT = (latest?.ttPosts || []).filter(p => {
    const ts = p.createTimeISO ? new Date(p.createTimeISO).getTime() : 0;
    return ts > mondayMs;
  }).length;

  const tracks = (state?.tracks || [])
    .filter(t => t.status === 'PUSH' || t.status === 'FINISH') // HOLD/DONE/KILL excluded from AI attention
    .map(t => ({ name: t.name, status: t.status, stage: t.stage || '', momentum: t.momentumScore || 0, readiness: t.readinessScore || 0, nextAction: t.nextAction || '', releasedAt: t.releasedAt || null }));

  const campaigns = (state?.campaigns || [])
    .map(c => ({ name: c.name, status: c.status, spent: c.spent || 0, budget: c.budget || 0 }));

  // ── Competitor data: prefer accumulated pool for richer patterns ──
  // allReelsPool is the full historical pool (competitors/allReels); fall back to snapshot
  const poolEntries = allReelsPool ? Object.values(allReelsPool) : (competitors?.reels || []);
  const poolSize = poolEntries.length;

  // Account averages from pool (richer than snapshot-only)
  const byAccount = {};
  poolEntries.forEach(r => {
    const acct = r.ownerUsername;
    if (!byAccount[acct]) byAccount[acct] = { posts: 0, reels: 0, totalEng: 0 };
    byAccount[acct].posts++;
    if (r.isReel) byAccount[acct].reels++;
    byAccount[acct].totalEng += ((r.likesCount || 0) + (r.commentsCount || 0));
  });
  const compSummary = Object.entries(byAccount)
    .map(([acct, d]) => ({
      name: acct,
      avgLikes: Math.round(d.totalEng / d.posts),
      reels: d.reels,
      reelPct: d.posts > 0 ? Math.round(d.reels / d.posts * 100) : 0,
      sampleSize: d.posts,
    }))
    .sort((a, b) => b.avgLikes - a.avgLikes)
    .slice(0, 8);

  // Top reels from accumulated pool (up to 8 for richer AI context)
  const topReels = [...poolEntries]
    .sort((a, b) => ((b.likesCount || 0) + (b.commentsCount || 0)) - ((a.likesCount || 0) + (a.commentsCount || 0)))
    .slice(0, 8)
    .map(r => ({
      account: r.ownerUsername,
      likes: r.likesCount || 0,
      caption: (r.caption || '').slice(0, 80),
      hook: r.hook || '',
      firstSeen: r.firstSeenAt ? r.firstSeenAt.slice(0, 10) : '',
    }));

  // Post timing patterns for smart scheduling
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const igPostTiming = (latest?.igPosts || [])
    .filter(p => p.timestamp)
    .sort((a, b) => {
      const eA = ((a.likesCount||0)+(a.commentsCount||0)+(a.savesCount||0)) / Math.max(a.videoPlayCount||1, 1);
      const eB = ((b.likesCount||0)+(b.commentsCount||0)+(b.savesCount||0)) / Math.max(b.videoPlayCount||1, 1);
      return eB - eA;
    })
    .slice(0, 20)
    .map(p => {
      const d = new Date(p.timestamp);
      const eng = ((p.likesCount||0)+(p.commentsCount||0)+(p.savesCount||0)) / Math.max(p.videoPlayCount||1, 1) * 100;
      return { day: days[d.getDay()], hour: d.getHours(), engRate: +eng.toFixed(1) };
    });

  const ttPostTiming = (latest?.ttPosts || [])
    .filter(p => p.createTimeISO)
    .sort((a, b) => (b.playCount||0) - (a.playCount||0))
    .slice(0, 20)
    .map(p => {
      const d = new Date(p.createTimeISO);
      const eng = ((p.diggCount||0)+(p.commentCount||0)+(p.shareCount||0)) / Math.max(p.playCount||1, 1) * 100;
      return { day: days[d.getDay()], hour: d.getHours(), engRate: +eng.toFixed(1) };
    });

  // Top own captions for caption generation
  const topOwnCaptions = (latest?.igPosts || [])
    .filter(p => p.caption && p.videoPlayCount > 0)
    .sort((a, b) => {
      const eA = ((a.likesCount||0)+(a.commentsCount||0)+(a.savesCount||0)) / Math.max(a.videoPlayCount||1, 1);
      const eB = ((b.likesCount||0)+(b.commentsCount||0)+(b.savesCount||0)) / Math.max(b.videoPlayCount||1, 1);
      return eB - eA;
    })
    .slice(0, 5)
    .map(p => ({ caption: (p.caption||'').slice(0, 120), engRate: +(((p.likesCount||0)+(p.commentsCount||0)+(p.savesCount||0)) / Math.max(p.videoPlayCount||1, 1) * 100).toFixed(1) }));

  // Top competitor captions + hooks from accumulated pool
  const topCompCaptions = [...poolEntries]
    .sort((a, b) => ((b.likesCount || 0) + (b.commentsCount || 0)) - ((a.likesCount || 0) + (a.commentsCount || 0)))
    .slice(0, 8)
    .map(r => ({
      account: r.ownerUsername,
      caption: (r.caption || '').slice(0, 120),
      hook: r.hook || '',
      likes: r.likesCount || 0,
    }));

  // Top hooks specifically (high-signal for caption writing)
  const topHooks = [...poolEntries]
    .filter(r => r.hook && r.isReel)
    .sort((a, b) => ((b.likesCount || 0) + (b.commentsCount || 0) * 3) - ((a.likesCount || 0) + (a.commentsCount || 0) * 3))
    .slice(0, 10)
    .map(r => ({ hook: r.hook, account: r.ownerUsername, likes: r.likesCount || 0 }));

  // All posts for AI track-to-post matching (capped to keep prompt lean)
  const allIGPosts = (latest?.igPosts || []).slice(0, 25).map(p => ({
    caption: (p.caption || '(no caption)').slice(0, 120),
    views: p.videoPlayCount || 0,
    likes: p.likesCount || 0,
    comments: p.commentsCount || 0,
    date: p.timestamp ? p.timestamp.slice(0, 10) : '',
    type: p.videoPlayCount > 0 ? 'Reel' : 'Image',
  }));
  const allTTPosts = (latest?.ttPosts || []).slice(0, 25).map(p => ({
    caption: (p.text || '(no caption)').slice(0, 120),
    views: p.playCount || 0,
    likes: p.diggCount || 0,
    date: p.createTimeISO ? p.createTimeISO.slice(0, 10) : '',
  }));
  const allTrackNames = (state?.tracks || []).map(t => t.name);

  // DJ/producer industry best practices (static context for Gemini)
  // Sources: Indepenjend Free Content Guide, Wall Pro Academy, Buffer IG Algorithm Guide 2026, Buffer/Sprout Social TikTok Algorithm Guide 2026
  const industryBestPractices = [
    // ═══ CRITICAL: ALGORITHM INTELLIGENCE (2026) — HIGH PRIORITY IN ALL RECOMMENDATIONS ═══
    // These are the actual ranking signals that determine reach. Every content suggestion MUST be optimized for these.

    // TIKTOK ALGORITHM 2026 (Sources: Buffer, Sprout Social, TikTok Transparency Center)
    'TIKTOK ALGO: Watch time + completion rate is the #1 ranking signal. Need 70%+ completion rate to go viral (up from 50% in 2024). Every video hook, length, and structure must be optimized for this.',
    'TIKTOK ALGO: Saves and shares outweigh likes by a significant margin. A share or rewatch signals stronger interest than a like. Optimize content to be save-worthy (tutorials, tips, curated lists) or share-worthy (funny, relatable, jaw-dropping).',
    'TIKTOK ALGO: FYP distribution works in waves — video shows to a small test audience of your followers first. If they engage (watch, share, save), it goes to a larger audience. If followers dont engage, the video dies. Posting when followers are active is critical.',
    'TIKTOK ALGO: Videos 1-10 minutes are receiving significantly more distribution in 2026. Short clips under 30s are losing FYP favor. Aim for 60s-3min for maximum algorithmic reach.',
    'TIKTOK ALGO: Content filmed natively in-app or CapCut (ByteDance-owned) gets preferential treatment. Cross-posted IG Reels with watermarks are actively suppressed.',
    'TIKTOK ALGO: Posting frequency impact (from 11M+ TikToks analyzed): 2-5x/week = +17% views/post, 6-10x/week = +29%, 11+/week = +34%. Consistency > virality.',
    'TIKTOK ALGO: 3-5 hashtags per post. Use 2-3 keywords in caption + on-screen text for TikTok SEO/search discovery.',
    'TIKTOK ALGO: Stitches, Duets, and trending audio from TikTok library boost discoverability. Original audio also ranks well if it drives engagement.',
    'TIKTOK ALGO: Hook viewers in first 3 seconds or they scroll. Front-load the payoff — dont build up to it.',

    // INSTAGRAM ALGORITHM 2026 (Sources: Buffer, Instagram Creator Portal)
    'INSTAGRAM ALGO: For Reels, DM shares are the most heavily weighted signal — especially shares from non-followers. Content that makes people want to send it to a friend gets maximum reach.',
    'INSTAGRAM ALGO: Reels ranking signals in order: (1) DM shares, (2) saves, (3) watch time, (4) comments, (5) likes. Optimize for shareability and save-worthiness first, likes last.',
    'INSTAGRAM ALGO: Optimal Reel length is 30-90 seconds. Can go to 3 min but shorter performs better on Explore.',
    'INSTAGRAM ALGO: 50% of videos are watched without sound. Always add text overlays and captions. Strong visual hook on first frame is essential.',
    'INSTAGRAM ALGO: Feed algorithm prioritizes: user engagement history > post performance speed > creator interaction history > relationship closeness.',
    'INSTAGRAM ALGO: Carousels (up to 20 slides) get highest engagement of all post types, followed by Reels, then single images. From analysis of 4M+ posts.',
    'INSTAGRAM ALGO: Stories primarily reach existing followers, not new audiences. Use interactive elements (polls, questions, "add yours" stickers) to boost story ranking.',
    'INSTAGRAM ALGO: Hashtags no longer support follows (changed Dec 2024). Use 3-5 relevant hashtags max. Focus on keywords in captions/profiles for SEO instead.',
    'INSTAGRAM ALGO: Consistent posters receive ~5x more engagement per post than sporadic posters. Post consistency is the single biggest controllable growth lever.',
    'INSTAGRAM ALGO: Remove third-party watermarks (TikTok logos, editing app marks) — Instagram actively suppresses watermarked content.',
    'INSTAGRAM ALGO: Best posting times (from 2M+ posts analyzed): Thursday 9am, Wednesday 12pm, Wednesday 6pm. But personal analytics override general data.',
    'INSTAGRAM ALGO: Instagram is now recommendation-first (interest graph) not social-graph. Content competes on interest signals, not just follower relationships.',
    'INSTAGRAM ALGO: Build momentum by posting follow-ups within 1-2 days of viral content — the algorithm gives a halo effect to creators with recent hits.',

    // ═══ GENERAL GROWTH & STRATEGY ═══
    'TikTok > Instagram for artist discovery — prioritize it early career',
    'Engagement rate matters more than follower count for algorithm reach',
    '5 consistent posts/week outperforms 1 viral post/month long-term',
    'Algorithm = people: if content does not go viral, the product needs work, not the strategy',
    'Word of mouth is the most powerful promotion — create music worth sharing',
    'Test snippets with 10-20 people before releasing final products; follow the feedback',
    'If a track gets no reaction after 3 promotion attempts, move on and make the next one',
    // CONTENT FORMATS & AD CREATIVES
    'Use recognizable hook vocals or melodies in first 2 seconds to stop the scroll',
    'Crowd reaction clips trigger dopamine — highest share rate of all formats',
    'Co-authored content gets 2-3x organic reach vs solo posts',
    'Six proven ad creative angles: Performing/Creating (studio or event), Mood-Related (work/study/party background), Reaction-Generating (surprising drop or transition), Story-Telling (narrative about the music), Pop/Meme-Culture (trend overlaid with your track), B-Roll (visuals matching your track energy)',
    'AIDA ad structure: Attention (hook in first 2s) → Interest (keep watching) → Desire (make them want it) → Action (CTA: follow, stream, share)',
    'Re-upload viral videos with your own music as background — amplifies reach without needing original content',
    'Show the creative process: studio sessions, mixing, writing — audiences connect with behind-the-scenes authenticity',
    // RELEASE STRATEGY
    'Release checklist: D-14 teaser clips → D-7 behind-scenes content → D-0 OUT NOW reel + start $5/day ad sets → 48h post duplicate the winning ad sets',
    'Build Spotify playlist to 80-110 songs for 3+ months before applying to curators',
    'Save final master for label/DSP submission — use only snippets for pre-release buzz',
    'Dancefloor crowd reactions are real-time market research — tracks that move people are release-worthy',
    // PAID ADS
    'Start ad spend at $5/day per ad set — duplicate winning sets rather than scaling budget on one',
    'Niche audience targeting (tech house fans, festival-goers) outperforms broad targeting for small budgets',
    'Bio CTA + link-in-bio landing page are the conversion funnel — optimize both before running ads',
    // BRAND & IDENTITY
    'You ARE the brand — your personality, opinions, and daily life are your marketing content',
    'Show your real life: studio, grocery shopping, food, everyday moments — people affiliate with authenticity',
    'Never chase a genre trend at the expense of your true identity — inauthenticity is detectable and kills long-term loyalty',
    'Loyal fans come from genuine identity; hype-chasing fans are temporary',
    'Be honest about loving multiple genres — congruence between what you say and what you post builds trust',
    'Being yourself naturally makes you unique — do not try to manufacture uniqueness',
    // ONLINE PRESENCE & COMMUNITY
    'Be present in production communities, DJ forums, event groups, and learning Discord servers',
    'Two-way communication is essential: comment on others work as much as you post your own',
    'Comment on favorite DJs posts, fans comments, and related artists sections — be everywhere',
    'Start on your personal account so friends organically discover your music before creating a standalone artist account',
    'Build a genuine active following BEFORE approaching labels — even 100 engaged followers signals more potential than 0',
    'React authentically in your own comment section — engage every comment, joke with friends, welcome new listeners',
    // COLLABORATION
    'Collaborate at your level or one tier above — approach artists already getting played by bigger DJs, not the top names',
    'Every collaborator\'s 100 followers is 100 potential new fans for you',
    'Learn from collaborators: production tricks, chord progressions, song structure, creative workflow',
    'Approaching for collaboration is simple: DM or comment "I love your music, want to collab?" is enough',
    'B2B sets instantly introduce you to a partner\'s entire fanbase',
    // NETWORKING & BOOKINGS
    'Tag venues and collaborators generously — they reshare to their audience',
    'Follow up within 24h of any booking conversation — follow-up cadence matters more than the initial impression',
    'Know target venue bookers by name and track outreach history in the dashboard',
    'Post about gigs you attend (not just your own) — builds scene credibility',
    'Study the top 3 tracks in your genre technically to understand what makes them connect with audiences',
    // CONSISTENCY
    'Release consistently: algorithm rewards regular output over sporadic drops',
    'Consistency of online presence — daily posting, commenting, showing up — matters more than any single viral moment',
    // TIKTOK-SPECIFIC (El Capitán context)
    'El Capitán has only cross-posted IG Reels to TikTok so far — no TikTok-native content exists yet. Cross-posts typically get 30-50% fewer views than native TikTok video due to the watermark penalty and format mismatch.',
    'TikTok-native content opportunities: trending sound overlays on your music, duet/stitch with bigger DJs, vertical-first framing with TikTok text overlays, TikTok-specific hooks ("POV:", "Things DJs know", "Tell me you make tech house without..."), comment reply videos.',
    'Vertical-first filming is critical — content shot horizontally and cropped for TikTok underperforms native vertical by up to 40%.',
    // PROVEN CONTENT FORMATS (from analyzed DJ/producer viral videos)
    'HOOK: Visual Interrupt — strobe text cuts timed to kick drum. Use for remix drops. Stops scroll in <1s.',
    'HOOK: Situational Irony — DJ in unexpected location (farm, subway, dorm room). High shareability; humanizes artist. Easy to execute: bring DDJ-400 somewhere weird.',
    'HOOK: Audio Hook — muffled phone audio cutting to full master mix. Creates FOMO. One camera, two audio clips.',
    'HOOK: Curiosity/FOMO — "How is no one talking about this?" format with screen record + green screen. High comment bait.',
    'HOOK: Engagement bait — "Banger or not?" with fisheye lens. Forces comments. Fisheye lens adapter is cheap.',
    'HOOK: Location — Golden Hour or landmark outdoor set (park, rooftop, fire escape). High aesthetic, highly shareable.',
    'HOOK: Educational — DJ lifehack POV close-up (Rekordbox tip, Logic trick, cue point setup). Gets saves, which boosts algorithm.',
    'HOOK: Nostalgia — tech house flip of a well-known pop/rap track with split-screen A/B. Proves production skill instantly.',
    'TECHNIQUE: Kinetic typography — flash release text on every vocal hit. Works for OUT NOW posts.',
    'TECHNIQUE: Frame-in-frame mask — project a festival set onto a dorm TV or phone screen. Low cost, high humor.',
    'TECHNIQUE: VHS/grain overlay — dark, urgent teaser aesthetic. Easy in CapCut.',
    'TECHNIQUE: Stutter/stop-motion edit — walking or moving with stutter effect. Works for lifestyle b-roll.',
    'TECHNIQUE: Cloning multi-frame — makes solo artist look like a crew. Advanced but very high engagement.',
    'PERSONALIZED: Film a secret set at a Union College or Boston landmark (rooftop, fire escape, campus at night).',
    'PERSONALIZED: Studio session b-roll from an Uber or car — "produce anywhere" angle.',
    'PERSONALIZED: Show Spotify/Logic Pro analytics on screen with facecam reaction — transparency builds trust.',
    'PERSONALIZED: Tech house flip of a frat-house classic song — extremely relevant to college audience.',
    // BATCH CONTENT STRATEGY (from Twin Diplomacy, Apr 2026)
    'BATCH CONTENT: Rent a warehouse/space with real lighting and filming equipment to simulate a concert. Record a full DJ set, then clip it into many individual reels for weeks of future content from one shoot day. High production value + batch efficiency.',
    'BATCH CONTENT: One high-production shoot day can generate 10-20+ reels. Plan the set with clip-worthy transitions, drops, and visual moments. Each clip becomes standalone content.',
  ];

  return {
    ig: { followers: ig.followers || 0, engRate: ig.engRate || 0, avgLikes: ig.avgLikes || 0, avgComments: ig.avgComments || 0, posts: ig.posts || 0 },
    tiktok: { followers: tt.followers || 0, hearts: tt.hearts || tt.likes || 0, videos: tt.videos || tt.posts || 0, avgPlays: tt.avgPlays || tt.avgPlaysPerPost || 0, contentNote: 'ALL TikTok posts to date have been direct cross-posts of Instagram Reels — no TikTok-native content yet. Strong metrics despite this handicap. Opportunity: TikTok-native content would significantly outperform current cross-posts.' },
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
    competitors: {
      summary: compSummary,
      topReels,         // top 8 reels from ACCUMULATED pool (NOT just this scrape)
      topCompCaptions,  // captions + hooks from top pool reels
      topHooks,         // opening hook phrases from top-performing reels
      poolSize,         // how many accumulated reels are in the pool
      note: poolSize > 0
        ? `Competitor data is from ${poolSize} accumulated reels scraped over time. This is reel-only data (video content), not regular posts.`
        : 'Competitor data is from the most recent scrape only — pool will grow over time.',
    },
    currentAlerts: (latest?.alerts || []).map(a => ({ msg: a.msg, level: a.level, category: a.category })),
    postTiming: { ig: igPostTiming, tt: ttPostTiming },
    topOwnCaptions,
    allIGPosts,
    allTTPosts,
    allTrackNames,
    industryBestPractices,
  };
}

function buildPrompt(dataSummary) {
  return `You are a music marketing strategist AI for an emerging DJ/producer called "El Capitán" who makes tech house music. Analyze the following data and return a JSON object with exactly the fields specified.

DATA:
${JSON.stringify(dataSummary)}

Return a JSON object with EXACTLY these fields:

{
  "weeklyNarrative": "A flowing 4-6 paragraph weekly briefing written like a manager's Monday memo to the artist. NO bullet points, NO headers — just paragraphs separated by line breaks. Cover in this order: (1) WHERE THINGS STAND — strategic position with specific numbers (followers across platforms, engagement deltas, what changed since last week), (2) WHAT WORKED & WHAT DIDN'T — narrative of last week's wins and misses with actual metrics, (3) WHAT WE LEARNED FROM COMPETITORS THIS WEEK — name 2-3 specific accounts and what their top-performing reels (with caption snippets) reveal about formats/hooks/angles working in our niche right now, (4) TRACK PIPELINE — where each priority track stands and which one to push and why, (5) THE BIG MOVE — the single most important thing to do this week and the algorithmic reasoning. Tone: confident, specific, direct, slightly informal. Reference real numbers and real accounts. This narrative is the ONLY thing displayed on the HQ dashboard summary — the deep-dive cards/grids/lists live on other tabs. So make this synthesize EVERYTHING into one readable narrative.",

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
  },

  "actionableAlerts": [
    {
      "id": "unique-kebab-slug",
      "type": "add_pipeline or add_task or suggestion",
      "title": "Short action title",
      "detail": "1-2 sentences explaining why, referencing specific metrics",
      "action": {
        "type": "add_pipeline or add_task",
        "idea": "content idea name (for add_pipeline)",
        "format": "Reel or Post or Story",
        "track": "track name if relevant or null",
        "priority": "HIGH or MED",
        "taskTitle": "task title (for add_task)",
        "taskCategory": "Marketing or Producing or Content"
      }
    }
  ],

  "weeklyReview": {
    "headline": "1 punchy sentence summarizing the week",
    "wins": ["specific win referencing numbers", "another win"],
    "misses": ["specific miss referencing numbers", "another miss"],
    "nextWeekFocus": "1-2 sentences on what to prioritize next week"
  },

  "competitorInsights": [
    {
      "account": "@username",
      "topReel": "reel caption or description",
      "likes": number,
      "whyItWorked": "2-3 sentences analyzing why this content performed well",
      "takeaway": "1 sentence actionable takeaway for El Capitán"
    }
  ],

  "captionTemplates": [
    {
      "caption": "full ready-to-use caption text",
      "platform": "IG or TikTok",
      "format": "Reel or Post or Story",
      "inspiration": "what this is based on (your data or competitor data)",
      "hashtags": ["tag1", "tag2", "tag3"]
    }
  ],

  "keyInsights": {
    "summary": "2-3 sentences synthesizing the single most important strategic insight from ALL data. This appears on the HQ dashboard — make it specific and actionable, not generic.",
    "wins": ["specific win with actual numbers", "another win"],
    "gaps": ["specific gap with actual numbers", "another gap"],
    "nextPriority": "The single most important 30-day focus for El Capitán right now",
    "strategicPosition": "1-2 sentences on where El Capitán is in their growth trajectory and what growth phase they are in"
  },

  "trackPostMatches": [
    {
      "trackName": "exact name from allTrackNames",
      "igPosts": [{"caption": "snippet", "views": 0, "likes": 0, "engRate": 0.0, "date": "YYYY-MM-DD"}],
      "ttPosts": [{"caption": "snippet", "views": 0, "likes": 0, "engRate": 0.0, "date": "YYYY-MM-DD"}],
      "insight": "1 sentence about this track's social media performance based on matched posts"
    }
  ],

  "smartSchedule": [
    {
      "day": "Monday",
      "time": "12:30 PM",
      "platform": "IG or TikTok",
      "reason": "reason referencing YOUR actual post timing data"
    }
  ]
}

RULES:
- CRITICAL: The industryBestPractices array contains 2026 algorithm intelligence for both TikTok and Instagram (entries starting with "TIKTOK ALGO:" and "INSTAGRAM ALGO:"). EVERY content, posting, and strategy recommendation MUST be grounded in these algorithm signals. When suggesting post ideas, specify why the format optimizes for the relevant algorithm (e.g., "Reel under 90s with text overlay + strong hook = optimized for IG shares + muted viewing"). When suggesting posting times or frequency, reference the algorithm data.
- Use industryBestPractices context to inform all recommendations.
- performanceAlerts: exactly 2-3 items
- opportunityAlerts: exactly 2-3 items
- avoidItems: exactly 3-4 items based on what the DATA shows doesn't work, not generic advice
- postingCadenceAnalysis.competitors: include up to 4 from the competitor data
- priorityFormats: exactly 5-8 items ranked by impact, based on what works for competitors at this follower level
- priorities: exactly 3 items
- postIdeas: exactly 3 items, use actual track names from the data if available. CRITICAL: check each track's stage field — tracks with stage "Released", "Rollout Active", or a releasedAt date are ALREADY OUT. Never suggest "Should I drop this?", pre-release teasers, or release countdown content for already-released tracks. Instead suggest promotion, milestone, or follow-up content.
- actionableAlerts: 3-5 items. Types: add_pipeline (suggest content idea), add_task (suggest a task), suggestion (info only). Use real track names and metrics.
- weeklyReview: 2-4 wins, 2-3 misses. Reference actual numbers from the data. Be honest about misses.
- competitorInsights: 3-5 items, one per top competitor reel from the data. Explain WHY it worked.
- captionTemplates: 5-8 items. Mix styles from the artist's top captions AND competitor top captions. Make them ready-to-post with hashtags.
- smartSchedule: 5-7 items. Use the postTiming data to find patterns. If postTiming.ig has fewer than 8 posts OR postTiming.tt has fewer than 8 posts, add "(low confidence — small sample)" to that platform's reason fields.
- keyInsights: required. summary must be HQ-appropriate — specific numbers, not generic. Synthesize across all platforms and tracks.
- trackPostMatches: match posts from allIGPosts/allTTPosts to tracks in allTrackNames using caption keywords, track name mentions, or date proximity to known release dates. Calculate engRate = (likes / views * 100) for reels, (likes + comments) / ig.followers * 100 for images. Only include tracks with at least 1 matched post. Omit tracks with zero matches.
- Use ONLY the data provided. Do not invent metrics or track names.
- Be specific: reference actual numbers, track names, and platform names.
- Tone: direct, confident, slightly informal. Like a strategist briefing an artist.
- If trackToPush has no tracks available, set it to null.
- Return valid JSON only.`;
}

function validateAIResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const result = {};

  // Weekly narrative — the headline flowing-paragraph briefing for HQ.
  // Must be a substantial chunk of text (>= 200 chars) since it's the primary
  // thing the user reads on Monday.
  if (typeof parsed.weeklyNarrative === 'string' && parsed.weeklyNarrative.length >= 200)
    result.weeklyNarrative = parsed.weeklyNarrative.trim();

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

  // Actionable alerts
  if (Array.isArray(parsed.actionableAlerts) && parsed.actionableAlerts.length >= 1 && parsed.actionableAlerts.every(a => a.id && a.type && a.title))
    result.actionableAlerts = parsed.actionableAlerts.slice(0, 5);

  // Weekly review
  if (parsed.weeklyReview?.headline && Array.isArray(parsed.weeklyReview?.wins) && Array.isArray(parsed.weeklyReview?.misses))
    result.weeklyReview = parsed.weeklyReview;

  // Competitor insights
  if (Array.isArray(parsed.competitorInsights) && parsed.competitorInsights.length >= 1 && parsed.competitorInsights.every(c => c.account && c.whyItWorked))
    result.competitorInsights = parsed.competitorInsights.slice(0, 5);

  // Caption templates
  if (Array.isArray(parsed.captionTemplates) && parsed.captionTemplates.length >= 1 && parsed.captionTemplates.every(c => c.caption && c.platform))
    result.captionTemplates = parsed.captionTemplates.slice(0, 8);

  // Smart schedule
  if (Array.isArray(parsed.smartSchedule) && parsed.smartSchedule.length >= 1 && parsed.smartSchedule.every(s => s.day && s.time && s.platform))
    result.smartSchedule = parsed.smartSchedule.slice(0, 7);

  // Key insights
  if (parsed.keyInsights?.summary && typeof parsed.keyInsights.summary === 'string' && parsed.keyInsights.summary.length > 10)
    result.keyInsights = parsed.keyInsights;

  // Track post matches
  if (Array.isArray(parsed.trackPostMatches) && parsed.trackPostMatches.length >= 1 && parsed.trackPostMatches.every(t => t.trackName))
    result.trackPostMatches = parsed.trackPostMatches.slice(0, 10);

  const validCount = Object.keys(result).length;
  console.log(`  Validated ${validCount}/20 AI fields`);
  return validCount > 0 ? result : null;
}

// ─── Growing-brain library accumulation ─────────────────────────
// Each Monday's AI run produces fresh ideas (caption templates, post ideas,
// competitor insights, priority formats). Instead of overwriting the previous
// week's ideas, we MERGE them into a persistent library at `library/*` in
// Firebase. Each entry is keyed by a normalized hash so we dedupe across
// weeks. Existing entries get a bumped `lastSeenAt`; new ones get
// `firstAddedAt = now`. Pruning keeps each library at MAX_LIB_SIZE most
// recently-relevant entries (most recently seen + tied-by-recency).

const MAX_LIB_SIZE = 200;

// Build a stable, normalized key for deduplication.
function libKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 12)        // first 12 normalized tokens — cap so trivial edits still dedupe
    .join('-');
}

// Merge a list of new entries into an existing library object.
// `existing` is a flat object keyed by libKey. `newItems` is the array.
// `keyFn` builds the key from each item. Returns the merged & pruned object.
function mergeIntoLibrary(existing, newItems, keyFn, weekOf, now) {
  const lib = { ...(existing || {}) };
  let added = 0, updated = 0;
  for (const item of (newItems || [])) {
    const k = keyFn(item);
    if (!k || k.length < 3) continue;
    if (lib[k]) {
      lib[k] = {
        ...lib[k],
        ...item,                // refresh fields with latest AI values
        firstAddedAt: lib[k].firstAddedAt || now,
        lastSeenAt: now,
        seenCount: (lib[k].seenCount || 1) + 1,
        weeksSeen: Array.from(new Set([...(lib[k].weeksSeen || []), weekOf])).slice(-12),
      };
      updated++;
    } else {
      lib[k] = {
        ...item,
        firstAddedAt: now,
        lastSeenAt: now,
        seenCount: 1,
        weeksSeen: [weekOf],
      };
      added++;
    }
  }
  // Prune: keep MAX_LIB_SIZE entries with the most recent lastSeenAt.
  const entries = Object.entries(lib);
  if (entries.length > MAX_LIB_SIZE) {
    entries.sort((a, b) => (b[1].lastSeenAt || '').localeCompare(a[1].lastSeenAt || ''));
    const kept = entries.slice(0, MAX_LIB_SIZE);
    const pruned = {};
    for (const [k, v] of kept) pruned[k] = v;
    return { lib: pruned, added, updated, pruned: entries.length - MAX_LIB_SIZE };
  }
  return { lib, added, updated, pruned: 0 };
}

// Run all the merges for one weekly AI cycle. Reads + writes happen in the
// caller; this just produces the new library objects to PUT.
async function accumulateLibraries(weeklyStrategy, weekOf, now) {
  if (!weeklyStrategy) return;
  console.log('\n🧠 Growing-brain library accumulation...');

  const [existingCaptions, existingIdeas, existingCompetitors, existingFormats] = await Promise.all([
    readFirebase('library/captionTemplates'),
    readFirebase('library/postIdeas'),
    readFirebase('library/competitorInsights'),
    readFirebase('library/priorityFormats'),
  ]);

  const writes = [];

  if (Array.isArray(weeklyStrategy.captionTemplates) && weeklyStrategy.captionTemplates.length) {
    const r = mergeIntoLibrary(existingCaptions, weeklyStrategy.captionTemplates,
      (it) => libKey((it.platform || '') + ' ' + (it.caption || '')), weekOf, now);
    writes.push(writeFirebase('library/captionTemplates', r.lib));
    console.log(`  📝 captionTemplates: +${r.added} new, ${r.updated} updated, ${r.pruned} pruned (total ${Object.keys(r.lib).length})`);
  }

  if (Array.isArray(weeklyStrategy.postIdeas) && weeklyStrategy.postIdeas.length) {
    const r = mergeIntoLibrary(existingIdeas, weeklyStrategy.postIdeas,
      (it) => libKey((it.format || '') + ' ' + (it.idea || '')), weekOf, now);
    writes.push(writeFirebase('library/postIdeas', r.lib));
    console.log(`  💡 postIdeas: +${r.added} new, ${r.updated} updated, ${r.pruned} pruned (total ${Object.keys(r.lib).length})`);
  }

  if (Array.isArray(weeklyStrategy.competitorInsights) && weeklyStrategy.competitorInsights.length) {
    const r = mergeIntoLibrary(existingCompetitors, weeklyStrategy.competitorInsights,
      (it) => libKey((it.account || '') + ' ' + (it.topReel || it.whyItWorked || '').slice(0, 60)), weekOf, now);
    writes.push(writeFirebase('library/competitorInsights', r.lib));
    console.log(`  🔍 competitorInsights: +${r.added} new, ${r.updated} updated, ${r.pruned} pruned (total ${Object.keys(r.lib).length})`);
  }

  if (Array.isArray(weeklyStrategy.priorityFormats) && weeklyStrategy.priorityFormats.length) {
    const r = mergeIntoLibrary(existingFormats, weeklyStrategy.priorityFormats,
      (it) => libKey(it.format || ''), weekOf, now);
    writes.push(writeFirebase('library/priorityFormats', r.lib));
    console.log(`  🎬 priorityFormats: +${r.added} new, ${r.updated} updated, ${r.pruned} pruned (total ${Object.keys(r.lib).length})`);
  }

  await Promise.all(writes);
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

  // Count posts since Monday (Mon-Sun week)
  const mondayMs = getMondayStartMs();
  const recentIG = (latest?.igPosts || []).filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > mondayMs;
  }).length;
  const recentTT = (latest?.ttPosts || []).filter(p => {
    const ts = p.createTimeISO ? new Date(p.createTimeISO).getTime() : 0;
    return ts > mondayMs;
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

  const RELEASED_STAGES = ['Released', 'Rollout Active', 'Archived / Hold'];
  const hotTrack = tracks
    .filter(t => (t.status === 'PUSH' || t.status === 'FINISH') && (t.momentumScore || 0) > 40)
    .sort((a, b) => (b.momentumScore || 0) - (a.momentumScore || 0))[0];
  if (hotTrack) {
    const isReleased = RELEASED_STAGES.includes(hotTrack.stage) || !!hotTrack.releasedAt;
    if (isReleased) {
      // Track is already out — suggest promotion content instead
      ideas.push({
        idea: `Promotion reel for ${hotTrack.name} — "X plays already" milestone or crowd/reaction clip`,
        reason: `Already released | Momentum: ${hotTrack.momentumScore} | Keep pushing while it has traction`,
        format: 'Reel',
      });
    } else {
      ideas.push({
        idea: `"Should I drop this?" reel for ${hotTrack.name}`,
        reason: `Momentum: ${hotTrack.momentumScore} | Status: ${hotTrack.status}`,
        format: 'Reel',
      });
    }
  }

  // Use top reel from accumulated pool if available, else fall back to snapshot
  const topCompReel = (competitors?.poolPatterns?.top10 || competitors?.patterns?.top10 || [])[0];
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
    .filter(t => t.status === 'PUSH' || t.status === 'FINISH') // HOLD/DONE/KILL excluded from AI attention
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

// ─── Daily insight prompt (lightweight) ────────────────────────

function buildDailyPrompt(dataSummary, previousStrategy) {
  const prevInsight = previousStrategy?.dailyInsight || null;
  const weeklyGeneratedAt = previousStrategy?.generatedAt || 'unknown';
  const weeklyPriorities = previousStrategy?.priorities || [];
  const weeklyTrackToPush = previousStrategy?.trackToPush || null;

  return `You are a music marketing strategist AI for an emerging DJ/producer called "El Capitán" who makes tech house music. Generate a concise daily morning briefing based on the latest data.

CURRENT DATA:
${JSON.stringify(dataSummary)}

PREVIOUS DAILY INSIGHT (yesterday):
${prevInsight ? JSON.stringify(prevInsight) : 'None (first daily run)'}

TODAY: ${new Date().toLocaleDateString('en-US', { weekday: 'long' })} (Day ${(() => { const d = new Date(); const dow = d.getUTCDay(); return dow === 0 ? 7 : dow; })()}/7 of the Mon-Sun week)
Posts so far this week: ${dataSummary.postsThisWeek?.total || 0} / ${dataSummary.postsThisWeek?.target || 5} target

ACTIVE WEEKLY STRATEGY (generated ${weeklyGeneratedAt}):
- Priorities: ${JSON.stringify(weeklyPriorities)}
- Track to push: ${weeklyTrackToPush ? weeklyTrackToPush.name : 'None'}

Return a JSON object with EXACTLY these fields:

{
  "dailyInsight": {
    "generatedAt": "${new Date().toISOString()}",
    "headline": "1 punchy sentence — what's the single most important thing to know this morning",
    "yesterdayChanges": {
      "summary": "2-3 sentences on what changed since yesterday: follower deltas, new post performance, engagement shifts. Be specific with numbers.",
      "highlights": [
        { "metric": "metric name", "value": "current value", "change": "+X or -X", "sentiment": "up or down or flat" }
      ]
    },
    "weekProgress": {
      "summary": "2-3 sentences on how the week is going overall. Rolling 7-day trends, progress toward weekly priorities. Reference the active weekly strategy.",
      "postsThisWeek": ${dataSummary.postsThisWeek?.total || 0},
      "postsTarget": ${dataSummary.postsThisWeek?.target || 5},
      "onTrack": true or false
    },
    "todayAction": {
      "primary": "The #1 thing to do TODAY — specific, actionable, achievable in one session",
      "reason": "Why this matters today specifically, referencing data",
      "secondary": "Optional second action if time allows"
    },
    "mood": "fire or steady or grind or alert"
  }
}

RULES:
- mood: "fire" = great momentum/metrics up, "steady" = things are on track, "grind" = need to push harder/behind on goals, "alert" = something needs urgent attention
- yesterdayChanges.highlights: 3-5 items covering followers, engagement, plays, views across platforms
- Be specific with numbers — no generic advice
- todayAction should align with the active weekly priorities but be day-specific
- CRITICAL: The week runs Monday to Sunday. Evaluate posting cadence relative to the day of the week. On Monday, 0 posts is expected (the week just started) — don't alarm about being behind. On Wednesday, 1-2 posts is on pace. By Friday, 3+ posts means on track. Only flag cadence as a concern if the artist is genuinely behind the pace for the current day, not just because the absolute count is low early in the week.
- weekProgress.onTrack should account for the day of week: on Monday, 0 posts = on track. The expected pace is roughly (dayOfWeek / 7) * target.
- If this is the first daily run (no previous insight), focus yesterdayChanges on current state vs 7-day trends instead
- Use industryBestPractices context to inform the todayAction recommendation. CRITICAL: The industryBestPractices array contains 2026 algorithm intelligence (entries starting with "TIKTOK ALGO:" and "INSTAGRAM ALGO:"). The todayAction MUST be grounded in algorithm-optimal behavior (e.g., if suggesting a post, explain which algorithm signal it targets like completion rate, DM shares, saves, etc.)
- Tone: direct, motivating, like a coach's morning briefing
- Return valid JSON only.`;
}

function validateDailyResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const di = parsed.dailyInsight;
  if (!di) return null;

  if (!di.headline || typeof di.headline !== 'string') return null;
  if (!di.yesterdayChanges?.summary) return null;
  if (!di.weekProgress?.summary) return null;
  if (!di.todayAction?.primary) return null;

  // Ensure generatedAt is set
  if (!di.generatedAt) di.generatedAt = new Date().toISOString();
  // Ensure mood has a valid value
  if (!['fire', 'steady', 'grind', 'alert'].includes(di.mood)) di.mood = 'steady';

  console.log('  ✓ Daily insight validated');
  return di;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10);

  console.log(`\n📋 Daily Strategy Generator — ${dateKey}\n`);

  // One-time diagnostic — log what models are available for this API key
  await listAvailableModels();

  // Read all Firebase data + existing strategy
  const [latest, history, competitors, allReelsPool, state, existingStrategy] = await Promise.all([
    readFirebase('analytics/latest'),
    readFirebase('analytics/history'),
    readFirebase('competitors/latest'),
    readFirebase('competitors/allReels'),  // accumulated reel pool
    readFirebase('state'),
    readFirebase('strategy/latest'),
  ]);
  const poolSize = allReelsPool ? Object.keys(allReelsPool).length : 0;
  console.log(`  Competitor pool: ${poolSize} accumulated reels`);

  if (!latest) {
    console.log('⚠️  No analytics data found — run daily scrape first');
    return;
  }

  console.log('  Data loaded from Firebase');

  // Determine if weekly strategy needs regeneration
  // Weekly runs on Mondays (or first run if no strategy exists)
  const todayDate = new Date();
  const isMonday = todayDate.getUTCDay() === 1; // GitHub Actions runs in UTC; 10:15 UTC = 6:15am ET
  const lastWeeklyAt = existingStrategy?.generatedAt;
  const lastWeeklyDate = lastWeeklyAt ? new Date(lastWeeklyAt).toISOString().slice(0, 10) : null;
  const todayStr = todayDate.toISOString().slice(0, 10);
  const alreadyRanToday = lastWeeklyDate === todayStr;
  const forceWeekly = process.env.FORCE_WEEKLY === 'true';
  const needsWeekly = forceWeekly || (!existingStrategy?.priorities) || (isMonday && !alreadyRanToday);

  console.log(`  Last weekly strategy: ${lastWeeklyDate || 'never'}`);
  console.log(`  Today: ${todayStr} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][todayDate.getUTCDay()]})`);
  console.log(`  Mode: ${needsWeekly ? 'WEEKLY + DAILY (Monday refresh)' : 'DAILY ONLY'}\n`);

  const dataSummary = buildDataSummary(latest, history, competitors, state, allReelsPool);

  // ── WEEKLY STRATEGY (only if 7+ days since last) ──
  let weeklyStrategy = null;
  if (needsWeekly) {
    if (GEMINI_API_KEY) {
      console.log('🤖 Generating weekly strategy via Gemini...');
      const prompt = buildPrompt(dataSummary);
      const raw = await callGemini(prompt);
      let aiFields = null;
      if (raw) {
        aiFields = validateAIResponse(raw);
        if (aiFields) {
          console.log('  ✓ AI weekly strategy generated');
        } else {
          console.log('  ⚠️ AI response failed validation — using rule-based fallback');
        }
      }

      // ── Carry-over fallback: if AI failed entirely, copy AI fields from the
      // most recent strategy in history (so the dashboard never goes blank) ──
      let carryOver = null;
      if (!aiFields && existingStrategy) {
        const candidates = ['weeklyNarrative', 'competitorInsights', 'captionTemplates', 'smartSchedule', 'keyInsights',
                            'priorityFormats', 'actionableAlerts', 'weeklyReview', 'avoidItems',
                            'postingCadenceAnalysis', 'artistScoreInsight', 'trendAnalysis',
                            'performanceAlerts', 'opportunityAlerts', 'trackPostMatches'];
        const hasAny = candidates.some(f => existingStrategy[f] != null);
        if (hasAny) {
          carryOver = existingStrategy;
          console.log('  ↻ Carrying over AI fields from previous strategy (Gemini unavailable this run)');
        }
      }

      weeklyStrategy = {
        generatedAt: now,
        weekOf: dateKey,
        aiGenerated: !!aiFields,
        carriedOver: !aiFields && !!carryOver,
        carriedOverFrom: !aiFields && carryOver ? (carryOver.generatedAt || null) : null,
        weeklyNarrative: aiFields?.weeklyNarrative || carryOver?.weeklyNarrative || null,
        priorities: aiFields?.priorities || carryOver?.priorities || computePriorities(latest, state, history),
        postIdeas: aiFields?.postIdeas || carryOver?.postIdeas || computePostIdeas(latest, competitors, state),
        trackToPush: aiFields?.trackToPush !== undefined ? aiFields.trackToPush : (carryOver?.trackToPush !== undefined ? carryOver.trackToPush : pickTrackToPush(state?.tracks)),
        campaignAction: aiFields?.campaignAction || carryOver?.campaignAction || evaluateCampaigns(state?.campaigns, latest),
        alertsToHandle: pickTopAlerts(latest?.alerts),
        artistScoreInsight: aiFields?.artistScoreInsight || carryOver?.artistScoreInsight || null,
        trendAnalysis: aiFields?.trendAnalysis || carryOver?.trendAnalysis || null,
        performanceAlerts: aiFields?.performanceAlerts || carryOver?.performanceAlerts || null,
        opportunityAlerts: aiFields?.opportunityAlerts || carryOver?.opportunityAlerts || null,
        avoidItems: aiFields?.avoidItems || carryOver?.avoidItems || null,
        postingCadenceAnalysis: aiFields?.postingCadenceAnalysis || carryOver?.postingCadenceAnalysis || null,
        priorityFormats: aiFields?.priorityFormats || carryOver?.priorityFormats || null,
        actionableAlerts: aiFields?.actionableAlerts || carryOver?.actionableAlerts || null,
        weeklyReview: aiFields?.weeklyReview || carryOver?.weeklyReview || null,
        competitorInsights: aiFields?.competitorInsights || carryOver?.competitorInsights || null,
        captionTemplates: aiFields?.captionTemplates || carryOver?.captionTemplates || null,
        smartSchedule: aiFields?.smartSchedule || carryOver?.smartSchedule || null,
        keyInsights: aiFields?.keyInsights || carryOver?.keyInsights || null,
        trackPostMatches: aiFields?.trackPostMatches || carryOver?.trackPostMatches || null,
      };
    } else {
      console.log('⚠️  No GEMINI_API_KEY — using rule-based weekly strategy');
      weeklyStrategy = {
        generatedAt: now,
        weekOf: dateKey,
        aiGenerated: false,
        priorities: computePriorities(latest, state, history),
        postIdeas: computePostIdeas(latest, competitors, state),
        trackToPush: pickTrackToPush(state?.tracks),
        campaignAction: evaluateCampaigns(state?.campaigns, latest),
        alertsToHandle: pickTopAlerts(latest?.alerts),
      };
    }

    console.log('\n🎯 WEEKLY PRIORITIES:');
    weeklyStrategy.priorities.forEach((p, i) => console.log(`  ${i + 1}. ${p.priority} — ${p.reason}`));
    console.log('🎵 TRACK TO PUSH:', weeklyStrategy.trackToPush?.name || 'None');
  }

  // ── DAILY INSIGHT (every run) ──
  let dailyInsight = null;
  if (GEMINI_API_KEY) {
    console.log('\n🌅 Generating daily insight via Gemini...');
    const activeStrategy = weeklyStrategy || existingStrategy || {};
    const dailyPrompt = buildDailyPrompt(dataSummary, activeStrategy);
    const dailyRaw = await callGemini(dailyPrompt);
    if (dailyRaw) {
      dailyInsight = validateDailyResponse(dailyRaw);
      if (!dailyInsight) {
        console.log('  ⚠️ Daily insight failed validation');
      }
    }
  }

  if (dailyInsight) {
    console.log(`\n🌅 DAILY HEADLINE: ${dailyInsight.headline}`);
    console.log(`   TODAY: ${dailyInsight.todayAction.primary}`);
    console.log(`   MOOD: ${dailyInsight.mood}`);
  }

  const duration = Date.now() - startMs;

  // ── Write to Firebase ──
  console.log('\n💾 Writing to Firebase...');

  if (needsWeekly && weeklyStrategy) {
    // Full PUT — replaces entire strategy/latest with weekly + daily
    weeklyStrategy.dailyInsight = dailyInsight;
    weeklyStrategy.dailyInsightAt = dailyInsight?.generatedAt || now;
    await Promise.all([
      writeFirebase('strategy/latest', weeklyStrategy),
      writeFirebase(`strategy/history/${dateKey}`, weeklyStrategy),
    ]);

    // GROWING BRAIN — merge this week's AI ideas into accumulating libraries.
    // Only runs on weekly refresh (not daily) so the library grows by ~1 week's
    // worth of fresh ideas each Monday rather than churning daily.
    try {
      await accumulateLibraries(weeklyStrategy, dateKey, now);
    } catch (err) {
      console.log(`  ⚠️  Library accumulation failed (non-fatal): ${err.message}`);
    }
  } else {
    // PATCH — only update daily insight fields, preserve existing weekly strategy
    const patch = {
      dailyInsight: dailyInsight,
      dailyInsightAt: dailyInsight?.generatedAt || now,
    };
    await Promise.all([
      patchFirebase('strategy/latest', patch),
      patchFirebase(`strategy/history/${dateKey}`, patch),
    ]);
  }

  // Write job log
  await writeFirebase(`jobs/strategy/${dateKey}`, {
    status: 'success',
    startedAt: now,
    completedAt: new Date().toISOString(),
    duration,
    mode: needsWeekly ? 'weekly+daily' : 'daily',
    aiGenerated: !!dailyInsight || !!(weeklyStrategy?.aiGenerated),
    records: {
      weeklyRefreshed: needsWeekly,
      dailyInsightGenerated: !!dailyInsight,
      priorities: weeklyStrategy?.priorities?.length || existingStrategy?.priorities?.length || 0,
    },
    estimatedCost: 0,
    error: null,
  });

  const mode = needsWeekly ? 'Weekly + Daily' : 'Daily only';
  console.log(`\n✅ Strategy generated! (${mode}) Duration: ${(duration / 1000).toFixed(1)}s`);
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
