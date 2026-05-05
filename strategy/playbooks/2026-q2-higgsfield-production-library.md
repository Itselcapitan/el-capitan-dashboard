# Higgsfield Production Library + Tooling Comparison

*Run: 2026-05-05 via Gemini Deep Research (follow-up #6)*
*Purpose: Build the production-ready prompt library and workflow for
the "After the Bell" visual world without falling into the AI
uncanny-valley trap.*

---

## 1. Higgsfield Product Stack (May 2026)

Higgsfield is an aggregation workspace, not a single model. The
"After the Bell" workflow uses a specific stack:

| Tool | Role |
|---|---|
| **Cinema Studio 3.0** | Primary motion engine. Physics-aware. `Noir` and `Drama` genre presets are mandatory for the high-contrast late-night Wall Street look. The 8 speed-ramp presets (especially `Bullet Time` and `Ramp Up`) sync visual tension to drops without manual keyframing |
| **Soul ID** | Character-locking. Trains on reference images to keep characters identical frame-to-frame. Used for recurring world characters — NEVER for Reid's face |
| **Nano Banana Pro** | Base-image engine. Native 4K stills with extreme aesthetic adherence. Output feeds Cinema Studio for motion |
| **Higgsfield Popcorn** | Multi-input scene compositor. Feed it character + location + mood; outputs a coherent storyboard. Used to make graffiti look like it physically exists in the scene |

## 2. The $ELCAP Prompt Library (production-ready)

Paste base-image prompts into **Nano Banana Pro**, then push the
output into **Cinema Studio 3.0** or **Kling 3.0** for motion.

### Base-image prompts (Nano Banana Pro / FLUX.2 Pro)

#### 1. The Floor — Wall Street trading scene
```
mid-century modern illustration of a chaotic 1950s wall street
trading floor, esquire magazine editorial style. bold graphic
lines, restrained palette of earth tones. defaced with heavy,
dripping ticker-green and white nyc graffiti spray paint on the
wooden desks. chaotic, optimistic but corrupted, 8k resolution,
architectural photography framing.
```

#### 2. The Vault — basement rave converted from bank vault
```
wsj hedcut stipple portrait style drawing of a dark, subterranean
bank vault converted into a peak-hour underground rave. thousands
of intricate black ink dots and hatching lines on a white
background. shattered safety deposit boxes. vivid money-green
spray paint tags reading "$ELCAP" cutting through the monochrome
ink. high contrast, sharp.
```

#### 3. The Crossing — yacht with stock ticker
```
mid-century 1950s advertising art style of a sleek vintage yacht
cutting through a dark ocean at night. minimal, clean
brushstrokes, soft pastels crossed with deep shadows. a massive
glowing green digital stock ticker wraps around the hull of the
boat. cinematic lighting, quiet luxury, isolated.
```

#### 4. The Penthouse — graffiti-covered NYC penthouse window
```
photorealistic, cinematic composition of a stark, modernist nyc
penthouse at dawn. muted color tones, shallow depth of field,
35mm film grain. the floor-to-ceiling windows are completely
covered in aggressive, anti-establishment street graffiti.
tension between wealth and the underground.
```

### World-building character prompts (Soul ID training)

#### 5. The Broker (recurring character)
```
wsj hedcut ink dot illustration of an exhausted, 1980s
stockbroker in a tailored suit, loosened tie, staring blankly.
sharp hatching lines, corporate tension, highly stylized.
```
Train as Soul ID model named `broker_01`.

#### 6. The Ghost (recurring character)
```
mid-century graphic illustration of a faceless graffiti artist
wearing a tailored high-end suit but a paint-splattered gas
mask. holding a can of neon ticker-green spray paint. bold
lines, simple color blocking.
```
Train as Soul ID model named `ghost_01`.

### Motion + audio-reactive prompts

#### 7. Teaser visualizer (Cinema Studio 3.0)
```
[insert "the floor" base image]. camera logic: slow dolly-in,
subtle crash zoom on the beat drop. genre logic: noir. motion:
realistic physics, natural motion blur, papers flying in the air
as if blown by massive subwoofer pressure. speed ramp: ramp up.
```

#### 8. Audio-reactive workflow (Higgsfield → freebeat)
Higgsfield handles physics well but **for true frequency-driven
audio reaction (visuals pulsing to your 128 BPM kick), export the
Higgsfield asset and run it through freebeat**. Freebeat analyzes
exact BPM, beats, and energy curves to trigger cuts and visual
shifts.

### Utility prompts

#### 9. Relight + Inpaint (for real phone photos)
```
inpaint the background. replace standard club lighting with
aggressive, high-contrast neon ticker-green and stark white
strobe flashes. maintain the human subject exactly as is. add
subtle 35mm film grain.
```
**This solves the original AI authenticity problem**: real photo
of you, AI-enhanced lighting/atmosphere only. No fake studio.

#### 10. Poster/flyer asset (Higgsfield Popcorn)
```
input 1: [blank brick wall texture]
input 2: [your $ELCAP graffiti logo png]
prompt: composite the graffiti logo onto the brick wall so it
matches the lighting, texture, and shadows of the alleyway. make
the paint look freshly sprayed with drips. photorealistic, 8k.
```

## 3. Comparative Tooling (May 2026)

| Platform | Visual Fidelity (Mid-Century / Hedcut) | Motion & Physics | Verdict |
|---|---|---|---|
| **Higgsfield (Kling 3.0 + Soul + Nano Banana Pro)** | Excels at maintaining strict B&W stipple lines without blurring during motion | Physics-aware. Realistic flying papers, dancing crowds | **Primary engine** |
| **Runway Gen-4** | High polish but over-smooths illustrations; graffiti reads digital/sterile | Excellent temporal consistency; locked to 10-sec generations | **Backup only** for complex camera moves Higgsfield fails on |
| **Luma Dream Machine (Ray 3)** | Fast iterative; great for A/B testing | Struggles with stylized 2D-to-3D motion | **Skip** — too unpredictable for editorial brand |
| **Google Veo 3.1** | Best-in-class photorealism + native audio | Best for live-action; overkill for illustration | **Skip** — wrong tool for this aesthetic |

## 4. Cost-per-Asset Math

Standard monthly campaign visual kit:
- 1 cover loop (8s)
- 3 vibe / B-roll teasers (5s each)
- 1 visualizer (15s)
- 1 release-day finisher (5s)
- **Total**: ~43 seconds video

### Higgsfield Pro (Ultra plan — already subscribed)
- Monthly fee: $99
- 3,000 credits included
- Kling 3.0 (1080p) = 10 credits per 5-second clip
- Per kit: 9 generations × 10 credits = 90 credits
- With 3× iteration failure rate: ~270 credits
- **<10% of monthly allocation** = major-label-grade visual rollout

### Competitor cost comparison (out of pocket)
| Tool | Cost for 43 seconds |
|---|---|
| Sora 2 (OpenAI) | Requires ChatGPT Pro at $200/mo |
| Runway Gen-4 ($15/mo Standard, 625 credits) | 12 credits/sec × 43 = 516 credits — entire budget on one rollout |
| Veo 3.1 ($0.40/sec HD) | $17.20 in compute alone, plus subscription |

**Conclusion**: Higgsfield Ultra is the most economically viable
1080p video engine on the market right now. Don't migrate.

## 5. Authenticity Guardrails — FORBIDDEN WORKFLOWS

Your value as a DJ relies on being a real human in physical rooms.
AI backlash in 2026 is fatal to artists who fake their presence.

### NEVER use these 5 Higgsfield tools

1. **Soul ID trained on Reid Vanslette**. Do not upload your face
   to create a digital avatar. One rendering glitch = permanent
   underground credibility burn.
2. **Lipsync Studio** — making yourself "speak" to camera. If you
   have an announcement, film it raw on iPhone.
3. **Talking Avatar** — banned. Reads as cheap corporate
   marketing; destroys gritty After-the-Bell aesthetic.
4. **Face Swap** — generating a cool DJ shot then putting your
   face on it. Same problem as Soul ID.
5. **UGC Factory** — generating fake human reactions. Do NOT use
   to fake crowd reactions to drops. Underground scene catches
   this fast.

## 6. Workflow Timing — 8-Week Schedule

| Week | Task |
|---|---|
| 8 | Lock the audio master. Define the visual metaphor (e.g., $ELCAP ticker plunging into red) |
| 7 | 2 hours in Nano Banana Pro generating base stills. Lock the 4 best frames |
| 6 | Push 4 locked frames into Cinema Studio 3.0. Apply speed ramps. Export raw video |
| 5 | Run exported video + master audio through freebeat to lock rhythmic cuts |
| 4-1 | Deploy via Trial Reels variant-cycling strategy. No frantic midnight editing required |

---

## Strategic Implications for El Capitán

1. **You're already on the most cost-effective platform** —
   Higgsfield Pro (Ultra) is $99/mo but produces ~$1,000 of
   competitor-equivalent output per release cycle.

2. **The Relight + Inpaint utility prompt (#9) is the answer to
   your authenticity problem.** Real photos of you, AI-enhanced
   atmosphere only. Use this for the "studio shots people clowned
   me for" replacement workflow.

3. **The character roster (Broker + Ghost) is what makes the world
   feel populated** — without these, every scene needs a fresh
   character invented per render. With them, the visual brand
   compounds over time.

4. **Audio-reactive output requires freebeat**, not Higgsfield
   alone. Higgsfield's visual drift to the kick drum is approximate
   at best.

5. **The 8-week schedule must be enforced.** AI iteration is
   underestimated. Reserving Weeks 7 and 6 specifically for
   generation + render is the difference between sloppy and
   professional output.

6. **Forbidden workflows are non-negotiable.** Even one slip-up
   (face swap on a "this is me at the festival" post) creates a
   detectable pattern that breaks the brand.

## Action items

1. **Test prompt #1 (The Floor) in Nano Banana Pro** to validate
   the aesthetic before locking the style guide
2. **Train `broker_01` and `ghost_01` Soul ID models** with 5-10
   reference images each (~30 minutes total)
3. **For the next release (Missing or The Money)**, run the full
   8-week schedule starting Week 8 from release date — Week 7
   should overlap with Nano Banana Pro generation
4. **Test prompt #9 (Relight + Inpaint)** on one real phone photo
   from a recent gig — this is the lowest-risk way to introduce
   AI assets to the feed
5. **Skip Sora / Veo / Runway / Luma evaluations** unless
   Higgsfield specifically fails on a shot
