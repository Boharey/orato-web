/**
 * download-whisper-config.js
 * ----------------------------
 * Downloads the small Whisper tokenizer/config JSON files and serves them
 * same-origin instead of letting Transformers.js fetch them cross-origin
 * from huggingface.co directly.
 *
 * WHY THIS EXISTS: confirmed via direct testing on the deployed site —
 * huggingface.co's `/resolve/main/*.json` endpoint redirects internally
 * to `/api/resolve-cache/...`, and that redirect chain does not
 * consistently carry an Access-Control-Allow-Origin header for
 * fetch()-initiated cross-origin requests (direct browser navigation to
 * the same URL works fine, since navigation never enforces CORS at all —
 * that's what made this confusing to diagnose). This broke Whisper
 * entirely in production despite working in local dev.
 *
 * Only the tiny config/tokenizer files are self-hosted here — NOT the
 * actual model weights (tens to hundreds of MB). Those are served via a
 * different HF storage path (LFS/blob storage) that reliably sends CORS
 * headers, and self-hosting them would undo the whole reason this
 * project uses HF's CDN in the first place (keeping this app's own
 * hosting bandwidth small — see UNDERSTANDING.md §4).
 *
 * Idempotent and resilient: skips files already present, and a missing
 * *optional* file (generation_config.json — not confirmed required by
 * this exact model/quantization, added defensively) doesn't fail the
 * build. The four files confirmed required by the actual console error
 * DO fail the build loudly if they can't be fetched, matching this
 * project's established fail-loud-not-silent principle.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_ID = "onnx-community/whisper-base";
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const DEST_DIR = join(__dirname, "..", "public", "models", "whisper-base");

const REQUIRED_FILES = ["tokenizer.json", "tokenizer_config.json", "config.json", "preprocessor_config.json"];
const OPTIONAL_FILES = ["generation_config.json"];

async function downloadFile(filename, required) {
  const destPath = join(DEST_DIR, filename);
  if (existsSync(destPath)) {
    console.log(`[download-whisper-config] ${filename} already present — skipping.`);
    return;
  }

  const url = `${BASE_URL}/${filename}`;
  console.log(`[download-whisper-config] Downloading ${filename}...`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (!required) {
        console.log(`[download-whisper-config] ${filename} not found (HTTP ${res.status}) — optional, skipping.`);
        return;
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    // Sanity check: should be parseable JSON, not an HTML error page —
    // same class of check as the MediaPipe model download script.
    JSON.parse(text);
    writeFileSync(destPath, text);
    console.log(`[download-whisper-config] Saved ${filename} (${text.length} bytes).`);
  } catch (err) {
    if (!required) {
      console.log(`[download-whisper-config] Optional file ${filename} failed (${err.message}) — continuing.`);
      return;
    }
    throw err;
  }
}

async function main() {
  mkdirSync(DEST_DIR, { recursive: true });
  for (const f of REQUIRED_FILES) {
    await downloadFile(f, true);
  }
  for (const f of OPTIONAL_FILES) {
    await downloadFile(f, false);
  }
}

main().catch((err) => {
  console.error(`[download-whisper-config] FAILED: ${err.message}`);
  console.error(
    "[download-whisper-config] Whisper transcription will fail in production without these files " +
      "(huggingface.co's config-file redirect doesn't reliably send CORS headers for cross-origin fetch)."
  );
  process.exit(1);
});