# ORATO — Understanding the Engine

This document explains **how ORATO actually works under the hood** — the
reasoning behind each pipeline stage, the exact thresholds/word-lists in
use, and the known limitations. The README tells you how to run it; this
tells you how it *thinks*.

**This file is updated at the end of every build step.** If you're reading
this after a new feature was added and it's not reflected here yet, treat
this doc as temporarily stale and check the changelog at the bottom for
what's pending.

---

## 1. Design principles — how this app is supposed to behave

These are the standing rules the engine is built around. Any new feature
should follow them unless there's a specific, stated reason not to.

1. **Nothing leaves the browser.** No upload, no backend call, no
   third-party API for the actual speech/video analysis. Models run
   on-device via WASM/WebGPU. This is the entire reason this version
   exists instead of just using the FastAPI backend.
2. **Self-calibrate against the person, not a hardcoded constant.**
   Gaze zones are classified against *this session's* neutral baseline,
   not a fixed angle. Filled-pause detection compares audio energy
   against *this recording's* own speech level, not an absolute volume.
   Anywhere a threshold depends on hardware/environment (mic gain, camera
   angle, room noise), calibrate against the person's own signal instead
   of guessing a universal number.
3. **Fail loud, not silent.** If a model fails to load, or a browser
   doesn't support a required API, the UI shows an explicit error — it
   doesn't quietly produce a zero or an empty result that looks like a
   real (bad) score.
4. **Prefer measured signals over inferred ones.** Where possible, detect
   things from the actual audio/video signal rather than trusting a
   downstream model's text output to be complete — see §4 for why this
   matters concretely (Whisper drops filler words from its text).
5. **Every tunable constant is flagged as tunable, in the code, at the
   point of definition.** Nothing that affects scoring should be a
   silent magic number — see §7 for the current list.
6. **A slow or failed step should never block or take down an unrelated,
   already-ready result.** The score is ready well before the annotated
   video is (video compositing plays back in real time — it's the slowest
   step by far). The score should never wait on it, and a compositing
   failure should never hide or invalidate the score. See §9 for how
   this is actually implemented.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Practice.tsx                          │
│  (orchestrates every stage below, all client-side)             │
└─────────────────────────────────────────────────────────────┘
        │                │                    │
        ▼                ▼                    ▼
  useMediaRecorder   useFaceTracking     useWhisperTranscription
  (webcam+mic         (MediaPipe          (Transformers.js,
   capture)            FaceLandmarker,     Whisper ONNX,
                        live, per-frame)    post-recording)
        │                │                    │
        └────────┬───────┴──────────┬─────────┘
                  ▼                  ▼
          scoreEngine.ts     filledPauseDetection.ts
          (combines audio +   (recovers um/uh from
           gaze into a         raw audio energy —
           0-100 score)        see §4)
                  │
                  ▼
          useVideoCompositor
          (canvas overlay + re-record → downloadable file)
                  │
                  ▼
              Results.tsx
      (score ring, metric cards, coach feedback,
       annotated video — via router state, no persistence yet)
