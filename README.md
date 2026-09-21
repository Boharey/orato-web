# ORATO — web

Browser-only speech & eye-contact coaching. No backend, no upload — MediaPipe
(WASM) and Whisper (ONNX Runtime Web) run entirely on-device.

**→ See [UNDERSTANDING.md](./UNDERSTANDING.md) for how the engine actually
works** — gaze calibration, filler-word detection (including why filled
pauses need acoustic detection, not just text matching), the scoring
formula, and every tunable constant in one place. This README is setup
instructions; that file is the "why" behind the code.

## Social preview image

`public/og-image.png` (1200×630) powers link previews on Twitter, LinkedIn,
Slack, etc. Font note: exact brand fonts (Space Grotesk/Inter) weren't
available in the environment that generated it, so headline text uses
Poppins Bold (a similar geometric sans) instead — close enough for a link
preview thumbnail, but if you ever redesign this asset, match the real
brand fonts. IBM Plex Mono, used for the small accent line, is the actual
brand font and needed no substitution.

## Setup

```bash
npm install
npm run dev
```

That's it — `npm install` automatically downloads the MediaPipe face model
too (see below), no separate manual step needed.

## Optional: speed up `npm install` (requires npm 8.3+)

`@huggingface/transformers` pulls in `onnxruntime-node` (~296MB) even
though this app only ever uses the browser build (`onnxruntime-web`) —
it's a hard dependency of that package, not something this app actually
needs. If you're on **npm 8.3 or newer** (`npm --version` to check), you
can trim it by adding this to `package.json`:

```json
"overrides": {
  "onnxruntime-node": "npm:onnxruntime-common@1.24.3"
}
```

Then `rm -rf node_modules package-lock.json && npm install` — cuts a
large chunk off install time. Verified safe: production build output is
byte-identical with or without this, since nothing in the browser bundle
ever reaches `onnxruntime-node` in the first place.

**On an older npm**, this syntax fails with `Invalid comparator` — older
npm doesn't understand the `npm:package@version` alias format and tries
to parse it as a literal semver range. Either upgrade npm
(`npm install -g npm@latest`) or just skip this — it's a speed
optimization, not something the app depends on.

## The MediaPipe face model downloads automatically

Face tracking needs `face_landmarker.task` in `public/models/`. It's
gitignored on purpose (~3.7MB binary, shouldn't live in git history), but
`npm install` triggers a `postinstall` script
(`scripts/download-mediapipe-model.js`) that fetches it automatically —
**on your machine, in CI, and on any host that runs `npm install` as part
of its build** (Vercel, Netlify, Cloudflare Pages all do this by default).

The script is idempotent: if the file's already there, it skips the
download instead of re-fetching. If the download fails or comes back
suspiciously small (e.g. an HTML error page saved instead of the real
binary — this happened once during setup, see `UNDERSTANDING.md`), the
script exits with a non-zero status and a clear error, failing the build
loudly instead of silently shipping broken face tracking.

If you ever need to do it manually (e.g. the script's blocked by a
network policy):

```bash
mkdir -p public/models
curl -L -o public/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

Without this file, the Practice page will show a clear error when it tries
to start tracking rather than failing silently.

## Whisper model — first-run download

`onnx-community/whisper-base` (~150MB) downloads automatically on first
transcription and is cached by the browser afterward — no manual step
needed, unlike the MediaPipe model. Expect the first test recording to pause
on "Downloading Whisper model" for a while depending on connection speed.

## PWA — installable, works offline after first visit

Hand-rolled service worker (`public/sw.js`, plain JS — no
`vite-plugin-pwa`/Workbox, to avoid another heavy dependency tree). Only
active in production builds; `npm run dev` is unaffected.

**To verify it's working** (needs a real browser — this can't be tested
from an automated build):

```bash
npm run build
npm run preview
```

Then in Chrome/Edge DevTools:
1. **Application → Manifest** — should show ORATO's name, icons, and
   theme color with no errors.
2. **Application → Service Workers** — should show `sw.js` as activated.
3. **Network → check "Offline"**, then reload — the app shell should
   still load (a fresh Practice session will still need Whisper/MediaPipe
   models downloaded at least once while online first).
4. A dismissible banner ("Install ORATO for quick access and offline
   practice") should appear near the top of the page — clicking its
   Install button should trigger the same install flow as the browser's
   own address-bar icon. Firefox and Safari won't show this at all (they
   don't support `beforeinstallprompt`), which is expected, not a bug.

**On every deploy**, bump `CACHE_VERSION` in `public/sw.js` — there's no
automated cache-busting without the build-tooling this project
deliberately avoided (see `UNDERSTANDING.md` §10). Skipping this means
returning visitors could keep seeing a stale cached app shell.

## If Vite complains about `@huggingface/transformers` on build

Some versions need `onnxruntime-web`'s WASM files excluded from
dependency pre-bundling. If `npm run dev` errors on this package, add to
`vite.config.ts`:

```ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
```

## Status

Full pipeline complete: recording → live gaze tracking → Whisper
transcription → filler/pause/vocab detection → scoring → canvas-based
video compositor (with failure isolation from the score, see
`UNDERSTANDING.md` §9) → Results page → local session history → PWA
install/offline support. See `UNDERSTANDING.md`'s changelog for the full,
accurate build history — this section previously listed "Step 5, not yet
added: scoring/compositor/Results" long after all of those were actually
built; if you're reading this and it looks stale again, check the
changelog there instead of trusting this paragraph.

**Note on gaze math convention:** `src/media/vision/gazeMath.ts` uses the
Python backend's `video_analyzer.py` inner/outer landmark convention
(`LEFT_INNER=133, LEFT_OUTER=33`). A separate real bug in the zone
classifier (comparing differently-scaled axes as if they were equal) was
found and fixed — see `UNDERSTANDING.md` §3 — but this specific
inner/outer convention question is still open.
