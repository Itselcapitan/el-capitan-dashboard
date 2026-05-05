# Next-Generation Scoring Specification

*Run: 2026-05-05 via Gemini Deep Research (scoring redesign follow-up)*
*Purpose: Replace the existing 9-factor Artist Score and 5-factor
Track Score with a velocity-and-intent-driven system using the new
Graph API metrics.*

---

## ⚠️ Pre-Implementation Issues — Must Fix or Validate Before Building

### Issue 1 — Wrong Graph API field name (load-bearing bug)
The spec uses **`media_reels_skip_rate`** throughout, including in
the JS functions. **The actual canonical Meta field is
`reels_skip_rate`** (no `media_` prefix). This was already verified
on 2026-05-05 in Graph API Explorer:
- `media_reels_skip_rate` → returns "Invalid metric"
- `reels_skip_rate` → returns the value (Paradise reel returned
  77.1% skip rate)

The Storrito and Supermetrics third-party docs added the wrong
prefix. **Every reference in the JS code must be updated to use
`reels_skip_rate` before building.**

### Issue 2 — `profile_reposts` not yet manually verified
The original spec assumed this field is exposed but it's still
listed as PENDING manual verification in the dashboard schema doc.
Run `GET /{ig-user-id}/insights?metric=profile_reposts&period=day`
in Graph API Explorer to confirm before relying on it.

### Issue 3 — Track Score uses metrics we don't have access to
The proposed Track Score depends on:
- `track.unique_listeners` — Spotify's "unique listeners" metric is
  ONLY exposed via Spotify for Artists (S4A) backend. There is NO
  public Spotify API endpoint for this. The dashboard would need
  either: manual entry, S4A scraping (against TOS), or Chartmetric
  subscription ($60-200/mo).
- `track.saves` (Spotify saves) — SAME problem. S4A only.
- `track.playlist_reach` — only available via Chartmetric or
  Songstats. Not in any free public API.
- `track.total_streams` — ONLY for tracks released to DSPs. None
  of El Capitán's 4 released tracks are on Spotify (3 are bootleg
  remixes, 1 original DANCE. is SC-only).

**The Track Score formula as written cannot be implemented with the
current data surface.** Either:
- (A) Add manual entry fields for these metrics (low ROI for now —
  no DSP releases yet)
- (B) Wait until Reid releases an original on Spotify and either
  pays for Chartmetric or manually enters S4A data
- (C) Adapt the formula to use SoundCloud-equivalent metrics:
  `scPlays / daysSinceRelease` for velocity, `reposts / followers`
  as a stickiness proxy, and skip the playlist amplification
  factor entirely

### Issue 4 — JavaScript bug in `determineCareerStage()`
The line `const mostRecentTrack = catalog.sort((a, b) => b.releaseDate - a.releaseDate);`
returns the SORTED ARRAY, not the most recent track. Should be:

```js
const mostRecentTrack = catalog
  .slice()
  .sort((a, b) => b.releaseDate - a.releaseDate)[0];  // <-- [0] needed
```

Without `[0]`, `mostRecentTrack.releaseDate` is `undefined` and
`daysSinceLastRelease` becomes `NaN`. Career stage detection silently
breaks.

Also: the spec uses `.sort()` which mutates the original array. Use
`.slice().sort()` to avoid side effects.