```

No backend, no database. `SessionResult` (the full shape of one practice
session) is defined once in `src/types/metrics.ts` and flows through every
stage above unchanged in shape.

---

## 3. The gaze/eye-contact engine

**File:** `src/media/vision/`

- **Model:** MediaPipe `FaceLandmarker` (`.task` file, ~3.7MB), loaded via
  `@mediapipe/tasks-vision`, running in `VIDEO` mode against the live
  camera stream during recording (`useFaceTracking.ts`).
- **Delegate:** requests GPU first via WebGL, with explicit hardening
  before falling back to CPU — see the fixed-bug note in the changelog
  and `faceLandmarker.ts` for the full reasoning. This section used to
  claim MediaPipe's internal fallback was "reliable" — that was an
  unverified assumption that turned out to be wrong (confirmed: it
  could crash-loop under Brave+Wayland, same symptom class as the
  WebGPU/ONNX situation in §4, just a different code path). Own
  detection/timeout/fallback logic now handles this explicitly rather
  than trusting the library's internal behavior.
- **Calibration:** conceptually mirrors the original Python backend's
  approach — an initial settle period is discarded, then a window
  establishes a neutral horizontal/vertical iris baseline, and every
  frame after that is classified relative to that baseline, not an
  absolute angle. **Unlike the Python version, this is time-based
  (`DISCARD_MS` + `CALIB_MS`, `performance.now()` deltas), not a raw
  tick count** — see the fixed-bug note directly below for why that
  distinction matters.
- **✅ Fixed — calibration/blink timing was hardware-dependent.** The
  original implementation counted `requestAnimationFrame` ticks (30 to
  discard, 60 to calibrate) rather than measuring elapsed real time.
  Since rAF tick rate is usually synced to display refresh rate (and
  further gated by how fast `detectForVideo()` can run per tick), real
  calibration duration varied across hardware — a higher-refresh display
  or faster GPU would finish "30 frames" in noticeably less real time
  than a 30fps-effective setup, giving the person less actual settling
  time on faster hardware, which is backwards from what you'd want.
  Fixed by switching to `performance.now()`-based elapsed time
  (`DISCARD_MS` + `CALIB_MS`, summing to 2000ms total) — guarantees the
  same real-world calibration duration on any device. A faster device
  now just collects more samples in the same time window, which only
  improves the averaged baseline. The blink debounce had the identical
  bug (a fixed tick count) and got the same fix (`BLINK_DEBOUNCE_MS`).
- **Gaze zones:** `ON_CAMERA`, `LEFT`, `RIGHT`, `UP`, `DOWN` — classified
  in `gazeMath.ts` by comparing horizontal/vertical deviation against
  `GAZE_H_THRESH` / `GAZE_V_THRESH` (currently `0.12` each).
- **✅ Fixed — dominant-axis comparison was scale-unfair.** `dx` and `dy`
  are scaled by very different upstream factors before classification
  (`H_SCALE=1.8` vs `V_SCALE_UP/DOWN=5.0–7.0`, in `classifyWithCalibration`)
  — so comparing their raw magnitude to decide LEFT/RIGHT vs UP/DOWN meant
  ordinary vertical landmark jitter could out-scale a genuine horizontal
  glance purely from being amplified 3–4x more, not because it was
  actually more significant. `classifyZone` now compares **excess past
  each axis's own threshold** instead of raw magnitude — this was already
  a documented principle from the Python side ("use threshold-relative
  excess... to prevent one dominant axis overriding the other") that the
  shipped code hadn't actually implemented until this fix. If gaze zones
  still feel like they mix up left/right and up/down after this, the next
  suspect is missing head-pose compensation — see below.
- **⚠️ Still open — no head-pose compensation in the browser.**
  `video_analyzer.py` blends head yaw into the horizontal signal
  (`HEAD_YAW_WEIGHT`) and has a pitch-based override for vertical
  classification (looking down with the head, not just the eyes, forces
  a confident DOWN read rather than trusting noisy iris-offset math
  alone). None of that head-pose logic has been ported to `gazeMath.ts`
  — this version classifies from iris-offset-to-corner alone. If someone
  turns their head slightly rather than just moving their eyes, this
  version has no signal to correct for it, unlike the Python original.
  MediaPipe's `FaceLandmarker` can output a facial transformation matrix
  directly (`outputFacialTransformationMatrixes: true`), which would
  avoid needing a manual solvePnP port — worth building if zone
  misclassification persists after the fix above.
- **✅ Fixed — live preview mirror was inverting left/right consistently.**
  The live self-view during recording had a CSS `scale-x-[-1]` mirror for
  visual comfort, but MediaPipe reads the raw camera frame underneath
  that CSS entirely unaffected by it. A viewer looking at a mirrored
  self-view while the gaze math ran on unmirrored coordinates produces
  exactly a consistent, always-the-same-direction left/right swap — the
  telltale sign this specific bug produces, as opposed to the noisy
  axis-confusion bug above. Rather than flip the math (which would then
  contradict the recorded/exported video, which was never mirrored),
  the live preview's mirror was removed instead — matching the Home
  page's own stated purpose ("see what others see") consistently across
  the live view, the gaze labels, and the exported video. Real
  presentation-coaching value in this too: an audience doesn't see you
  mirrored, so training against your true orientation is arguably more
  useful than a comfortable mirror illusion.
- **⚠️ Known open question — inner/outer corner convention:** this file
  uses `LEFT_INNER=133, LEFT_OUTER=33` (matching the Python backend's
  production `video_analyzer.py`). The Python backend has a SECOND,
  different convention in its experimental `eye_tracker.py`
  (`LEFT_INNER=33, LEFT_OUTER=133`). Which one is actually correct was
  never conclusively verified via `debug_gaze.py` on the Python side. If
  gaze direction ever appears backwards in this web version (looking
  left registers as RIGHT), **this is the first thing to check** — flip
  `LEFT_INNER`/`LEFT_OUTER` (and the matching right-eye constants) in
  `gazeMath.ts`.
- **Eye contact → score:** `gazeOnScreenPct` (percentage of frames
  classified `ON_CAMERA`) maps linearly to a **trust multiplier between
  0.50 and 1.00** — see §6. It is a multiplier on the audio score, not an
  additive component; strong eye contact can't compensate for genuinely
  poor speech content, and poor eye contact never fully zeroes the score.

---

## 4. The transcription engine — and why filler words needed a workaround

**File:** `src/media/audio/`

- **Model:** `onnx-community/whisper-base` via `@huggingface/transformers`
  (Transformers.js), running via ONNX Runtime Web.
- **Device selection:** WebGPU is used only if
  `navigator.gpu.requestAdapter()` **actually succeeds** — checked
  explicitly *before* ever requesting the WebGPU device, rather than
  trying WebGPU and catching a failure. This matters because some
  browsers (notably Brave, which disables WebGPU by default) produce a
  failure mode that surfaces as an **unhandled promise rejection deep
  inside ONNX Runtime Web**, not a catchable error at the call site — see
  `whisperTranscriber.ts`'s `detectWebGPU()` for the reasoning. Falls back
  to WASM automatically.
- **Word timestamps are interpolated, not exact.** True word-level
  timestamps require the model's cross-attention outputs for DTW
  alignment, which this ONNX export doesn't expose — attempting
  `return_timestamps: "word"` throws `"Model outputs must contain cross
  attentions..."`. Instead, segment-level timestamps (reliably supported)
  are used, and `interpolateWordsFromSegment()` distributes each
  segment's duration across its words by word length. This is a close
  approximation, not frame-accurate — fine for filler/pause detection
  (which cares about ~seconds, not milliseconds), not fine for anything
  needing precise word-level sync.

### Filler words — the actual detected list

**Text-based** (`fillerDetection.ts`) — checked against Whisper's
transcribed words:

| Type | Words/phrases |
|---|---|
| Single words | `um`, `umm`, `uh`, `uhh`, `er`, `erm`, `like`, `actually`, `basically`, `literally` |
| Phrases | `you know`, `i mean`, `sort of`, `kind of` |

