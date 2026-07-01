# Dashboard v2 — Build Spec (from Fable 5 concepts A + C)

Decided 2026 after reviewing three Fable 5 concepts (A "Session View", B "Pressing Plant",
C "Booth Monitor"). Reid picked a synthesis of A + C. B rejected (too bright) but noted for
its unique ideas.

## Base
- **Concept A "Session View"** is the structural + color base: dark, near-black ground with
  clip-orange accent. Scene-row layout (numbered modules scanned like an Ableton set).
- Keep the **active/moving graphics** (animation) — Reid explicitly likes motion. All motion
  MUST respect `prefers-reduced-motion`.
- Non-negotiable: **functional** — every module wired to the real Firebase data via the
  existing loaders/render functions. Look changes; data layer is preserved.

## Grafts from Concept C "Booth Monitor"
1. **Artist Score** → use C's LED-gauge / booth-monitor score display (Reid: "C has the best
   artist score display/graph"). Replaces A's Scene-1 score module.
2. **Trial Reels** → use C's spinning-record "CUE SEARCHING" decks (Reid: "trial reel design
   for concept C with the spinning records"). Replaces A's Scene-5 trial cards.

## Keep from Concept A
- Follower growth graph (Scene 3)
- Platform channel graphs (Scene 4 — Content/Platform Channels)
- IG posts table (Scene 7)
- Intel — peers/stories/comments (Scene 8), incl. duer.wav creator tracking
- Audience/demographics (Scene 9)
- Gig / ticket tracker (Scene 10)
- Daily AI Insight + Alerts (Scene 1)
- Benchmarks (Scene 2)
- Weekly Strategy (Scene 6)
- A's overall color scheme (dark + clip-orange)

## Explicit design change — When-to-Post heatmap
- Reid wants a **single-hue brightness ramp**, NOT separate colors per intensity band.
  Brighter = higher engagement in that day/time window; dim = low. One color, luminance scales
  with the value. (A's version used distinct green/amber/blue bands — replace with a mono ramp.)

## Concept A scene → section map (reference)
1. MASTER — Score / Insight / Alerts
2. BENCHMARKS (Save Rate, Skip Rate·Followers, Follows-from-post, Top-5 City, Weekly Velocity)
3. GROWTH / TIMING (30-day follower growth + When-to-Post heatmap)
4. CONTENT — PLATFORM CHANNELS (IG / TikTok / SoundCloud)
5. TRIAL REELS (algo searching)
6. WEEKLY STRATEGY (priorities / post ideas / avoid)
7. IG POSTS — table
8. INTEL — peers (duer.wav) / stories / comments
9. AUDIENCE — demographics (age / gender / cities / countries)
10. CAREER — gig / ticket tracker (NEW section; Posh VIP links + sold/goal)

## Domain nuances the design MUST preserve (from live data logic)
- Skip rate rendered NEUTRAL/dim, not alarm-red. ~63% graduated is normal (passive campus
  audience). Framing: "normal for a passive campus audience — not a red flag."
- Trial reels flagged "searching", judged by FOLLOWS + PROFILE VISITS, not skip rate.
- **Follows-from-post is the hero metric** — most visually emphasized in each view.

## Build approach
- Build as a fresh `index-v2.html` (or a branch) so the live dashboard stays up during the
  rebuild. Port section-by-section, wiring each to the existing Firebase refs + render
  functions. Verify data flows per section (preview tools / Firebase reads) before swap.
- Only swap v2 → index.html once every section is verified rendering real data.

## Firebase data sources (already live — reuse, do not rebuild)
- analytics/latest (ig, igPosts, tiktok, ttPosts, sc) — daily scrape (IG via Graph API now)
- analytics/latest/igInsights, igInsightsSummary, igTrialReels — IG insights scraper
- analytics/latest/igDemographics — demographics scraper (online_followers is empty for this
  account; When-to-Post is derived from post performance instead)
- analytics/latest/creatorTracking — duer.wav via Business Discovery
- analytics/latest/igStories, igComments, igAds
- strategy/latest, library/* — strategy generator
- analytics/history/<date>/* — trends
