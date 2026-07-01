# El Capitan Dashboard — Data-Focused Redesign Brainstorm

**Design premise:** The hero metric is **FOLLOWS-FROM-POST** (`igInsights.follows`). ~54% of the audience is passive Union College students who watch but don't like/comment, so likes-based engagement rate systematically under-reads good content and over-reads friend-group posts. Every module below either (a) normalizes around follows, (b) uses "silent" signals passive viewers DO emit (saves, shares, watch time, completion, taps-back), or (c) turns the under-used `analytics/history` time series into trend answers.

**Signal-quality ladder for THIS account** (design everything around this):

| Trust | Metric | Why |
|---|---|---|
| GOLD | `follows` per post, `profileVisits`, `saves`, `shares` | Deliberate actions; passive viewers still do these |
| GOOD | `reach`, `views`, `avgWatchTimeMs`, story `completionRate`, `tapsBack` | Behavioral, not social — lurker-proof |
| CONDITIONAL | `skipRate` — trustworthy on **trial reels** (cold audience = true hook test), noisy on graduated reels (mixed warm/cold audience) | Summary already splits `avgSkipRateTrial` vs `avgSkipRateGraduated` — use the split, never the blend |
| NOISE | likes, comments, engRate, hearts, "total impressions" | 54% of the audience never emits these |

---

## TIER 1 — High signal, buildable from today's data, this week

### 1. FPM — Follows Per Mille (the new hero number)
- **Fields:** `igInsights.follows`, `igInsights.reach` (per media).
- **Decision:** "Which of my posts actually grow me?" — the single ranking that replaces engagement rate everywhere.
- **Compute/look:** `follows / reach × 1000` per post. Big hero card: trailing-30d FPM with 7d trend arrow. Every post row in every table shows its FPM badge. Trailing median FPM = the bar every new post must clear.
- **Feasibility:** Trivial — two existing fields, one division. Do this first; ideas 2, 4, 6, 8 all build on it.

### 2. Winning Pattern Engine ("what to post next", answered by his own data)
- **Fields:** join `igInsights` (follows, reach, saves, shares) with `igPosts` by media id (caption, hashtags[], type, timestamp) — the join key exists.
- **Decision:** The literal spec for the next post: format, day, caption style, hashtag set.
- **Compute/look:** Rank all posts by FPM. Take top quartile vs bottom quartile, diff their attributes: media type (Reel/Image/Sidecar), caption length bucket (<50 / 50–150 / >150 chars), has-emoji, hashtag count, specific hashtag presence, day-of-week, hour bucket, CTA keyword regex (`comment|link in bio|dm|should i drop`). Render one plain-English card: *"Your top posts are Reels, posted Tue–Wed, <80-char caption with a 'should I drop this?' CTA — 3.1× the FPM of your bottom quartile."* Only show attributes where n ≥ 5 posts per bucket (honesty guard at ~30–50 posts total).
- **Feasibility:** All fields exist. This is the highest-leverage build in the whole document.

### 3. Per-Post Conversion Funnel — "content problem or profile problem?"
- **Fields:** `igInsights.reach → profileVisits → follows` per media.
- **Decision:** Two different fixes: low reach→visit rate = weak content/hook; high visit rate but low visit→follow rate = the PROFILE (bio, grid, pinned reels) is leaking — fix the profile, stop blaming the content.
- **Compute/look:** Two ratios per post: visit rate (`profileVisits/reach`) and profile conversion (`follows/profileVisits`). Aggregate card: "Your profile converts X% of visitors to followers (trailing 30d)" with trend from history. The existing dashboard already knows visits are 23% but link clicks 1% — this makes the leak per-post and trendable.
- **Feasibility:** All fields exist. The profile-conversion trend from `analytics/history` is the first thing to check after any bio/grid change.

### 4. Trial Reel Verdict Engine
- **Fields:** `igTrialReels.reels{}` (full insight objects), `igInsightsSummary.avgSkipRateTrial`, `avgSkipRateGraduated`, `trialFollows`, `graduatedFollows`.
- **Decision:** Which trial concepts to graduate/repeat, which angles to kill. Trial reels are his only clean cold-audience A/B lab — treat them as such.
- **Compute/look:** Per trial reel: FPM + skipRate vs the trial-cohort average. Verdict labels: **GRADUATE-WORTHY** (FPM > graduated median AND skipRate < trial avg), **HOOK WORKS, CONTENT DOESN'T** (low skip, low FPM), **KILL ANGLE** (both bad). Track trial→graduated trajectory: for reels that graduated, did FPM hold up in front of the warm audience?
- **Feasibility:** Everything exists, including the pre-split skip-rate baselines. Also fixes an honesty bug: show skipRate ONLY in trial context; grey it out on graduated reels with a tooltip "unreliable for mixed audiences."

