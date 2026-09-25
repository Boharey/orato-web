import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const DEST_DIR = join(__dirname, "..", "public", "models");
const DEST_PATH = join(DEST_DIR, "face_landmarker.task");

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
    throw new Error(`Downloaded file is only ${buffer.byteLength} bytes — expected ~3.7MB.`);
  }

  writeFileSync(DEST_PATH, buffer);
  console.log(`[download-mediapipe-model] Saved ${(buffer.byteLength / 1_000_000).toFixed(2)}MB to ${DEST_PATH}`);
}

main().catch((err) => {
  console.error(`[download-mediapipe-model] FAILED: ${err.message}`);
  process.exit(1);
});