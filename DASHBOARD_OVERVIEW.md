# El Capitan Dashboard — Full Overview

**Live URL:** https://itselcapitan.github.io/el-capitan-dashboard/
**Architecture:** Single HTML file (~3,000 lines) with inline CSS, JS, Chart.js 4.x, Firebase Realtime DB
**Purpose:** Artist growth operating system for DJ "El Capitán" — analytics, production pipeline, content strategy, outreach, and campaign management

---

## Tab 1: HQ (Command Center)

The home base. Everything at a glance.

- **Artist Score** — Weighted 0-100 score across 9 factors (followers, engagement, content volume, track pipeline, etc.) displayed as an SVG ring with factor bars and a sparkline history
- **Platform Followers Chart** — Bar chart comparing Instagram (312), TikTok (28), SoundCloud (41) follower counts
- **Growth Alerts** — Dismissible red/amber banners for problems: posting cadence below target, SC 30d declining, overdue tasks, blocked tracks, IG 1% link click rate, 41% audience in Schenectady
- **Daily Agenda** — Today's action items
- **Focus Right Now** — Organized by timeframe: This Week / This Month / 90 Days goals with done/overdue indicators
- **What's Working** — 6 cards highlighting wins: IG engagement rate (7.3%), TikTok launch (2,177 plays from 5 posts), cross-posting reach, release pipeline (8 tracks), remix teasers as top format, outreach started
- **What's Not Working** — 5 cards highlighting problems: posting cadence (~5/mo vs 8-10/week target), "Three Heaters" format overdue, SC 30d plays declining (-47%), no 60-min mix recorded (blocks venue outreach), 3 tracks blocked on marketing/arrangement
- **Master Task Tracker** — Full task list with categories, priorities, due dates, subtasks, completion tracking. Syncs to Firebase
- **Master Strategy** — Primary focus statement, content format mix (60% Reels, 25% Carousels, 15% Images), posting frequency (4-5 reels/week), audio rules (always use own music), hashtag strategy with copy button

---

## Tab 2: CONTENT

### Sub-tab: Analytics
All platform data in collapsible accordion panels with Chart.js visualizations.

**Cross-Platform Overview** (open by default)
- 3-column summary cards: IG (312 followers, +65% growth, 11K reached, 1,500 interactions), TikTok (28 followers, 2,177 plays), SoundCloud (41 followers, 603 all-time plays)
- Follower Distribution doughnut chart
- Combined reach note: ~13,180 impressions across platforms
- Key problem callout: "You do NOT need more reach — you need to convert attention"

**Instagram Deep Report** (open by default, 90-day data: Dec 27 – Mar 26)
- Stats grid: 312 followers (+65%, +123 net, 13% unfollow), 11,003 accounts reached (+1,056%, 97.3% non-followers), 45,344 impressions (+1,625%), 1,500 interactions (+831%), 2,564 profile visits (23% rate), 26 link clicks (1%), peak time 12-3pm Tue-Wed
- 3 doughnut charts: Interactions by Content Type (Posts 887 / Reels 492 / Stories 45), Engagement Breakdown (333 likes / 23 comments / 256 shares / 7 saves), View Share by Format (Reels 65.1% / Posts 15% / Stories 19.9%)
- Top posts table with engagement data

**TikTok** (collapsed)
- 2,177 total plays, 28 followers, 205 likes, avg 435 plays/post
- Post performance table: Pack Up Ya Bags teaser (1,141 plays, 147 likes), Hunter Mtn Nights (487), The Money teaser (245), Money drop clip (219), PUYB Release (85)

**SoundCloud** (collapsed)
- 29 plays (7d, +107%), 118 plays (30d, -47%), 41 followers, 603 all-time
- Top tracks (7d & 30d), top listeners with follower counts, top locations (Schenectady, Ashburn, Bayamón PR)

**Audience & Demographics** (collapsed)
- Gender doughnut: 70.5% male / 29.5% female
- Age horizontal bar chart: 18-24 (58.3%), 25-34 (29.8%), 35-44 (8.3%)
- Top cities: Schenectady 41.3%, NYC 3.2%, Boston 2.8%, Albany 2.4%
- Note: "41.3% Schenectady = hyper-local. Need to break into NYC/Boston for venue growth"

