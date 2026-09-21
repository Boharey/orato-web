/**
 * download-mediapipe-model.js
 * -----------------------------
 * Runs automatically via the "postinstall" npm script — no manual curl
 * step needed on a fresh clone or in CI/deployment (Vercel, Netlify,
 * Cloudflare Pages all run `npm install` as part of their build, which
 * triggers this automatically before `vite build` runs).
 *
 * Idempotent: skips the download entirely if the file already exists
 * (e.g. committed directly, or a previous install already fetched it).
 * Exits with a non-zero status and a clear message if the download fails
 * or comes back suspiciously small — fail loud, not silent, matching the
 * rest of this app's design principles (see UNDERSTANDING.md §1). A build
 * that silently ships without this file would deploy with completely
 * broken face tracking and no obvious error until someone opens the app.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const DEST_DIR = join(__dirname, "..", "public", "models");
const DEST_PATH = join(DEST_DIR, "face_landmarker.task");

// Real file is ~3.7MB. A failed/redirected download (e.g. an HTML error
// page saved instead of the binary — see the "Unable to open zip
// archive" incident this is designed to prevent) would be far smaller.
const MIN_EXPECTED_BYTES = 3_000_000;

async function main() {
  if (existsSync(DEST_PATH)) {
    console.log(`[download-mediapipe-model] Already present at ${DEST_PATH} — skipping.`);
    return;
  }

  console.log("[download-mediapipe-model] Downloading face_landmarker.task...");
  mkdirSync(DEST_DIR, { recursive: true });

  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.byteLength < MIN_EXPECTED_BYTES) {
    throw new Error(
      `Downloaded file is only ${buffer.byteLength} bytes — expected ~3.7MB. ` +
        "The download likely failed or was redirected to an error page instead of the real model."
    );
  }

  writeFileSync(DEST_PATH, buffer);
  console.log(
    `[download-mediapipe-model] Saved ${(buffer.byteLength / 1_000_000).toFixed(2)}MB to ${DEST_PATH}`
  );
}

main().catch((err) => {
  console.error(`[download-mediapipe-model] FAILED: ${err.message}`);
  console.error(
    "[download-mediapipe-model] Face tracking will not work until this file exists at " +
      "public/models/face_landmarker.task. Try running this script again, or download manually:\n" +
      `  curl -L -o public/models/face_landmarker.task ${MODEL_URL}`
  );
  process.exit(1);
});
