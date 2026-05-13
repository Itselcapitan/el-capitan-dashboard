# El Capitán Dashboard — Session Recap & Full System Overview
**Date:** May 13, 2026
**Session focus:** Bug fixes → Time zone conversion → Major dashboard cleanup → Document everything

---

## Part 1: What We Did This Session

### Phase 1: Bug Fixes (Initial Triage)
After the prior conversation hit context limits, several issues were still outstanding:

1. **Follower count on main page was wrong** (stuck at 360 from April)
   - **Fix:** Added a direct Graph API call to `/{IG_BUSINESS_ACCOUNT_ID}?fields=followers_count,media_count` in `scrape-ig-account-insights.mjs`. Now writes live count (currently **455**) to `analytics/latest/ig` on every scrape, independent of Apify.

2. **TikTok total plays showing 0**
   - **Cause:** Apify free-tier monthly quota exhausted, daily scrape failing.
   - **Fix:** Added an amber notice under the TikTok stats grid explaining the data dependency. No code fix possible until TikTok's official API is implemented or Apify quota resets.

3. **Smart Schedule placement & TikTok inclusion**
   - **Fix:** Filtered out TikTok entries in `renderSmartSchedule()` (the platform won't have accurate timing data until official API). Updated `daily-strategy.mjs` Gemini prompt to only generate IG schedule entries.

4. **Online followers heatmap not rendering**
   - **Fix:** Better error handling and console logging in `renderPostingTimes()`. Data was always in Firebase, the rendering had a brittle null check.

5. **Demographics country codes showing as "US"/"CA" instead of full names**
   - Fixed in prior session — `resolveCountryName()` mapping table.

6. **Demographics PATCH vs PUT** — stale error data was persisting across runs.
   - Fixed in prior session — `putFirebase()` now fully replaces the demographics node.

### Phase 2: High-Follower Commenter Tracking (NEW FEATURE)
You asked if we could detect high-follower accounts in your audience for marketing/feedback outreach.

- **What's possible:** Meta deprecated `/me/followers` in 2023, so we **cannot** pull your full follower list. But we **can** look up commenter profiles.
- **Implementation:**
  - `scrape-ig-comments.mjs` now collects user IDs from each comment's `from` field.
  - For up to 20 new commenters per run, queries `/{user-id}?fields=followers_count,username,biography,media_count`.
  - Flags any account with **15,000+ followers** as "high-profile."
  - Stores results in Firebase at `analytics/latest/igComments/highProfileCommenters` (full record) and `highProfileContacts` (only the flagged 15k+ ones).
  - Dashboard's Comment Tracker section now shows a ⭐ HIGH-PROFILE COMMENTERS table with follower count, comment count, bio preview, and Instagram link.
  - Warm Intros table now has a "Followers" column.
- **Current state:** 42 unique commenters, 0 high-profile yet. Will accumulate over time as new accounts comment on your posts.

### Phase 3: UTC → Eastern Time Conversion (Site-Wide)
You noticed the "Best Posting Times" peak showed "12am" but that was UTC (= 8pm ET).

**What changed:**
- **Dashboard heatmap** (`renderWhenToPost`, formerly `renderPostingTimes`): Added `utcToET()` helper that auto-detects EDT (Mar–Nov) vs EST (Nov–Mar). All 24 hours are now reindexed from UTC to ET before display.
- **Strategy scripts** (`daily-strategy.mjs`, `weekly-strategy.mjs`): Added `toET()` helper using `Intl` API. Post-timing analysis (`igPostTiming`) now uses ET hours/days.
- **Daily strategy → Gemini**: Now fetches `igDemographics` from Firebase and includes the `online_followers` data converted to ET in the AI prompt. Smart schedule recommendations are now made with real ET-based audience activity.
- **All dashboard timestamps**: `toLocaleString()` calls now explicitly use `timeZone: 'America/New_York'` with an "ET" suffix (last scrape time, daily briefing "Updated", strategy "Generated", story timestamps).

### Phase 4: Major Dashboard Cleanup
You said the dashboard felt like "information throw up" and asked for it to be concise and purposeful.

**Removed from HQ tab:**
- ~~Track Scores Summary~~ → moved to Tracks tab
- ~~Weekly Strategy "This Week"~~ section → redundant with daily briefing
- ~~Daily Agenda~~ → not used
- ~~Master Task Tracker~~ → not used
- ~~AI Suggestions~~ → was already hidden
- ~~Weekly Performance Review~~ → was already hidden
- ~~Best Posting Times heatmap (from Trends section)~~ → consolidated into new "When to Post"

**Removed entirely:**
- ~~Campaigns tab~~ (Campaign Builder, Release Timing, Paid Media) — non-functional

**Removed from Content tab:**
- ~~Standalone Smart Schedule section~~ — now on HQ
- ~~Standalone Best Posting Times accordion~~ — now on HQ
- ~~Key Insights & Strategic Position accordion~~ — redundant with daily briefing

**Added to HQ:**
- **"When to Post"** section: 7-day × 8-block heatmap grid (3-hour blocks) showing follower online activity by day. Colors:
  - **Green** = peak (top 30% activity)
  - **Amber** = moderate (35–70%)
  - **Gray** = low (<35%)
  - Smart schedule slots overlaid as colored dots (pink = IG, orange = SC)
  - Peak window text below the grid

### Phase 5: Restored Weekly AI Overview with Arrow Navigation (CURRENT)
You correctly pointed out that the long AI-generated weekly narrative was important — you wanted to navigate back to prior weeks to track growth.

**Restored:**
- **Weekly AI Overview** section back on HQ, below Today's Briefing
- **Arrow navigation:** `← Older` / `Newer →` buttons
- **Page indicator:** "CURRENT WEEK · 1 of 5", "WEEK 1 AGO · 2 of 5", etc.
- **Source:** `strategy/history` Firebase node (last 20 weeks), prepended with current `strategy/latest`
- **Each saved week includes:** `weeklyNarrative` (long-form paragraphs), `weeklyReview` (wins/misses/focus), `keyInsights`, `weekOf`, `generatedAt`

---

## Part 2: Current Dashboard Overview

### Tab Bar
**HQ | CONTENT ENGINE | TRACKS | OUTREACH | SETTINGS**

### HQ Tab (Morning Command Center)
Sections, top to bottom:

| Section | Purpose | Data Source |
|---------|---------|-------------|
| **Artist Score** | 0-100 health score across cadence, growth, engagement | Computed live from `analytics/latest` + `analytics/history` |
| **Follower Overview** (pie chart) | IG / TikTok / SoundCloud share | `MSE.ig.followers` (Graph API via `analytics/latest/ig`), `MSE.tiktok.followers` (Apify), `MSE.sc.followers` (SC scraper) |
| **Today's Briefing** | Mood + headline + what changed + week progress + 1 action | Gemini AI, `strategy/latest.dailyInsight` — runs daily ~6:10 AM ET |
| **Weekly AI Overview** | Long-form narrative + arrow nav to prior weeks | Gemini AI, `strategy/latest` + `strategy/history` (last 20 weeks) — full rewrite each Monday |
| **Smart Alerts** | Auto-detected anomalies in your data (hidden when none) | `analytics/latest.alerts[]` from daily scrape |
| **When to Post** | 7-day × 8-block heatmap of follower activity + smart schedule dots | `analytics/latest/igDemographics.onlineFollowers.hourly` (UTC → ET) + `strategy/latest.smartSchedule` |
| **30-Day Trends** | Follower growth chart for all 3 platforms | `analytics/history` (last 30 daily snapshots) |

### Content Engine Tab
Four sub-tabs:

#### Analytics Sub-tab
| Accordion | Purpose | Data Source |
|-----------|---------|-------------|
| **Cross-Platform Overview** | 3 follower cards + distribution chart | Same Firebase paths as HQ |
| **Instagram Deep Report** | 6-stat grid (followers, eng rate, reached, views, profile visits, link clicks) + full posts table | `analytics/latest/ig` (basic) + `analytics/latest/igAccountInsights` (28-day Graph API aggregates) + `analytics/latest/igPosts` (Apify) + `analytics/latest/igInsights` (per-post Graph API) |
| **TikTok Analysis** | Stats grid + posts table (currently empty — Apify quota issue) | `analytics/latest/tiktok` + `analytics/latest/ttPosts` |
| **SoundCloud Analysis** | Stats + tracks table | `analytics/latest/sc` (via `scrape-sc.mjs`) |
| **Audience & Demographics** | Cities, countries, gender, age, languages | `analytics/latest/igDemographics` — Graph API `follower_demographics` endpoint |
| **Funnel & Conversion** | Reached → Profile Visits → Link Clicks (28-day) | `analytics/latest/igAccountInsights.metrics` |
| **Stories Insights** | Per-story reach, completion, exits, replies | `analytics/latest/igStories` — only populated when stories are live |
| **Comment Tracker & Warm Intros** | Total comments, unique commenters, warm intros (2+ comments), ⭐ high-profile (15k+) | `analytics/latest/igComments` |

#### What Works Sub-tab
- **Priority Formats** (AI-recommended)
- **Top Competitor Reels** (recent, with hooks)
- **Universal Reel Patterns**
- **Competitor Profile Stats** (Chalant / Teeb / Wally)
- **Posting Cadence Comparison** (you vs competitors)
- **Community Wisdom & Mentor Notes**
- **Content Playbook** (28 analyzed formats, filterable)

#### Create Sub-tab
- **Caption Ideas** (AI-powered, hidden until generated)
- **Hook Library** (your saved hooks)
- **Caption Templates** (your saved templates)
- **Scene Library** (your saved scene ideas)

#### Pipeline Sub-tab
- **Idea Pipeline** — your tracked content ideas

### Tracks Tab
- **Track Scores** (moved from HQ) — momentum, score, next action per track
- **Track Pipeline** — production status (idea → demo → production → finished)
- **Production Glossary** (collapsible reference)
- **Track Performance (AI-matched)** — which posts went with which track

### Outreach Tab
- **Venues** — venue queue
- **Labels** — label queue

### Settings Tab
- Accounts (IG/TT/SC links)
- Automation status
- Data sources

---

## Part 3: Where Every Piece of Data Comes From

### Active Scrapers (GitHub Actions Crons, all times ET)

| Scraper | Cron | Source | Writes To |
|---------|------|--------|-----------|
| **Daily Scrape (IG + TikTok + SC)** | 6:00 AM ET | Apify actors | `analytics/latest/ig`, `analytics/latest/tiktok`, `analytics/latest/igPosts`, `analytics/latest/ttPosts` |
| **IG Insights** | 6:15 AM & 6:00 PM ET | Graph API per-post + account-level | `analytics/latest/igInsights`, `analytics/latest/igInsightsSummary`, `analytics/latest/igAccountInsights`, `analytics/latest/ig` (followers) |
| **IG Demographics** | 7:15 AM ET | Graph API `follower_demographics` + `online_followers` | `analytics/latest/igDemographics` (PUT — full replace) |
| **IG Stories** | 8:15 AM ET | Graph API stories endpoint | `analytics/latest/igStories` |
| **IG Comments** | 9:15 AM ET | Graph API comments + profile lookups | `analytics/latest/igComments` |
| **IG Ads** | 10:15 AM ET | Marketing API (if FB_AD_ACCOUNT_ID set) | `analytics/latest/igAds` |
| **SoundCloud Scrape** | 6:05 AM ET | SoundCloud v2 API | `analytics/latest/sc` |
| **Competitor Scrape** | 6:10 AM ET Tue + Fri | Apify (Chalant, Teeb, Wally + 5 more) | `competitors/latest`, `competitors/allReels` |
| **Daily Strategy Generator** | 6:15 AM ET | Gemini 2.0 Flash | `strategy/latest`, `strategy/history/{weekOf}` |
| **Strategy Recovery** | 9:30 AM, 12 PM, 3 PM, 6 PM ET | Re-runs strategy if missing | Same as above |
| **Deploy** | On every git push | GitHub Pages | Live site |

### Data Flow Diagram (Simplified)

```
                        ┌─────────────────────┐
                        │   Meta Graph API    │ ← non-expiring page token
                        │   (free, official)  │
                        └─────────┬───────────┘
                                  │
                ┌─────────────────┴────────────────┐
                │                                  │
                ▼                                  ▼
        per-post insights              account-level insights
        scrape-ig-insights.mjs         scrape-ig-account-insights.mjs
                │                                  │
                │   ┌──────────────────────────────┴───┐
                │   │                                  │
                │   ▼                                  ▼
                │  scrape-ig-demographics.mjs     scrape-ig-stories.mjs
                │   │                                  │
                │   └──────┐                           │
                │          │                           │
        scrape-ig-comments.mjs                         │
                │          │                           │
                ▼          ▼                           ▼
        ┌──────────────────────────────────────────────────┐
        │     Firebase Realtime DB (analytics/latest/*)    │
        └────────────────────────┬─────────────────────────┘
                                 │
        ┌────────────────────────┴───────────────────┐
        │                                             │
        ▼                                             ▼
┌──────────────────┐                       ┌──────────────────┐
│  Daily Strategy  │ ← reads all sources   │    Dashboard     │ ← user view
│   (Gemini AI)    │                       │    (HQ tab)      │
└────────┬─────────┘                       └──────────────────┘
         │
         ▼
   strategy/latest
   strategy/history/{weekOf}  ← navigated via Older/Newer arrows
```

### Per-Section Data Provenance (For Every Metric You See)

**Follower Counts:**
- IG followers (455) → Graph API → `analytics/latest/ig.followers` (updated every IG Insights run, 6:15 AM ET)
- TikTok followers → Apify → `analytics/latest/tiktok.followers` (currently stale due to quota)
- SoundCloud followers (66) → SC v2 API → `analytics/latest/sc.followers`

**Engagement Metrics (28-day rolling):**
- Likes, comments, shares, saves, total_interactions → Graph API → `analytics/latest/igAccountInsights.metrics.{metric}.total`

**Reach / Impressions / Views:**
- Reach (7-day sum) → `igAccountInsights.metrics.reach.last7Sum`
- Views (28d) → `igAccountInsights.metrics.views.total`
- Profile views (28d) → `igAccountInsights.metrics.profile_views.total`
- Link clicks (28d) → `igAccountInsights.metrics.website_clicks.total`

**Demographics:**
- Top cities, countries, gender, age groups → Graph API `follower_demographics` with breakdown — `analytics/latest/igDemographics`
- Languages: not currently tracked (locale breakdown deprecated in Graph API)

**Best Posting Times:**
- Hourly follower activity → Graph API `online_followers` (period=lifetime) — `analytics/latest/igDemographics.onlineFollowers.hourly` (raw UTC, converted to ET on render)

**Stories:**
- Per-story reach, completion rate, replies, exits, taps → Graph API `media_insights` per story ID — `analytics/latest/igStories`

**Comments & Warm Intros:**
- Recent comments, commenter map, warm intros (2+ comments), high-profile (15k+) → Graph API media + comment + user profile endpoints — `analytics/latest/igComments`

**Competitor Intel:**
- Recent competitor reels, hooks, captions, posting cadence → Apify (8 accounts) — `competitors/latest`, `competitors/allReels` (accumulated pool)

**Track Performance:**
- SoundCloud plays/likes per track → SC API — `analytics/latest/sc.topTracks*`
- Track ↔ post matching → deterministic keyword matcher in `daily-strategy.mjs` (pre-matches before AI sees the data)

**Smart Schedule:**
- AI-generated weekly schedule (IG only) → Gemini using `postTiming.ig` + `onlineFollowersET` — `strategy/latest.smartSchedule`

**Daily Briefing / Weekly Overview:**
- AI-generated narrative → Gemini 2.0 Flash → `strategy/latest.dailyInsight`, `strategy/latest.weeklyNarrative`

---

## Part 4: What We're NOT Currently Tracking

### Data Sources Not Yet Integrated

1. **TikTok official API** — Apify-based scraping is fragile and quota-limited.
   - **Why we want it:** Real total plays, follower growth, video-level analytics for smart schedule.
   - **Blocker:** Requires applying for TikTok Creator Marketing API access (free but gated).
   - **Stored as a memory note** for future implementation.

2. **YouTube** — not tracked at all.
   - Would need YouTube Data API v3 (free, needs Google Cloud project).

3. **Spotify for Artists** — not tracked.
   - Spotify API exists but doesn't expose Artist Dashboard analytics. Would need manual export or a 3rd-party tool like Chartmetric.

4. **Discord / Telegram / Reddit** — if you build community presence there.

### Metrics Not Currently Available

5. **Your full follower list** — Meta deprecated `/me/followers` in 2023.
   - **Workaround in place:** We check follower count of commenters (high-profile flag at 15k+) — this catches anyone actively engaging.
   - You can't get a list of silent followers via API.

6. **Saves per post** — partially tracked.
   - `igInsights` per-post has `saves`, but Apify often returns 0 because it can't see private metric. Graph API enrichment fixes this in the IG posts table.

7. **Share destinations** — Meta exposes total shares, not WHERE they were shared (DM vs story vs external).

8. **Follower locales/languages** — `audience_locale` was deprecated. Not available in Graph API anymore.

9. **Trial Reels detailed analytics** — partially tracked.
   - We detect Trial Reels (private testing reels < 72h old with `is_shared_to_feed=false`) but Meta's Graph API doesn't expose trial-specific metrics separately.

10. **DM engagement** — Meta doesn't expose DM volume/conversation count via API.

11. **Hypeddit conversions per source** — Hypeddit tracks gate visits but not which specific IG post/ad drove each one. Adding the Facebook Pixel (which you've now set up) gives Meta the data to retarget gate visitors.

12. **Story Highlights performance** — old highlights don't have insights data after 24h, only live stories do.

### Lower-Priority Future Additions

13. **Email list metrics** (if you start one — Hypeddit captures emails but you'd need a real email tool to send/track).
14. **Streaming royalties** — manual entry only unless you integrate a distributor API (DistroKid, etc.)
15. **Booking inquiries** — currently you manage venues/labels manually in the Outreach tab.
16. **Setlist tracking** — not tracked.

---

## Part 5: Known Issues / Outstanding TODOs

- **TikTok stats showing 0 plays** — waiting on Apify quota reset or official TikTok API
- **`profile_reposts` Graph API metric errors** — deprecated, can be removed from `scrape-ig-account-insights.mjs` targets list
- **`content_views` metric returns empty** — endpoint returns 200 but no data, may need different query format
- **No stories captured recently** — only fires when stories are live during scrape window (8:15 AM ET); you may need to post a story near scrape time to see it appear
- **Weekly Review section** (separate from Weekly Overview) — still exists but hidden by default; can be deleted if redundant with the new arrow-nav overview

---

## Part 6: How to Use the Dashboard Day-to-Day

### Morning Routine (60 seconds on HQ tab)
1. Check **Artist Score** — is it up or down?
2. Read **Today's Briefing** — what does the AI say to do today?
3. Skim **Smart Alerts** (if visible) — any anomalies?
4. Glance at **When to Post** — am I posting in a green/amber slot today?

### Weekly Review (Monday or Friday, 5 minutes)
1. Open **Weekly AI Overview**
2. Read the current week's narrative
3. Use the **← Older** arrow to compare with prior weeks
4. Look at the **30-Day Trends** chart for growth direction

### Deep Dive (when you have time)
- **Content Engine → Analytics**: Detailed per-platform stats, demographics, funnel
- **Content Engine → What Works**: Competitor benchmarking, format library, hooks
- **Content Engine → Create**: Caption ideas, hook library, scene library
- **Tracks**: Production pipeline, track scores, performance
- **Outreach**: Venue and label queues

---

## Part 7: How to Trigger a Manual Re-Scrape

If you ever want fresh data without waiting for the morning cron:

```bash
gh workflow run "IG Insights Scrape (standalone)"
gh workflow run "IG Demographics & Posting Times"
gh workflow run "IG Comment Tracker"
gh workflow run "IG Stories Insights"
gh workflow run "SoundCloud Scrape (daily)"
gh workflow run "Daily Strategy Generator"
```

Or use the "Force Scrape All (Manual)" workflow which runs everything in sequence.

---

*Generated by Claude on 2026-05-13 to recap the full session and document the dashboard state.*