**Funnel & Conversion** (collapsed)
- Horizontal bar chart: 11,003 reached → 2,564 profile visits (23%) → 26 link clicks (1%)
- Visual funnel with arrow flow
- Red callout: "Conversion Gap: 23% profile visit rate is strong, but only 1% click the link"

**Key Insights & Strategic Position** (collapsed)
- 9 bullet insights covering reach explosion, non-follower discovery, conversion gap, low save rate, hyper-local audience, demographics, PUYB breakout, peak window
- Strategic position: "Algorithm Exposure + Attention Spike" → next phase: "Audience Conversion + Brand Lock-In"

### Sub-tab: Playbook
Content strategy reference from competitor research.

- **Priority Formats** — Ranked table of 8 proven format types with evidence from competitors: remix teaser with recognizable hook, co-authored event promos, three heaters weekly roundup, bigger DJ playing your track, "should I drop this?" gauge CTA, COMMENT keyword CTA, journey narrative, talking head DJ life take
- **Avoid** — 4 anti-pattern cards: captionless images, trending audio, hashtag spam, single-post releases
- **Top Reels Intel** — Table of ~200 scraped reels from 14 competitor accounts with likes, views, engagement %, and key patterns identified (Dom Dolla, NIIKO, Bolo, Chalant, Zachh, SideQuest, Wally, Luke Alexander, etc.)
- **Universal Patterns** — 8 patterns found across 3+ accounts: original audio, hook in first 2 seconds, same 3-4 hashtags, "should I drop this?" CTA, multi-reel release rollout, other DJs playing your track, weekly recurring format, tag original artists

### Sub-tab: Creative Library
Reference libraries for content creation.

- **Hook Library** — 6 proven first-2-second hooks: recognizable melody, bass drop frame 1, crowd reaction, friend's face on drop, DAW screen empty-to-full, talking head opener. Each with source and status
- **Caption Templates** — 6 templates: song lyric fragment, cryptic reaction, ALL CAPS "OUT NOW", "should I drop this?", "COMMENT [keyword] for download", "three heaters to kick off the week". Each with source and when-to-use
- **Scene Library** — 7 scene types ranked by performance: DJ booth/decks (~60/200), crowd reaction (~40/200), studio/DAW screen (~30/200), unexpected location (~10/200), talking head (~15/200), event recap montage (~25/200), friend/crew reaction (~10/200)

### Sub-tab: Pipeline
Content idea backlog.

- **Idea Pipeline** — 8-row table: Pack Up Ya Bags Reel 2 "COMMENT remix" (PLANNED), Wicked Game "should I drop this?" (PLANNED), First "Three Heaters Monday" (IDEA), Dashboard walkthrough reel (FILMED), studio remix unexpected location (IDEA), Film Santello reacting at gig (IDEA), "Started making remixes X months ago" (IDEA), Every 1's A Winner clip + artist tag (IDEA)

### Sub-tab: Release Timing
Automated release campaign timelines.

- **Release Timing Engine** — Auto-generates 14-step timelines for tracks with release dates. Steps span day -14 to day +14: album cover → teasers → BTS content → SC upload → release → paid ads → snippet reel → final teaser → RELEASE DAY (reel + TikTok + HypedIt + bio update) → thank you post → BTS breakdown → analytics review → remix push. Interactive dot markers for completion

---

## Tab 3: GROWTH

### Sub-tab: SoundCloud
- Same SC stats as in Content > Analytics (7d/30d plays, followers, engagement, top tracks, listeners, locations)

### Sub-tab: Competitors
- **14 Competitor Profiles** — Table: handle, followers, reel count, avg likes, key pattern, relevance tier (HIGHEST/HIGH/STUDY). Accounts: @chalantmusic, @wally_sounds, @zachhzachhzachh, @teeeebbbbb, @keepdansyn, @austinashtinmusic, @niikoxswae, @domdolla, @bolothedj, @sidequestdj, @lukealexvnder, and more