### 5. Follower Velocity & Attribution Timeline (the untapped `history` asset, part 1)
- **Fields:** `analytics/history/<date>/ig.followers` (daily), `igPosts[].timestamp`.
- **Decision:** "Is my strategy accelerating?" and "which post caused that spike?"
- **Compute/look:** Daily follower delta → 7d rolling velocity → velocity-vs-prior-week acceleration (▲/▼). Line chart with post markers overlaid; spikes visually attach to specific posts. Bonus honesty check: compare the 48h post-spike delta vs that post's `igInsights.follows` — the gap = spillover follows Meta doesn't attribute (Explore, shares, word of mouth). Add "days to 500 followers at current velocity."
- **Feasibility:** History accumulates daily already; this is pure read-side computation.

### 6. Outperformance Badges — "beat your own median"
- **Fields:** rolling window of last 10–15 reels from `igInsights` (reach, FPM, save rate, share rate).
- **Decision:** 48h post-mortem: is the newest post above or below MY normal? (Absolute numbers at 312 followers are meaningless; relative-to-self is the only honest benchmark.)
- **Compute/look:** For the latest post, ▲/▼ vs trailing median on 4 metrics + one composite letter grade (weights: FPM 50%, save rate 20%, share rate 15%, visit rate 15%). One glanceable "Post Report Card" at the top of Analytics.
- **Feasibility:** Trivial once FPM exists. Store nothing new; compute at render.

### 7. Silent-Engagement Rate (the lurker-corrected engagement metric)
- **Fields:** `igInsights.saves`, `shares`, `reach`.
- **Decision:** What content resonates with the 54% who never like — saves = "I'll come back to this," shares = "my friends need to see this." For a DJ, shares are the gig-hype proxy.
- **Compute/look:** `(saves + shares) / reach` per post, replacing engRate in post tables. Split view: Save-Rate leaders (evergreen/track content) vs Share-Rate leaders (hype/event content) — they answer different questions (what to make more of vs what to post before a gig).
- **Feasibility:** Fields exist per-media. The overview already flags "7 saves" as low — this makes it a per-post, actionable dimension.

### 8. Breakout Factor — "am I escaping the Union bubble?"
- **Fields:** `igInsights.reach` per post ÷ `ig.followers` at post time (follower count from the matching `history` snapshot).
- **Decision:** Which content the algorithm pushes beyond his own audience — directly serves the stated NYC/Boston expansion goal.
- **Compute/look:** reach/followers ratio per post: <1× = didn't even reach own audience, 1–3× = normal, >3× = algorithm pickup. Tag breakout posts and feed their attributes into the Winning Pattern Engine (#2) as a second target variable ("what predicts breakout" vs "what predicts follows" — if they differ, that's a strategy fork worth showing).
- **Feasibility:** All data exists; history supplies the historically-correct denominator.