### Issue 5 — "Stereo Brother" cited as peer benchmark
Stereo Brother was cited in the Trial Reels playbook (#4) as a
DJ/producer who broke out of an 800-follower plateau. **This case
study has not been verified.** A quick search shows multiple artists
with similar names but no clear case study matching the description.
Don't anchor a benchmark target on an unverified peer until verified.

### Issue 6 — `total_followers` in baseline calc is ambiguous
The JS uses `metrics.total_followers` without specifying:
- IG only? TT only? SC only?
- Sum across all 3?
- Weighted by platform?

For an artist whose audience is split 449 IG / 52 TT / 94 SC = 595
total cross-platform, the baseline score using log10(595)/4 = ~70.
That's defensible but the spec should explicitly define the field.
Recommend: sum of `ig.followers + tiktok.followers + sc.followers`.

---

## Proposed New Artist Score Formula

### Factor Table & Weighting

| Metric | Category | Weight (Active Campaign) | Weight (Pre-Release) | Weight (Catalog) |
|---|---|---|---|---|
| `reels_skip_rate` (inverted) | Hook Power | 30% | 40% | 15% |
| `shares` / `reach` | Viral Expansion | 25% | 30% | 15% |
| `saved` / `reach` | Content Utility | 15% | 10% | 20% |
| `follows` / `profile_visits` | Conversion | 20% | 15% | 25% |
| log₁₀(`total_followers` + 1) / 4 | Baseline | 10% | 5% | 25% |

### JS implementation (corrected for the issues flagged above)

```javascript
/**
 * Calculates the overall Artist Score (0-100) using 7-day rolling
 * averages from Graph API insights data.
 *
 * Career stage shifts the weights to optimize for the right thing
 * at the right time — pre-release leans heavily on hook power
 * (because there's no track data yet), catalog mode leans on
 * conversion and baseline (because growth is slower).
 */
function calculateArtistScore(metrics, careerStage) {
  // 1. Hook Power — INVERSE of skip rate (lower skip = better hook)
  // Target: <40% skip = good, <20% skip = brilliant
  const skipRate = metrics.skipRate ?? metrics.reels_skip_rate ?? 100;
  const hookScore = Math.max(0, Math.min(100, (1 - skipRate / 100) * 100));

  // 2. Viral Expansion — shares per reach
  // Target: 2.5% shares-per-reach = top 25% of Reels performance
  const shareRate = metrics.shares / Math.max(1, metrics.reach);
  const viralScore = Math.min(100, (shareRate / 0.025) * 100);

  // 3. Content Utility — saves per reach
  // Target: 3.8% saves-per-reach = top 25% of Reels performance
  const saveRate = metrics.saved / Math.max(1, metrics.reach);
  const utilityScore = Math.min(100, (saveRate / 0.038) * 100);

  // 4. Conversion — follows-from-post per profile visit
  // Target: 3% conversion (top-quartile bio funnel)
  const conversionRate = metrics.follows / Math.max(1, metrics.profile_visits);
  const conversionScore = Math.min(100, (conversionRate / 0.03) * 100);

  // 5. Baseline — logarithmic scale of total cross-platform followers
  // Goal: 10,000 total followers = score of 100
  const totalFollowers = (metrics.ig?.followers || 0)
                       + (metrics.tiktok?.followers || 0)
                       + (metrics.sc?.followers || 0);
  const baselineScore = Math.min(100, (Math.log10(totalFollowers + 1) / 4) * 100);

  // Career-stage weighting
  let weights;
  if (careerStage === 'ACTIVE_CAMPAIGN') {
    weights = { hook: 0.30, viral: 0.25, utility: 0.15, conv: 0.20, base: 0.10 };
  } else if (careerStage === 'PRE_RELEASE') {
    weights = { hook: 0.40, viral: 0.30, utility: 0.10, conv: 0.15, base: 0.05 };
  } else { // CATALOG
    weights = { hook: 0.15, viral: 0.15, utility: 0.20, conv: 0.25, base: 0.25 };
  }

  const finalScore = (hookScore * weights.hook)
                   + (viralScore * weights.viral)
                   + (utilityScore * weights.utility)
                   + (conversionScore * weights.conv)
                   + (baselineScore * weights.base);

  return {
    total: Math.round(finalScore),
    factors: {
      hookScore: Math.round(hookScore),
      viralScore: Math.round(viralScore),
      utilityScore: Math.round(utilityScore),
      conversionScore: Math.round(conversionScore),
      baselineScore: Math.round(baselineScore),
    },
    careerStage,
    weights,
  };
}

/**
 * Determines current career stage. Returns one of:
 *   'PRE_RELEASE' — fewer than 2 DSP-released tracks
 *   'ACTIVE_CAMPAIGN' — within 7 days pre or 30 days post latest release
 *   'CATALOG' — outside any active campaign window
 */
function determineCareerStage(catalog) {
  // Filter to actual DSP releases (not bootlegs, not demos)
  const released = (catalog || []).filter(t =>
    t.stage >= 15 &&
    t.clearance === 'Original' &&
    t.releaseDate
  );

  if (released.length < 2) return 'PRE_RELEASE';

  const sortedDesc = released
    .slice()
    .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
  const mostRecent = sortedDesc[0];
  const daysSince = (Date.now() - new Date(mostRecent.releaseDate)) / 864e5;

  if (daysSince >= -7 && daysSince <= 30) return 'ACTIVE_CAMPAIGN';
  return 'CATALOG';
}
```

---

## Proposed New Track Score Formula

**As written, this formula requires Spotify S4A data we don't have
public API access to.** Alternative SoundCloud-adapted version
below.

### Original spec (Spotify-dependent, not implementable today)

| Metric | Weight |
|---|---|
| `streams` / `daysSinceRelease` (velocity) | 45% |
| `saves` / `unique_listeners` (stickiness) | 35% |
| log₁₀(`playlist_reach` + 1) / 5 (amplification) | 20% |

### Adapted version for current SoundCloud-only catalog

```javascript
/**
 * SoundCloud-adapted Track Score for tracks not yet on DSPs.
 * Uses public scrape data only — no Chartmetric / S4A required.
 */
function calculateTrackScoreSC(track) {
  const daysSinceRelease = Math.max(1,
    (Date.now() - new Date(track.created_at)) / 864e5);

  // 1. Velocity — plays per day since release
  // Benchmark: 100 plays/day = top tier for sub-1k SC follower account
  // (Paradise currently at 94/day — calibrates well as top reference)
  const velocity = track.playback_count / daysSinceRelease;
  const velocityScore = Math.min(100, (velocity / 100) * 100);

  // 2. DJ-pickup signal — reposts per play
  // Replaces the Spotify "saves per listener" stickiness metric
  // SC reposts mean other DJs took the track to their feed/sets
  const repostRate = track.reposts_count / Math.max(1, track.playback_count);
  const djPickupScore = Math.min(100, (repostRate / 0.05) * 100);
  // Benchmark: 5% repost rate = top tier (Every 1's A Winner is at 5.2%)

  // 3. Engagement quality — likes per play (proxy for replay value)
  // Replaces playlist_reach since we don't have access to it
  const likeRate = track.likes_count / Math.max(1, track.playback_count);
  const qualityScore = Math.min(100, (likeRate / 0.03) * 100);
  // Benchmark: 3% likes-per-play = good for SC tech-house tier

  const score = (velocityScore * 0.50)
              + (djPickupScore * 0.30)
              + (qualityScore * 0.20);

  return {
    total: Math.round(score),
    factors: {
      velocityScore: Math.round(velocityScore),
      djPickupScore: Math.round(djPickupScore),
      qualityScore: Math.round(qualityScore),
    },
    metrics: {
      playsPerDay: +velocity.toFixed(1),
      repostRate: +(repostRate * 100).toFixed(1),
      likeRate: +(likeRate * 100).toFixed(1),
    },
  };
}
```

### Track Score expected values for current catalog

| Track | playsPerDay | repostRate | likeRate | Score |
|---|---|---|---|---|
| Paradise | 94 | 0.9% | 2.8% | ~70 |
| Pack Up Ya Bags | 77 | 0.5% | 1.6% | ~50 |
| Every 1's A Winner | 3.4 | 5.2% | 7.5% | ~50 |
| DANCE. | 1.0 | 4.4% | 7.4% | ~30 |

(These are rough — depends on exact daysSinceRelease as of compute
date.)

---

## Benchmark values (with sources)

| Metric | Target = 100 | Source |
|---|---|---|
| Reels skip rate | <20% | Metricool 2026 + verified Meta API field |
| Saves per reach | 3.8% | Hootsuite 2026 Trends Index (top 25%) |
| Shares per reach | 2.5% | Hootsuite 2026 Trends Index (top 25%) |
| Profile CTR | 3.0% | Top-quartile music creator funnels |
| SC plays per day (sub-1k tier) | 100 | Calibrated to current best (Paradise at 94/day) |
| SC repost rate | 5% | Calibrated to current best (Every 1's A Winner at 5.2%) |
| SC likes-per-play | 3% | Calibrated to typical underground tech-house benchmarks |
| Total followers (cross-platform) | 10,000 | Log-scaled milestone |

---

## Migration Plan (corrected for existing dashboard)

The spec's Week 1-3 plan is reasonable but needs adaptation:

### Week 1 — Shadow scoring
- Add `computeArtistScoreV2()` and `computeTrackScoreSCV2()` to
  `index.html` alongside existing `computeArtistScore()` /
  `computeTrackScore()`
- Both new functions read from existing Firebase paths
  (`analytics/latest/igInsightsSummary`, `analytics/latest/sc`)
- Log V2 outputs to console, do NOT replace UI
- Run for 14 days to verify no NaN / Infinity edge cases on
  thin-data days

### Week 2 — Side-by-side display
- Add a "V2 Score" badge on HQ alongside the current Artist Score
- Tooltip explains: "New velocity-and-intent-driven score"
- Show per-factor breakdowns side-by-side for transparency

### Week 3 — Switch primary, archive V1
- V2 becomes the headline number
- V1 moves to a "Historical Score" expandable section
- Update Gemini prompt to reference V2 metrics specifically

---

## Open Questions Reid Must Validate

1. **`profile_reposts` field** — verify it returns data via Graph
   API Explorer. If not, drop from spec.
2. **Hypeddit download data** — bootlegs need a velocity metric.
   Hypeddit doesn't expose a public API. Manual entry only OR adapt
   the SoundCloud play count as the proxy.
3. **DSP release timeline** — when DANCE. or future originals get
   distributed via DistroKid to Spotify, the Spotify-based Track
   Score becomes implementable. Until then, SC-adapted version
   only.
4. **Career-stage detection edge case** — what if Reid has
   announced a future release date (e.g., Missing scheduled for
   June 15)? The dashboard would need release dates for unreleased
   tracks to detect ACTIVE_CAMPAIGN before launch.
5. **What happens when `igInsightsSummary` is null** (e.g., morning
   before scrape ran)? V2 functions need graceful fallbacks — emit
   a 50 score with a "data pending" flag rather than 0.

---

## Strategic Implications

1. **The new Artist Score will rank Paradise/PUYB drastically
   differently.** Current scoring prizes follower count and engagement
   rate. New scoring prizes shares-per-reach and follows-from-post.
   Paradise's actual data: 608 reach, 12 shares (1.97% share rate),
   shares-per-reach in the 25-50 score range. Hook score (skip 77%)
   would be 23. Real tension between "this is moving" and "the
   underlying mechanics are weak."

2. **The Catalog stage Hook Power weight (15%) is arguably too low.**
   Even in catalog mode, every new piece of content needs to win the
   first 3 seconds. Could argue for 20-25% Hook Power even when the
   account is in CATALOG state.

3. **Career stage detection currently won't fire ACTIVE_CAMPAIGN**
   because El Capitán only has 1 DSP-eligible release (DANCE.)
   and the spec requires 2+ releases to exit PRE_RELEASE. Reid is
   PRE_RELEASE state by definition until he ships a 2nd original.

4. **The Pre-Release weighting (40% Hook, 30% Viral, 5% Baseline)**
   correctly emphasizes what matters now: hooks that travel. Good
   match for Reid's actual position.

5. **The migration plan's shadow-scoring period is the right call.**
   Don't switch the UI until the V2 outputs look reasonable across
   2 weeks of data. Avoids the "score dropped 40 points overnight"
   panic moment.