### Sub-tab: Posting Cadence
- Comparison cards: Your cadence (~3/mo, target 16-20/mo) vs Chalant (~8/week), Teeb (~7/week), Wally (~6/week)

### Sub-tab: Community Wisdom
- **Chalant Mentor Panel** (March 2026) — 6 bullet points: consistency matters most, volume beats perfection, keep remixing recognizable songs, finish and release tracks quickly, organic growth > paid at this stage, build a content system

### Sub-tab: Campaigns
- **Campaign Builder** — Multi-step campaign wizard with 4 steps: Goal → Platforms → Details → Review. Track release campaigns auto-generate 10 steps: create album cover → SC release info → release on SC → post reel → post TikTok → create HypedIt pipeline reel → update bios → launch paid ad → follow-up content → review analytics

---

## Tab 4: OUTREACH

### Sub-tab: Venues
- **Venue Queue** — Expandable table rows: venue name, market (Capital Region/Boston/NYC), contact, status, last contacted, next follow-up. Click to expand for notes, demo links, follow-up scheduling
- **Add Venue Form** — Name + market dropdown

### Sub-tab: Labels
- **Label Queue** — Expandable table rows: label name, genre, contact, status, track sent, last contacted, next follow-up
- **Label Path Strategy** — Progression plan: Votion → Shall Not Fade + Yoshitoshi → Moon Harbour → Diynamic → Innervisions (3-5yr timeline)
- **Add Label Form** — Name + genre dropdown

---

## Tab 5: TRACKS

### Sub-tab: Track Pipeline
- **Master Track Pipeline** — Sortable table: track name, type (Remix/Bootleg/Edit/Original/Mashup), genre, status (PUSH/FINISH/HOLD/KILL), stage (1-16), priority, emotional job, next action, due date, last worked, momentum score, readiness score
- **Expandable Track Details** — Click any row for: vision lock statement, production subtask checklist, feedback log, content assets tracker, translation checks (phone/headphones/car/speakers/mono), live test log, decision engine
- **Add Track Form** — Name + type + genre + priority
- **Production Glossary** — Collapsible accordion with: 14 production stages explained, translation check guide, 8 content asset types, full 7-phase workflow summary

### Sub-tab: Track Performance
- **Performance Table** — Track name, SC plays, IG posts count, best post engagement, best format
- **Key Insight** — "Top 3 SC tracks have ZERO IG promotion = biggest missed opportunity"

### Sub-tab: Paid Media
- **Ads Command Center** — CRUD for ad campaigns: campaign name, platform (IG/TikTok), objective, budget, spent, status, start/end dates, results
- **Ad Spend Doughnut Chart** — IG vs TikTok spend visualization

---

## Tab 6: SETTINGS

- **Accounts** — Instagram (@itselcapitan_), SoundCloud (itselcapitan), TikTok (@itselcapitan)
- **Data Sources** — Master dataset info, 6 Apify dataset IDs, scrape dates, refresh instructions
- **Data Management** — localStorage info, Firebase sync status, hard reset button

---

## Technical Architecture

- **Single file:** `index.html` (~3,000 lines of HTML + CSS + JS)
- **Data layer:** `MSE` object (read-only analytics), `STATE` object (user data: tracks, tasks, feedback, ads, venues, labels, scores, campaigns)
- **Persistence:** localStorage for fast first-paint, Firebase Realtime DB for cross-device sync (debounced 300ms writes)
- **Charts:** Chart.js 4.x via CDN — 10+ chart instances (doughnuts, bars, lines, sparklines)
- **Deploy:** GitHub Pages via Actions workflow, auto-deploys on push to main
- **View-only mode:** `?view=1` URL parameter hides all edit controls
- **PWA:** manifest.json + service worker for installable app experience

## Data Sources

- Apify scrapers for IG profile + posts
- SoundCloud Artist Pro (manual screenshots)
- IG Professional Dashboard (90-day report, Dec 27 – Mar 26)
- 200 competitor reels scraped from 14 accounts across 6 Apify datasets
- TikTok data manually tracked (5 posts since Mar 20)
- Chalant mentorship notes (Mar 2026)
