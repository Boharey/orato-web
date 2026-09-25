import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_ID = "onnx-community/whisper-base";
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const DEST_DIR = join(__dirname, "..", "public", "models", MODEL_ID);

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
        console.log(`[download-whisper-config] ${filename} not found — optional, skipping.`);
        return;
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    JSON.parse(text);
    writeFileSync(destPath, text);
    console.log(`[download-whisper-config] Saved ${filename} (${text.length} bytes).`);
  } catch (err) {
    if (!required) {
      console.log(`[download-whisper-config] Optional file ${filename} failed — continuing.`);
      return;
    }
    throw err;
  }
}

async function main() {
  mkdirSync(DEST_DIR, { recursive: true });
  for (const f of REQUIRED_FILES) await downloadFile(f, true);
  for (const f of OPTIONAL_FILES) await downloadFile(f, false);
}

main().catch((err) => {
  console.error(`[download-whisper-config] FAILED: ${err.message}`);
  process.exit(1);
});