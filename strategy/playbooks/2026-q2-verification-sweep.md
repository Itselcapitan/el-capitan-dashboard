# Verification Sweep — 2026 Q2 Strategic Playbook Fact-Check

*Run: 2026-05-05 via Gemini Deep Research*
*Purpose: Validate load-bearing claims from the original
strategic playbook before committing engineering or campaign
budget to recommendations built on them.*

---

## Verified — Trust and Build Around

| Claim | Status | Source | Notes |
|---|---|---|---|
| `media_reels_skip_rate` exposed via Graph API | Verified per third-party docs | [Storrito](https://storrito.com/resources/how-instagram-marketing-api-metrics-work/), [Supermetrics](https://docs.supermetrics.com/docs/instagram-insights-fields) | **PENDING manual test in Graph API Explorer before integration.** Third-party API wrapper services (Storrito, Supermetrics) document fields they EXPOSE; they do not always reflect canonical Meta documentation. The 5-minute Graph API Explorer test is non-negotiable before building infrastructure. |
| `profile_reposts` account-level metric exposed | Verified per Storrito + Supermetrics | Same as above | **PENDING manual test in Graph API Explorer.** Same caveat as skip rate. |
| Instagram Graph API rate limit of 200 calls/user/hour (BUC) | Verified | [Phyllo](https://www.getphyllo.com/post/instagram-api-integration-101-for-developers-of-the-creator-economy), [WP Social Ninja](https://wpsocialninja.com/instagram-graph-api/) | Engineering plan must use batched requests. Pulling 50 reels individually would burn 25% of hourly limit. |
| Higgsfield Cinema Studio 3.0 presets verified | Verified | [Higgsfield Product Blog (canonical)](https://higgsfield.ai/blog/cinema-studio-3) | Genre system (Noir, Drama, Epic) + 8 Speed Ramp presets including "Bullet Time" and "Ramp Up." Plan workflows around these. |
| John Summit was a CPA at Ernst & Young | Verified | [EDM House Network](https://edmhousenetwork.com/john-summit-ctrl-escape-from-cpa-to-dj/) | Real precedent for finance-to-DJ pivot. |
| John Summit's CTRL ESCAPE released April 15, 2026 (US Tax Day) | Verified | [XO Diva D](https://xodivad.com/2026/04/15/john-summit-drops-new-album-ctrl-escape/) | Thematic-anchor release date is replicable. |
| **Nire Donahue** Trial Reels case study (9 reels, 2.3M impressions, 14 days; breakouts at 1.1M, 1.4M, 5M views) | Verified | [niredonahue.com/instagram-trial-reels-case-study](https://niredonahue.com/instagram-trial-reels-case-study/) | **Name correction: "Nire" not "Erin"** — the original playbook misspelled the creator's name. Citation now traceable to her actual blog post. |

## Refuted — Strike from Vocabulary

| Claim | Status | Source | Notes |
|---|---|---|---|
| OpenAI "RealityForge 2.0" released April 2026 | REFUTED | [Startup Fortune editorial](https://startupfortune.com/the-authenticity-backlash-against-ai-was-always-more-wishful-thinking-than-market-reality/), [OpenAI release notes](https://help.openai.com/en/articles/9624314-model-release-notes) | Phantom product. The "RealityForge" name appears only in a speculative editorial. OpenAI's actual April 2026 release notes detail GPT-5.3 / GPT-5.4 only. State-of-the-art video models are Sora 2, Veo 3.1, Kling 3.0. |
| "Global Content Consumption Report" 73% AI-tolerance stat | UNVERIFIED | Same Startup Fortune editorial | Stat cited by an "AI ethicist" in a single editorial. No primary data firm (Nielsen, Pew) published a report with this title or metric. Authenticity rule must remain absolute regardless. |
| **"Made with Edits" metadata tag provides algorithmic boost** | **REFUTED** (upgraded from Disputed in earlier run) | [SocialEcho 2026 Algorithm Guide](https://www.socialecho.net/en/blog/docs/instagram-2026-algorithm-updates-guide), [Splice Blog](https://spliceapp.com/blog/what-video-editing-app-is-better-than-edits/) | Long-term data shows the badge is not a core ranking indicator. Use Edits app defensively to avoid CapCut watermark penalties, NOT as a reach multiplier. |

## Disputed — Use With Caveats

| Claim | Status | Source | Notes |
|---|---|---|---|
| Don Diablo finance/tech-investment background comparable to Aoki | PARTIALLY VERIFIED | [iConnections (Aoki)](https://iconnections.io/insights/video/how-steve-aoki-turned-20m-into-350m-and-why-hes-obsessed-with-health-global-alts-2026/), [Music/Money/Metaverse (Aoki + Web3)](https://cloviahamilton.com/wp-content/uploads/2025/07/music-money-metaverse-how-avenged-sevenfold-steve-aoki-navigate-web3.pdf) | Aoki has formalized $100M VC firm (Aoki Labs); Don Diablo is invested in Web3 (Hexcoin, VR) but no traditional institutional finance background. Use Aoki + Summit as primary precedents for the finance-DJ identity, not Don Diablo. |

---

## Strategic Implications

### 1. Trial Reels variant-cycling — STRENGTHENED
The verified Erin/Nire Donahue case study confirms Trial Reels are a high-volume distribution layer, not just a testing ground. Plan around using Trial Reels as the primary growth mechanism for emerging social presence, bypassing the "ghost follower" suppression on the main feed.

### 2. $ELCAP ticker brand — STRENGTHENED narrative, NOT timing
The verified John Summit CTRL ESCAPE campaign proves the corporate-to-club narrative works in 2026. **However**, this validates the *story*, not the *deployment timing for an emerging-tier artist*. Summit launched with an existing multi-million-stream audience and label budget. El Capitán's ticker rollout should still wait for: (a) verified visual brand testing complete, (b) next released original ready as launch vehicle.

### 3. AI authenticity rule — UNCHANGED, ABSOLUTE
The "73%-don't-care-about-AI" stat was unverified. Market acceptance of synthetic media is not backed by hard data. Authenticity rule remains: AI for environmental world-building only, never for the artist's face or voice.

### 4. Dashboard engineering — PROCEED WITH CAUTION
The 200 calls/hour rate limit is verified — engineering plan must use batched requests. The `media_reels_skip_rate` and `profile_reposts` field names need a 5-minute manual confirmation in Meta's Graph API Explorer before infrastructure is built around them. If real, the dashboard becomes an A&R-grade tool. If hallucinated field names, fall back to documented metrics: reach, saves, shares, plays, total_interactions, avg_watch_time, video_view_total_time.

### 5. Native tooling — DEFENSIVE not OFFENSIVE
The Instagram Edits app is for AVOIDING watermark penalties (vs. CapCut), not for triggering algorithmic boosts. Don't restructure the workflow around an Edits-app multiplier that doesn't exist. Use Edits to keep exports clean.

---

## Manual Verification Tasks (5 min each, must complete before building)

1. **Graph API Explorer test for `media_reels_skip_rate`** — try `GET /{ig-media-id}?fields=insights.metric(media_reels_skip_rate)`. If returns data, verified. If "Invalid metric," refuted. **Highest-stakes verification.**
2. **Graph API Explorer test for `profile_reposts`** — try `GET /{ig-user-id}/insights?metric=profile_reposts&period=day`. Verify or refute.
3. ✅ **Nire Donahue case study** — confirmed real with citation URL: [niredonahue.com/instagram-trial-reels-case-study](https://niredonahue.com/instagram-trial-reels-case-study/). Safe to cite in pitch materials.
