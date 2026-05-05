# Verification Sweep — 2026 Q2 Strategic Playbook Fact-Check

*Run: 2026-05-05 via Gemini Deep Research*
*Purpose: Validate load-bearing claims from the original
strategic playbook before committing engineering or campaign
budget to recommendations built on them.*

---

## Verified — Trust and Build Around

| Claim | Status | Notes |
|---|---|---|
| `media_reels_skip_rate` exposed via Graph API | Verified per third-party docs (Supermetrics, Storrito) | **PENDING manual test in Graph API Explorer before integration** — third-party docs sometimes lag/diverge from canonical Meta docs |
| Higgsfield Cinema Studio 3.0 presets ("Bullet Time," "Ramp Up," "Genre" with Noir/Drama/Epic options) | Verified per Higgsfield Product Blog | Plan workflows around these named presets |
| Instagram Graph API rate limit of 200 calls/user/hour for Business Use Cases | Verified per Phyllo + WP Social Ninja | Engineering plan must use batched requests; pulling 50 reels individually would burn 25% of hourly limit |
| `profile_reposts` account-level metric exposed | Verified per Storrito + Supermetrics | **PENDING manual test in Graph API Explorer** — same caveat as skip rate |
| John Summit was a CPA at Ernst & Young before music career | Verified per EDM House Network | Real precedent for finance-to-DJ pivot |
| John Summit's CTRL ESCAPE released April 15, 2026 (US Tax Day) | Verified | Thematic-anchor release date is replicable |
| Erin Donahue (Nire Donahue?) Trial Reels case study (9 reels, 2.3M impressions, 14 days) | Verified per "Nire Donahue Official Blog" | **Name discrepancy: Erin vs. Nire — second manual verification suggested before citing in pitch materials** |

## Refuted — Strike from Vocabulary

| Claim | Status | Notes |
|---|---|---|
| OpenAI "RealityForge 2.0" released April 2026 | REFUTED | Phantom product. Original claim traces to a speculative/satirical post on Startup Fortune. State-of-the-art video models in 2026 are Sora 2, Veo 3.1, Kling 3.0. |
| "Global Content Consumption Report" with 73% AI-tolerance stat | UNVERIFIED / SUSPECT | Single editorial source ("Dr. Elena Vance" on Startup Fortune). No major data firm (Nielsen, Pew) published this stat. Authenticity rule must remain absolute regardless. |

## Disputed — Use With Caveats

| Claim | Status | Notes |
|---|---|---|
| "Made with Edits" metadata tag provides algorithmic boost | DISPUTED | No official Mosseri/Meta statement guarantees a boost. Use Edits app for defensive reasons (avoid CapCut watermarks, access native skip-rate insights), NOT as a magic-bullet for inflated reach. |
| Don Diablo finance/tech-investment background comparable to Aoki | PARTIALLY VERIFIED | Aoki has a formalized $100M VC firm (Aoki Labs). Don Diablo is invested in Web3 (Hexcoin, VR) but no traditional Wall Street/institutional VC background. Use Aoki + Summit as primary precedents for the finance-DJ identity, not Don Diablo. |

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

1. **Graph API Explorer test for `media_reels_skip_rate`** — try `GET /{ig-media-id}?fields=insights.metric(media_reels_skip_rate)`. If returns data, verified. If "Invalid metric," refuted.
2. **Graph API Explorer test for `profile_reposts`** — try `GET /{ig-user-id}/insights?metric=profile_reposts&period=day`. Verify or refute.
3. **Google search "Nire Donahue Trial Reels" and "Erin Donahue Trial Reels"** — confirm one or the other is a real creator with a real blog. If neither returns a real source, downgrade Trial Reels case study to "directionally correct, citation-pending."