Deliberately **excluded**: `so`, `well`, `right` — these are far more
often legitimate words than fillers in normal speech, and flagging them
produces false positives that erode trust in the score faster than
missing an occasional real one.

**Acoustic** (`filledPauseDetection.ts`) — the actual fix for the core
problem: **Whisper silently drops filled pauses ("um", "uh", "err") from
its text output.** This is a known, general Whisper behavior — not a bug
in this setup — and the usual server-side fix (`initial_prompt` biasing)
isn't available in Transformers.js yet (tracked upstream as
huggingface/transformers.js#923, #1028 — both open, unresolved as of this
writing).

The workaround: measure the person's own average speech energy (RMS)
from audio during words Whisper *did* transcribe, then check every
detected silence gap (from `pauseDetection.ts`) against that baseline. A
gap with real vocal energy (≥ `FILLED_PAUSE_ENERGY_RATIO` = **0.15** ×
speech level) is reclassified as a filled pause and folded into the
filler count — a genuinely silent gap stays a pause. This is
self-calibrated per recording (see principle #2 in §1), not a hardcoded
volume threshold.

**This ratio is an untested starting guess, not a derived constant** —
if real "um"s are still missed, lower it; if normal breathing/silence
gets flagged, raise it. Single tunable line in `filledPauseDetection.ts`.

**Current limitation:** only pauses ≥ `PAUSE_THRESHOLD_SEC` (0.5s) are
ever checked — a very quick "um" with no real gap around it won't be
caught by either method.

---

## 5. Pace & vocabulary metrics

**File:** `src/media/audio/paceAndVocab.ts`

- **MATTR** (Moving-Average Type-Token Ratio) — lexical diversity,
  computed over a rolling **25-word window** so it stays stable regardless
  of how long someone talks (a plain type/token ratio trends down with
  length even if vocabulary use isn't actually getting less varied).
- **Articulation rate** — words per minute, **excluding detected pause
  time** — a truer measure of actual speaking speed than raw WPM.
- **Speech ratio** — (speaking time) / (total duration) — how much of the
  session was spent actually talking vs. paused.
- **Repeated phrases** — 3-word n-grams repeated 2+ times, surfaced as a
  sign of verbal crutches.

---

## 6. The scoring engine

**File:** `src/media/scoring/scoreEngine.ts`

```
combinedScore = audioScore × eyeContactMultiplier
```

`audioScore` (0–100) is a weighted blend:

| Component | Weight | Notes |
|---|---|---|
| Filler rate | 35% | `100 − fillersPerMinute × 12`, floored at 0 |
| Vocabulary richness (MATTR) | 25% | scaled against a 0.75 MATTR ceiling |
| Speaking pace | 25% | penalized by deviation from an ideal **145 wpm** |
| Speech ratio | 15% | scaled, capped at 100 |

`eyeContactMultiplier` (0.50–1.00) is a **linear map** of
`gazeOnScreenPct`: 0% on-screen → 0.50, 100% on-screen → 1.00.

**All weights, the ideal-pace constant, and every grade threshold
(excellent/good/fair/needs_work cutoffs) are initial heuristics, not
derived from real user data.** They're isolated in one file specifically
so they're easy to revisit once there's a meaningful sample of real
practice sessions to calibrate against.

---

## 7. Every currently-tunable constant, in one place

| Constant | File | Current value | What it controls |
|---|---|---|---|
| `GAZE_H_THRESH` / `GAZE_V_THRESH` | `gazeMath.ts` | 0.12 | How far off-center counts as looking away |
| `DISCARD_MS` / `CALIB_MS` | `gazeMath.ts` | 600ms / 1400ms | Gaze calibration window length (time-based, not frame-count — device-independent) |
| `BLINK_DEBOUNCE_MS` | `gazeMath.ts` | 60ms | How long EAR must stay below threshold to count as a real blink (time-based, same reasoning as calibration) |
| `GPU_INIT_TIMEOUT_MS` | `faceLandmarker.ts` | 6000ms | How long to wait for GPU delegate init before falling back to CPU (guards against Brave-style hangs) |
| `EAR_BLINK_THRESH` | `gazeMath.ts` | 0.20 | Eye-aspect-ratio blink cutoff |
| `PAUSE_THRESHOLD_SEC` | `pauseDetection.ts` | 0.5s | Minimum gap counted as a pause |
| `FILLED_PAUSE_ENERGY_RATIO` | `filledPauseDetection.ts` | 0.15 | Energy vs. speech-level ratio for um/uh detection |
| `MATTR_WINDOW` | `paceAndVocab.ts` | 25 words | Lexical diversity window size |
| Filler word/phrase list | `fillerDetection.ts` | see §4 table | What counts as a text filler |
| Scoring weights + ideal pace | `scoreEngine.ts` | see §6 | How the final score is composed |

---

## 8. Known limitations (current, honest state)

- **No full persistence, only a lightweight score history.**
  `Results.tsx` gets its detailed data (transcript, gaze frames, metrics)
  via router state from a just-finished session — a refresh loses all of
  that. `sessionHistory.ts` does save a small history (score + timestamp
  only) to `localStorage`, shown as "Your progress" once there's more
  than one session — but that's a summary trail, not real persistence of
  a session's full detail. No backend, no database.
- **Gaze corner convention unverified** — see §3's warning box.
- **Word timestamps are approximate**, not frame-accurate — see §4.
- **Compositor sync is good, not frame-perfect** — canvas frames come
  from `requestAnimationFrame`, audio from the source track directly.
- **✅ Fixed — recording would have silently failed or produced an
  unusable file on a meaningful share of Safari/iOS visitors.** Both
  `useMediaRecorder.ts` (the initial recording) and
  `composeFinalVideo.ts` (the exported video, a *separate* mime-type
  decision — it re-records the canvas independently) had WebM-only
  mime-type lists. Verified via research rather than assumed: Safari
  only gained *any* WebM recording support as of Safari 18.4 (March
  2025), and that support is primarily audio-focused per current
  documentation — video *encoding* support (as opposed to playback) has
  historically lagged further behind. Anyone on Safari 14.5–18.3 (a
  large real population, especially older iPhones that don't update
  aggressively) had zero working fallback. Fixed by adding
  `video/mp4;codecs=avc1,mp4a` / `video/mp4` to both mime-type lists,
  checked via the same `MediaRecorder.isTypeSupported()` pattern already
  used everywhere else — this only activates where WebM genuinely isn't
  available, Chrome/Firefox/Brave behavior is unchanged. This also
  surfaced a second real bug while fixing it: the downloadable video's
  filename was hardcoded as `orato-practice-session.webm` — wrong if the
  actual file were MP4. `composeFinalVideo.ts` now exposes the actual
  `mimeType` used in its `ComposeResult`, threaded through
  `CompositorContext` as `resultMimeType`, and a new
  `mimeTypeToExtension()` helper derives the correct file extension for
  the download link instead of assuming one.
- **`HTMLVideoElement.captureStream()` audio support varies by browser**
  — the compositor logs a console warning and produces a silent video
  rather than failing outright if unsupported.
- **Brave + Wayland can produce a GPU-process crash loop** unrelated to
  this app's own code — see `.gitignore`/README troubleshooting notes if
  this recurs; regular Chrome does not exhibit this.
- **Scoring thresholds are untuned** — see §6.

---

## 9. Failure isolation — why video generation can't block the score

**Problem this solves:** transcription + scoring finish quickly, but video
compositing (§ above — a real-time canvas replay) is the slowest step by
a wide margin. Originally, `Practice.tsx` waited for compositing to finish
before letting the person see *anything* — meaning the fastest part of
the pipeline was gated by the slowest.

**Fix:** `CompositorContext.tsx` (`src/context/`) lifts video-composition
state ABOVE the router in `App.tsx`, wrapping `<Routes>`. This matters
because `composeFinalVideo()` doesn't actually depend on React's component
tree — it creates its own detached `<video>`/`<canvas>` elements and
drives them with `requestAnimationFrame`, so it keeps running correctly
even after the component that started it unmounts. Putting its *state*
in a context that survives navigation means:

- `Practice.tsx` shows "View my results" the moment scoring is done —
  not waiting on the video at all.
- Navigating to `/results` doesn't cancel or orphan the in-progress
  video job; it's still running in the same context.
- `Results.tsx` subscribes to the *live* compositor state instead of a
  static value passed at navigation time — the video section shows a
  spinner + percentage while composing, then swaps to the actual player
  once `status` flips to `"done"`, with zero coordination needed between
  the two pages beyond both reading the same context.
- If compositing fails, `Results.tsx` shows an isolated error message
  in just that section — the score ring, metric cards, coach feedback,
  and transcript above it are entirely unaffected, because they were
  already fully rendered from data that doesn't depend on the video at
  all.

**✅ Fixed — a real bug, not just the limitation predicted above.** The
original guard (`compositorStatus === "idle"` before starting a new
compose job) meant a SECOND take's video never composed at all: after
the first take finished, status stayed stuck at `"done"` forever (nothing
ever reset it), so the guard silently blocked forever, while the OLD
video's URL kept sitting in context looking like a valid, current result.
Symptom: the previous take's video showing up on a second recording,
not any kind of browser caching issue.

Fixed with two pieces, both in `CompositorContext.tsx`:
- `resetCompositor()` — called from `Practice.tsx` at the start of any
  new recording (both `handleRecordAgain` AND the original
  `handleStartRecording`, since a fresh take can be reached either way,
  not just through the "Record again" button).
- A generation counter, because a reset alone isn't sufficient — "Record
  again" is deliberately reachable WHILE the previous take's video might
  still be composing (that's the whole point of this section). Each
  compose call captures the generation it started with; if that no
  longer matches by the time it resolves, the result is discarded
  instead of overwriting a newer session's state.

**Still a real, honest limitation:** discarding a stale result isn't the
same as cancelling the work that produced it. An abandoned compose job
(from rapidly re-recording before the previous one finished) keeps
running in the background — playing back the old video, drawing frames,
encoding — until it naturally finishes, even though its result will be
thrown away. True cancellation would need an `AbortController` threaded
through the whole `requestAnimationFrame` draw loop and the
`MediaRecorder` in `composeFinalVideo.ts`. Not implemented — the
realistic frequency of rapid multi-take re-recording within one
compose's duration is low, and the correctness bug (wrong video shown)
is what actually mattered.

---

## 10. PWA — installable, works offline after first visit

**Why this exists:** the whole architecture story is "runs entirely
on-device, models cached after first visit" — this section makes that
literally true instead of just directionally true. A visitor can install
ORATO to their home screen/desktop and reopen it with no network at all,
once they've loaded it at least once while online.

**Hand-rolled, not `vite-plugin-pwa`.** That package pulls in
`workbox-build`, which bundles its own copies of rollup/terser — another
heavy dependency tree, the exact category of thing that caused this
project's earlier `onnxruntime-node` install-time pain. `public/sw.js` is
plain JS, registered directly as a static file with zero build-tooling
integration. Same philosophy as the hand-built compositor and contexts
elsewhere in this codebase: prefer direct control over pulling in a
library for something scoped enough to write directly.

**Caching scope is deliberately narrow:**
- **Cached**: the app shell (HTML/JS/CSS/icons/manifest/favicon) and the
  self-hosted MediaPipe model (`/models/face_landmarker.task`) — all
  same-origin.
- **NOT touched, on purpose**: Whisper's model weights
  (`huggingface.co`) and the ONNX/MediaPipe WASM runtime
  (`cdn.jsdelivr.net`) — both cross-origin, and both already managed by
  Transformers.js/onnxruntime-web's own use of the Cache Storage API
  (see §4). The service worker explicitly ignores any cross-origin
  request rather than trying to re-cache what those libraries already
  handle — redundant at best, a cache-key conflict risk at worst.

**Caching strategy**: navigation requests are network-first with a
cached-shell fallback (online visitors always get the freshest version;
offline visitors get whatever was last cached). Static same-origin
assets are cache-first, populated lazily on first real fetch — hashed
build filenames aren't known ahead of time without a generated build
manifest (which is what the Workbox-based tooling would have provided),
so this hand-rolled version can't precache them by exact hash the way
that tooling does.

**Dev-mode safety**: registration is gated on `import.meta.env.PROD` —
a service worker intercepting fetches during `npm run dev` would fight
with Vite's hot module reload in confusing ways.

**Honest limitations, stated plainly:**
- **Manual cache-version bump required on every deploy.** `CACHE_VERSION`
  in `sw.js` has to be bumped by hand for returning visitors to get a
  fresh app shell — there's no automated build-hash-based invalidation,
  the explicit tradeoff of not using Workbox's tooling.
- **No "update available" UI.** A new service worker activates via
  `skipWaiting()`/`clients.claim()` on the next load, but there's no
  in-app prompt telling the person a new version is ready — they'll just
  get it silently next time they open the app.
- **A missing `vite-env.d.ts` surfaced while building this.** The
  project was hand-scaffolded file-by-file back in step 1 rather than
  via the actual `npm create vite` CLI, which normally generates this
  file automatically — it just never mattered until `import.meta.env`
  was used for the first time here. Added now; worth knowing in case
  anything else the CLI normally scaffolds is still quietly missing.
- **Not verifiable from the assisting environment.** Actual install
  prompts, home-screen behavior, and true offline testing all need a
  real browser — verified everything checkable from here (manifest is
  valid JSON, every precached URL exists in the build output so
  `cache.addAll()`'s atomic all-or-nothing install can't silently fail,
  `sw.js` passes a syntax check, `tsc`/`vite build` both clean) but
  actual installability needs confirming in a real browser (Chrome
  DevTools → Application → Manifest/Service Workers, or a Lighthouse PWA
  audit) before relying on it.

---

## Changelog

*Newest first. Each entry should say what changed and, if relevant, why.*

- **Fixed: real Safari/iOS recording gap, not just polish.** Identified
  as the priority pre-deployment fix, then verified with actual research
  (not assumed) before acting: Safari's WebM *recording* support (as
  opposed to playback) only arrived at all in Safari 18.4 (March 2025)
  and is primarily audio-focused even then — both `useMediaRecorder.ts`
  and `composeFinalVideo.ts` were WebM-only, meaning a meaningful share
  of real iOS/macOS Safari visitors would have hit silently broken
  recording. Added an MP4 fallback (`video/mp4;codecs=avc1,mp4a`) to
  both, checked via the existing `MediaRecorder.isTypeSupported()`
  pattern so it only activates where WebM genuinely isn't available.
  Also caught and fixed a second real bug this surfaced: the downloadable
  video's filename was hardcoded `.webm`, which would have been wrong on
  Safari. `composeFinalVideo.ts` now reports its actual `mimeType`,
  threaded through `CompositorContext` as `resultMimeType`, with a new
  `mimeTypeToExtension()` helper building the correct filename. See §8.
- **Practice route actually code-split now.** This was suggested with a
  code snippet during an earlier performance discussion but never
  actually implemented — confirmed by checking `App.tsx` directly rather
  than assuming, since the conversation had moved on to other features
  (PWA, scenarios) before it got built. `Practice` is now
  `React.lazy()`-loaded behind a `<Suspense>` boundary in `App.tsx`.
  Verified Home.tsx has zero import path to MediaPipe/Transformers.js
  before doing this (not assumed), then confirmed the split actually
  worked by checking real build output, not just a clean compile: the
  main bundle dropped from 1,218KB to 192KB (339KB → 62KB gzipped), with
  `Practice` + its AI dependencies now in their own ~1MB chunk that only
  loads when someone actually visits `/practice`. Anyone browsing
  Home/About downloads roughly 5.4x less JS than before.
- **Gaze display simplified to binary "Focus: On/Off".** Both the live
  recording overlay (`Practice.tsx`) and the exported video's overlay
  (`drawOverlays.ts`) previously showed the raw zone name
  (LEFT/RIGHT/UP/DOWN/ON_CAMERA). Now both just show "Focus: On" (sage/
  green) for ON_CAMERA and "Focus: Off" (orange) for every other
  direction — deliberately using the app's existing sage/orange pair
  rather than introducing a literal new red, since orange already
  functions as this app's "needs attention" color everywhere else
  (MetricCard grades, ScoreRing thresholds). **Only the display
  changed** — `gazeMath.ts`'s 5-zone classification, `zoneDistribution`,
  and scoring are completely untouched; this was a presentation-layer
  simplification only. Checked for other leak points (`zoneDistribution`
  is computed and stored but was never actually rendered anywhere else)
  — confirmed these were the only two places showing per-direction
  labels. Bumped `CACHE_VERSION` to v4.
- **In-app PWA install banner.** Most people never notice the browser's
  small native install icon — `InstallPromptContext.tsx` captures the
  `beforeinstallprompt` event (lives above the router, same pattern as
  `CompositorContext`, since the event can fire before any page component
  mounts) and `InstallBanner.tsx` offers an explicit "Install" button.
  Placed as a slim dismissible bar below the Navbar rather than a 4th
  Navbar item — that nav is already tight at a 320px viewport (a real
  overflow bug was fixed there once already, see the responsive-pass
  entry below), so a conditional extra item risked reintroducing the
  same class of problem the moment install support was actually
  available. Dismissal persists via `localStorage` so it doesn't nag
  every visit once declined. Firefox and Safari don't support this event
  or the underlying install flow at all — the banner simply never
  appears there, which is correct, not a gap. Bumped `CACHE_VERSION` to
  v3 per the documented process, since the app shell changed again.
- **Four product gaps closed: scenario prompts, countdown, discard
  confirmation, unsupported-browser check.**
  - `lib/scenarios.ts` — 4 hardcoded prompts + an explicit "free
    practice" choice. A picker screen shows once per fresh Practice
    mount, before camera permission is even requested. The chosen
    scenario's `id` now actually populates `SessionResult.scenarioId`
    (the type always had this field; it was hardcoded to `null` until
    now). Results.tsx looks it up by id and shows the prompt title if
    one was used.
  - 3-2-1 countdown before recording actually starts, replacing the old
    instant-start on "Start recording" click. Caught and fixed a real
    race condition while building this: "Change prompt" was reachable
    during the countdown, which would show the scenario picker again
    while a pending `setTimeout` was still ticking in the background —
    a few seconds later it would have silently called `startRecording()`
    while the person was looking at the picker, not the camera. Both
    "Change prompt" and the "Start recording" button itself are now
    gated on `countdown === null`.
  - "Record again" no longer instantly discards the current take — both
    places it can be triggered (transcription-error state, and the
    normal scoreReady state) now share one confirm-before-discard
    control (`renderRecordAgainControl`) instead of duplicating the
    confirm UI or wiring one spot and forgetting the other.
  - `lib/browserSupport.ts` checks for `getUserMedia`, `MediaRecorder`,
    and `WebAssembly` once on mount (a lazy `useState` initializer, since
    these don't change during a session) and shows a clear message
    listing exactly what's missing, instead of letting the person hit a
    confusing failure deep inside the recording or model-loading flow.
  - Bumped `sw.js`'s `CACHE_VERSION` to v2, per the process documented
    in §10 and the README — the app shell genuinely changed, so
    returning visitors need the cache invalidated.
- **PWA: installable, works offline after first visit.** Hand-rolled
  (`public/sw.js`, plain JS, no `vite-plugin-pwa`/Workbox) specifically
  to avoid another heavy dependency tree after the `onnxruntime-node`
  saga. New: `manifest.json`, brand icons (192/512/maskable/apple-touch,
  generated with PIL, same eye-iris motif as the favicon/OG image),
  `registerServiceWorker.ts` (production-only, guarded against
  interfering with Vite's dev-mode HMR). Caching is deliberately narrow:
  same-origin app shell + the self-hosted MediaPipe model only — Whisper
  weights and the WASM CDN are explicitly left untouched since
  Transformers.js/onnxruntime-web already manage that caching themselves.
  See §10 for the full design, caching strategy, and honest limitations
  (manual cache-version bump on deploy, no update-available UI).
  Also fixed a real, previously-latent gap found while building this:
  `src/vite-env.d.ts` never existed (the project was hand-scaffolded
  rather than CLI-generated back in step 1), which only surfaced now
  because nothing had used `import.meta.env` until this feature needed
  the dev/prod flag.
- **Four quick wins: OG image, transcript download/copy, metric tooltips.**
  - `public/og-image.png` (1200×630) now exists — generated with PIL in
    the assisting environment, not a new project dependency. Font note:
    exact brand fonts (Space Grotesk/Inter) weren't available there, so
    headline text uses Poppins Bold as a similar substitute; the small
    accent line does use real IBM Plex Mono, an exact brand match. Worth
    a proper redesign later if it matters enough, but a real asset now
    beats the placeholder gap that was there before.
  - `downloadTextFile.ts` (generic small utility) + a "Download .txt" /
    "Copy" pair of buttons on the transcript section in `Results.tsx`.
    Copy uses the Clipboard API and fails silently on rejection (private
    browsing, permissions) rather than surfacing an alarming error for a
    minor feature.
  - `MetricCard.tsx` now has a small "i" toggle per card with a plain-
    language "why this matters" explanation, keyed by metric label in a
    `METRIC_INFO` map. Deliberately click-to-toggle, not hover — hover
    doesn't work on touch devices, and this needs to work equally well
    on mobile. No automatic link between this map and `scoreEngine.ts`'s
    label strings — if a label changes there, this map needs a manual
    update, or the tooltip silently stops showing for that metric.
- **Fixed: Brave CPU-spike / GPU-process crash-loop, this time in
  MediaPipe (not Whisper).** Same symptom class as the earlier
  Whisper/WebGPU crash-loop under Brave+Wayland (multiple
  `--type=gpu-process` processes pinned at ~100% CPU), different code
  path — MediaPipe's GPU delegate uses WebGL, not the WebGPU API that
  `whisperTranscriber.ts` already hardened. The comment claiming GPU
  delegate "falls back to CPU automatically" was never actually verified
  — same category of mistake as before. Fixed in three layers in
  `faceLandmarker.ts`:
  1. Probe actual WebGL availability before ever requesting GPU delegate
     (cheap, catches the clearest cases).
  2. Race GPU delegate creation against a 6-second timeout, since the
     failure mode observed isn't a clean rejection — it hangs/misbehaves
     at the OS process level, the same pattern that broke a plain
     try/catch for the WebGPU case too.
  3. try/catch as a backstop for creation attempts that DO reject
     cleanly.
  Deliberately did NOT use browser-name detection — Brave mimics
  Chrome's user-agent specifically to resist fingerprinting, so it's not
  a reliable signal, and feature detection protects against any browser
  with this class of issue, not just Brave specifically.
  While reviewing this before shipping, caught a related resource leak:
  if a timed-out GPU attempt resolves late in the background (slow, not
  fully hung), the abandoned `FaceLandmarker` instance is now explicitly
  closed instead of silently leaked.
  Honest limitation, same as elsewhere in this codebase: timing out stops
  OUR code from waiting, but can't force-cancel a GPU process Brave has
  already spawned at the OS level.
- **Fixed: old video showing on a second take.** Real bug, not caching —
  `CompositorContext`'s status got stuck at `"done"` after the first
  take and never reset, which silently blocked the second take's video
  from ever being composed at all while the old one's URL kept looking
  current. Added `resetCompositor()`, called at the start of any new
  recording in `Practice.tsx` (both entry points — "Record again" and
  the original "Start recording," since a fresh take is reachable either
  way). Also added a generation counter to correctly handle the case
  where a new take starts WHILE the previous one is still composing
  (deliberately possible — see §9) — the stale job's eventual result is
  discarded instead of overwriting the new session's state, and its
  blob URL is revoked rather than leaked. Honest remaining gap: the
  abandoned job isn't actually cancelled, just ignored — it keeps
  running until it naturally finishes. See §9 for full detail.
- **Hardware-independence pass: calibration timing, blink debounce,
  and compositor export rate.**
  - Real bug, confirmed by tracing the actual code: gaze calibration
    (`DISCARD_FRAMES`/`CALIB_FRAMES`) and blink debounce counted
    `requestAnimationFrame` ticks, not elapsed time. Since rAF tick rate
    tracks display refresh rate (not camera FPS specifically, a broader
    dependency than first suspected), real calibration duration varied
    across hardware — faster devices got LESS real settling/averaging
    time, backwards from what you'd want. Converted both to
    `performance.now()`-based elapsed time
    (`DISCARD_MS`/`CALIB_MS`/`BLINK_DEBOUNCE_MS`), guaranteeing identical
    real-world duration on any device. Total calibration window is now a
    clean 2000ms (600ms settle + 1400ms average), replacing whatever
    that summed to in real time before depending on hardware. See §3.
  - Caught and fixed a related latent bug while rewriting the
    calibration state machine: the baseline-finalization guard
    originally checked the closed-over `calibState` React state value,
    but `loop` is a stable closure created once per recording session —
    it never sees subsequent `setCalibState` updates. The guard would've
    always evaluated true, silently recomputing the same average every
    tick for the rest of the session. Same correct output, just
    wasteful — fixed with a ref instead, which reads fresh every tick.
  - Compositor (`composeFinalVideo.ts`) now reads the camera's actual
    negotiated frame rate (`track.getSettings().frameRate`, captured in
    `useMediaRecorder.ts`) and exports at that rate instead of a
    hardcoded 30 — a genuinely higher-FPS source camera no longer gets
    needlessly downsampled on export. Falls back to 30 if the browser
    doesn't report a rate.
- **Doc accuracy fix: §8's "no persistence" bullet was stale.** It still
  said "no `localStorage` yet" several iterations after
  `sessionHistory.ts` actually added one. Caught by re-reading the whole
  limitations section against what's actually built, rather than just
  trusting it was current — exactly the kind of drift a living doc needs
  periodic re-verification against, not just appending new entries
  forever.
- **Six items: mirror/gaze-direction fix, error boundary, 404 page,
  favicon + social meta tags, score count-up, reduced-motion support.**
  - **Real bug fixed**: live preview's CSS mirror (`scale-x-[-1]`, for a
    comfortable self-view) was inverting gaze left/right consistently,
    since MediaPipe reads the raw unmirrored camera frame underneath any
    CSS. Removed the live mirror instead of flipping the math — keeps
    live labels, the recording, and the export all consistently showing
    the audience's perspective, matching the Home page's own tagline.
    See §3 for the full reasoning.
  - `ErrorBoundary.tsx` — standard React class-component catch-all;
    previously an unexpected crash meant a blank white screen with no
    recovery path.
  - `NotFound.tsx` on a catch-all `*` route — a mistyped URL previously
    rendered nothing useful.
  - `favicon.svg` (a small stylized eye/iris mark, matching the wave-iris
    hero motif) plus OG/Twitter meta tags in `index.html`. Note: the
    referenced `/og-image.png` doesn't exist yet — see README.
  - `ScoreRing` now animates the number and ring fill together via a
    single rAF-driven value, respecting `prefers-reduced-motion`. Also
    fixed a latent bug in passing: the old CSS `transition` on
    `strokeDashoffset` never actually animated on mount, since React set
    the final value on the very first render with nothing prior to
    transition from.
  - `usePrefersReducedMotion.ts` — shared hook, also applied to Home's
    hero hover animation (skips the 24-bar staggered morph entirely when
    reduced motion is requested, rather than just speeding it up).
- **Three additive improvements: friendly permission errors, local
  session history, About page.**
  - `mediaErrors.ts` maps raw `getUserMedia()` `DOMException` names to
    actionable messages (e.g. "check your browser's site settings")
    instead of surfacing raw browser error text.
  - `sessionHistory.ts` stores a lightweight history (score + timestamp
    only, not the full transcript/gaze/video) in `localStorage`, shown
    as a "Your progress" section on Results once there's more than one
    session. Partially addresses the long-flagged "refresh loses
    everything" limitation — still not full persistence (no video, no
    metrics detail), but enough for a progress-over-time view. Fails
    silently on storage errors (private browsing, quota) rather than
    breaking the results page.
  - New `/about` route explains the on-device/privacy architecture in
    plain terms, with an FAQ. Navbar's "Home" text link was swapped for
    "About" rather than adding a third nav item, to avoid re-introducing
    the mobile overflow risk fixed during the responsive pass — the logo
    already serves as the home link.
  - Extracted `scoreColor.ts` as a shared score→color mapping so
    `ScoreRing` and the new progress bars can't visually drift apart.
- **Reverted the `onnxruntime-node` install-speed override; fixed a
  separate tsconfig deprecation.** The `npm:package@version` alias
  syntax in `overrides` needs npm 8.3+ — on an older npm it fails with
  `Invalid comparator`, since older npm tries to parse the whole string
  as a plain semver range instead of recognizing the alias protocol.
  Removed it rather than requiring an npm upgrade; the option to
  re-add it (with an npm-version caveat) is noted in the README for
  anyone on npm 8.3+ who wants the faster install. Separately, while
  re-testing, a fresh install pulled TypeScript 5.9.3, which now hard-
  errors on `baseUrl` as deprecated — removed `baseUrl` from
  `tsconfig.json` entirely rather than suppressing the warning, since
  `moduleResolution: "bundler"` resolves `paths` relative to the config
  file without needing it.
- **`npm install` sped up dramatically** — added an `overrides` entry in
  `package.json` remapping `onnxruntime-node` (a hard dependency of
  `@huggingface/transformers`, ~296MB unpacked, for server-side Node.js
  inference this app never does) to `onnxruntime-common` (~1MB, just
  shared types). Verified safe: `tsc --noEmit` and `vite build` produce
  byte-identical output before/after — nothing in the browser bundle ever
  actually reached `onnxruntime-node`, so trimming it only affects
  install time, not runtime behavior. `onnxruntime-web` (the one actually
  used) is untouched.
- **Fixed gaze zone misclassification (left/right confused with up/down).**
  Found by comparing against a reference gaze-tracking library's approach.
  `classifyZone` was comparing raw `dx`/`dy` magnitude to pick a
  direction, but those values are pre-scaled by very different upstream
  factors (`H_SCALE=1.8` vs `V_SCALE_UP/DOWN=5–7`) — so vertical noise
  could out-scale a genuine horizontal glance and get misclassified as
  UP/DOWN, or vice versa. Now compares excess-past-threshold on each axis
  instead, which is what a documented principle from the Python side
  already called for but the shipped code never implemented. Head-pose
  compensation is still missing from the browser version entirely — flagged
  as the next suspect if misclassification persists. See §3.
- **MediaPipe model now auto-downloads on `npm install`** — added a
  `postinstall` script (`scripts/download-mediapipe-model.js`) that
  fetches `face_landmarker.task` automatically, idempotently (skips if
  already present), and fails loudly with a clear error if the download
  is missing or suspiciously small. Fixes a real deployment gap: hosts
  like Vercel/Netlify/Cloudflare Pages can't run an interactive `curl`
  step, and the file was previously only ever fetched manually.
- **Failure isolation: video generation decoupled from the score.**
  Added `CompositorContext.tsx`, lifted above the router in `App.tsx`, so
  the slowest pipeline step (real-time video compositing) can no longer
  block or hide the score, which is ready much earlier. Practice now
  shows "View my results" as soon as scoring finishes; Results reads
  live compositor state and shows its own independent "generating…"
  placeholder, with an isolated error state that never affects the rest
  of the page. See §9.
- **Acoustic filled-pause detection added** (`filledPauseDetection.ts`) —
  Whisper was confirmed (by direct testing) to silently drop "um"/"uh"
  from its transcript. Since Transformers.js doesn't support
  `initial_prompt`/`prompt_ids` (unlike the Python backend), filler
  detection for these specific sounds now runs on raw audio energy
  instead of transcript text. See §4.
- **Results.tsx + full pipeline wiring** — replaced the raw debug
  checkpoint panels with a polished Results page (`ScoreRing`,
  `MetricCard`, rule-based `CoachFeedback`), auto-triggered video
  composition (no manual button), and a processing stepper on Practice.
- **Responsive pass** — fixed a real overflow bug (Home page's hero
  signature was a fixed 288px, wider than a 320px viewport's content
  area); tightened Navbar/CTA sizing across breakpoints.
- **Video compositor built** (`composeFinalVideo.ts`, `drawOverlays.ts`)
  — canvas-based re-recording with gaze badge + filler-highlighted
  captions, replacing the backend's ffmpeg pipeline entirely.
- **Scoring engine + filler/pause/vocab detection built** — see §5, §6.
- **Whisper transcription added**, then fixed twice: (1) WebGPU adapter
  detection moved up-front after a Brave-specific crash, (2) switched
  from word-level to interpolated segment-level timestamps after a
  cross-attention export error.
- **Live gaze tracking during recording added** (`useFaceTracking.ts`),
  ported from the Python backend's `video_analyzer.py` math.
- **Initial scaffold** — Vite + React + TypeScript + Tailwind, routing,
  Home page, `useMediaRecorder.ts`.