### 9. duer.wav Head-to-Head Strip (honest edition)
- **Fields:** `creatorTracking.creators.duer_wav` (followers, followerDelta, avgEngagement, recentPosts[].timestamp/format/likes/comments) + same-shaped self data + `history` for both trajectories.
- **Decision:** "Is he out-executing me (cadence) or out-creating me (per-post pull)?" — two different responses.
- **Compute/look:** Four comparable-only rows: (1) weekly follower growth **%** (relative, since bases differ), (2) posts/week derived from recentPosts timestamps, (3) engagement-per-follower per post (likes+comments ÷ followers — the only fair public-data normalization), (4) format mix bar (his Reel/Carousel/Image split vs Reid's). Explicit "not comparable" footer: no reach/saves/watch data for him — do NOT show his engRate next to Reid's insight metrics.
- **Feasibility:** All fields collected daily; history gives the dual growth curves. Cadence-from-timestamps is a five-line derivation.

### 10. Follows-Weighted Posting Heatmap
- **Fields:** `igPosts[].timestamp` × `igInsights.follows/reach` (replacing likes as the weight in the existing When-to-Post logic).
- **Decision:** When to schedule the week's posts — weighted by the metric that matters, not by likes from friends who are online at social hours.
- **Compute/look:** Day×time-block grid, cell = mean FPM (n shown; grey cells with n<3). Overlay duer.wav's posting times from his recentPosts timestamps as dots — is he owning a time slot Reid isn't contesting?
- **Feasibility:** Same derivation as the current When-to-Post, different weight. One-line change conceptually.

### 11. Story Signal Panel + Warm-Lead List (gig demand instruments)
- **Fields:** `igStories.stories{}` (completionRate, replies, tapsBack, exits, mediaType, timestamp), `igComments` (uniqueCommenters, recentComments, warmIntros), `igDemographics.topCities`.
- **Decision:** (a) Which story types keep the warm audience watching (completion + tapsBack rank), so gig announcements land on a primed audience; (b) WHO to DM — repeat commenters + story repliers are the ticket-buying core.
- **Compute/look:** Story-type leaderboard by completion; "taps-back" flagged as the re-watch signal. Below it, a "Warm 20" list: usernames appearing ≥2× across recentComments/replies, sortable, with a "DM about Friday" checklist column (manual check state in Firebase, like tasks).
- **Feasibility:** All collected. `warmIntros[]` already exists and is currently buried — promote it.

### 12. Cadence→Growth Validator
- **Fields:** `history` weekly follower deltas × weekly post counts (from `igPosts[].timestamp`).
- **Decision:** Does posting more actually grow followers *for him*, or is the 4-5/week target cargo-culted from competitors? Validates or corrects the dashboard's own #1 nag.
- **Compute/look:** Scatter of week-buckets (x = posts that week, y = follower delta), with a simple correlation readout and a caveat when n(weeks) < 10. If the slope is real, the cadence alert earns its red banner; if flat, quality>quantity and the alert should soften.
- **Feasibility:** Pure history read. Honesty note: show the n and refuse a verdict below ~8 weeks of history.

### 13. Demographic Drift Tracker
- **Fields:** `history/<date>/igDemographics` (topCities pct, ageGroups, gender).
- **Decision:** Is the Schenectady 41% concentration diluting over time (goal) and are NYC/Boston pcts rising? This converts a static pie into a strategy progress bar.
- **Compute/look:** Small-multiples sparkline per tracked city (Schenectady ↓ target, NYC ↑, Boston ↑, Albany). Alert only on trend reversals, not levels.
- **Feasibility:** History already snapshots demographics daily. Note pcts move slowly at 312 followers — monthly resampling, not daily.

### 14. SC Lift Overlay
- **Fields:** `history/<date>/sc.totalPlays` daily series + `igPosts[].timestamp/caption` (posts whose caption mentions a track name).
- **Decision:** Does IG promo actually drive SoundCloud listens, and which post formats drive it most? (The dashboard already flags "top 3 SC tracks have zero IG promotion" — this measures the payoff of fixing that.)
- **Compute/look:** SC total-plays line with IG post markers; 7d-after vs 7d-before delta per marker. Crude but directional; label it "directional" in the UI.
- **Feasibility:** Both series exist in history. Per-track attribution is fuzzy (SC gives totals + per-track counts via scraper) — keep it at the "did the needle move" level.

### 15. Content Half-Life (history part 2 — per-media snapshots over time)
- **Fields:** `history/<date>/igInsights` — the SAME media id appears across daily snapshots, so per-post reach/follows accumulation curves are reconstructable.
- **Decision:** Which formats spike-and-die in 48h vs keep compounding for a week+. Long-tail formats deserve sequels and pinning; spike formats are event-timed only.
- **Compute/look:** Per post: % of eventual reach earned in first 48h. Cohort by format. One card: "Your studio reels earn 40% of reach after day 2 — your image posts are dead by day 1."
- **Feasibility:** Data already accumulating; nobody is diffing snapshots yet. This is the most under-used property of the history store.

---

## TIER 2 — Needs one small capture change

### 16. True Watch-Time Retention % (the missing hook metric)
- **Fields:** `igInsights.avgWatchTimeMs` ÷ **reel duration** — duration is NOT currently stored.
- **Decision:** The cleanest hook/edit quality score: "viewers watch 62% of this reel vs my 41% median." Combined with trial-reel skipRate, this fully characterizes hook (skip) vs body (retention).
- **Capture change:** The Apify IG post scraper returns `videoDuration` for reels — persist one extra numeric field in `scrape-ig.mjs` / `scrape-ig-insights.mjs`. Backfill is impossible, so start now; useful after ~10 new reels.
- **Interim hack (Tier 1-adjacent):** assume-length mode — rank reels by raw `avgWatchTimeMs` within duration buckets guessed from format; label clearly as approximate.

### 17. Scene/Shot Tagging → Correlation Upgrade
- **Fields:** everything in #2 plus a **manual 1-tap tag per post** (studio/DAW, crowd, talking-head, cover-art, unexpected-location — the Scene Library taxonomy already exists in the dashboard).
- **Decision:** "Do studio-shot reels convert better than cover-art posts?" — the single most-asked creative question, unanswerable from captions alone.
- **Capture change:** A dropdown on each post row writing `sceneTag` to Firebase (same pattern as task checkboxes). 5 seconds of effort per post; the Winning Pattern Engine picks it up as another attribute automatically.

### 18. Loop/Replay Factor
- **Fields:** `igInsights.views ÷ reach` (both exist) — but needs **duration** (#16) to separate "short looping reel replayed" from "long reel, single view."
- **Decision:** Whether loop-style edits (seamless restarts) are worth the edit time.
- **Compute:** views/reach > 1.4 on reels < 10s = loop is working. Without duration it's ambiguous, hence Tier 2.

### 19. Story→Post Priming Test
- **Fields:** `igStories.stories{}.timestamp` × next post's `igInsights.reach` vs trailing median.
- **Decision:** Should he always tease on Stories the same day he posts a reel?
- **Why Tier 2:** computable today, but igStories only holds the current scrape window — needs stories folded into the daily `history` snapshot (config change, not new data source) to accumulate enough paired samples.

---

## TIER 3 — Later / gated on data we don't have yet

### 20. TikTok Cross-Post Efficiency
Same-content FPM/plays comparison IG vs TT per clip. **Gated on the TikTok API migration** (planned per memory). Until then, freeze the stale TT panel behind a "data as of <date>" banner — see demotions below.

### 21. Gig Funnel — Stories → Posh tickets
Story reach/replies in the 7 days pre-event vs manually entered Posh ticket counts. Works with manual entry but only pays off after 4–5 events of data. Design the manual-entry form now (event name, date, tickets, revenue), correlate later.

### 22. Competitor Insight Refresh Loop
Re-rank the Playbook's "priority formats" using Reid's OWN FPM data as it accumulates (self-evidence replacing competitor-evidence), with duer.wav cadence as the ongoing external anchor. Continuous, not a build — but only meaningful after ~2–3 months of igInsights history.

---

## DEMOTE / KILL — current elements that are vanity for THIS audience

1. **engRate as a headline stat** — actively misleading with 54% passive viewers. Replace with FPM (#1) everywhere; move engRate to a details tooltip.
2. **avgLikes / avgComments cards** — noise per the signal ladder. Fold into detail views only.
3. **"45,344 impressions (+1,625%)" / "~13,180 combined reach"** — big numbers, zero decisions. The dashboard itself says "you do NOT need more reach" — so stop headlining reach.
4. **Follower Distribution doughnut (IG vs TT vs SC)** — static, never changes a decision. Kill; the platform numbers live in their own panels.
5. **Live-looking TikTok panel** — data is stale (Apify limit). Collapse it behind an explicit "STALE — last scraped <date>" banner so stale numbers can't silently inform decisions.
6. **Engagement Breakdown doughnut (likes/comments/shares/saves mixed)** — mixes noise (likes) with gold (saves/shares) in one chart, visually equating them. Replace with the Silent-Engagement split (#7).
7. **Artist Score ring** — keep as motivation, but reweight so follows-velocity and FPM dominate; today it lets task-completion and content-volume mask flat growth. At minimum, add FPM as a factor and show which factor moved the score.
8. **Skip rate shown un-split** — conditional metric; only render in trial-reel context (#4).

---

## The synthesis screen ("This Week" panel — where it all lands)

One panel at the top of HQ, four lines, all derived from Tier 1 modules:

1. **Post spec:** "Reel, Tue or Wed, <80-char caption, 'should I drop?' CTA, your own audio" — from Winning Pattern Engine (#2) + Heatmap (#10).
2. **Verdict on last post:** letter grade + one-line reason — from Report Card (#6) + Funnel (#3).
3. **Growth state:** velocity, acceleration arrow, days-to-500 — from Velocity Timeline (#5).
4. **One human action:** top name from the Warm 20 (#11) to DM this week.

That is the entire "what to post, when, and how am I tracking" job, answered from data already sitting in Firebase.

---

## Build order (blunt)

1. **FPM + join layer** (#1) — everything depends on the igPosts↔igInsights join keyed by media id. ~1 day.
2. **Winning Pattern Engine + Report Card + Heatmap** (#2, #6, #10) — the "what/when to post" core.
3. **History readers: Velocity + Half-Life + Cadence Validator** (#5, #15, #12) — unlocks the biggest untapped asset.
4. **Trial Verdict + Funnel + Silent Engagement** (#4, #3, #7) — the honesty layer.
5. **Start capturing `videoDuration` and `sceneTag` NOW** (#16, #17) — zero-cost captures that compound; every week of delay is unrecoverable data.
6. duer.wav strip, Story/Warm-Lead panel, demotions pass.
