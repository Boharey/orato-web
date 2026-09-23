/**
 * whisperTranscriber.ts
 * ----------------------
 * Loads Whisper via Transformers.js (ONNX Runtime Web) and runs inference
 * on pre-extracted audio samples. Model instance is cached module-wide —
 * same pattern as faceLandmarker.ts — so it only downloads/initializes once
 * per page load, not once per recording.
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { TranscriptionResult, WordTimestamp } from "@/types/metrics";

const MODEL_ID = "onnx-community/whisper-base";

export type ProgressCallback = (progress: { status: string; progress?: number }) => void;

let transcriberInstance: AutomaticSpeechRecognitionPipeline | null = null;
let loadingPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/**
 * Feature-detects WebGPU by actually requesting an adapter, rather than
 * just checking `navigator.gpu` exists. Some browsers (notably Brave, with
 * WebGPU disabled by default for fingerprinting reasons) expose the API
 * surface but fail on requestAdapter() — which is exactly the failure mode
 * that produces "Failed to get GPU adapter" deep inside ONNX Runtime Web.
 *
 * We check this UP FRONT rather than trying device:"webgpu" and catching a
 * failure, because that failure can surface as an unhandled promise
 * rejection from inside the ONNX runtime rather than a catchable error at
 * our call site — see huggingface/transformers.js issues #775, #1006,
 * #1123 for the same symptom across different setups.
 */
async function detectWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Redirects the small Whisper config/tokenizer files to same-origin
 * copies instead of letting Transformers.js fetch them cross-origin from
 * huggingface.co directly.
 *
 * WHY: confirmed via direct testing on the deployed site — HF's
 * `/resolve/main/*.json` endpoint redirects internally to
 * `/api/resolve-cache/...`, and that chain doesn't consistently carry an
 * Access-Control-Allow-Origin header for fetch()-initiated cross-origin
 * requests (direct browser navigation to the same URL works fine, since
 * navigation never enforces CORS — that's what made this confusing to
 * diagnose; it looked like the file didn't exist, but it did). This broke
 * transcription entirely in production despite working in local dev.
 *
 * Only these five small JSON files are redirected — NOT the actual model
 * weights. Those are served via a different HF storage path (LFS/blob
 * storage) that reliably sends CORS headers, and self-hosting weights
 * would undo the entire reason this project uses HF's CDN (keeping this
 * app's own hosting bandwidth small — see UNDERSTANDING.md §4). The
 * actual files live in public/models/whisper-base/, downloaded by
 * scripts/download-whisper-config.js on `npm install`.
 */
const SELF_HOSTED_CONFIG_FILES = [
  "tokenizer.json",
  "tokenizer_config.json",
  "config.json",
  "preprocessor_config.json",
  "generation_config.json",
];

function installConfigFetchOverride(): void {
  // Cast needed: this library version's TS types don't declare `env.fetch`,
  // even though it's read/used at runtime by the underlying fetch logic.
  const envAny = env as unknown as { fetch?: typeof fetch };
  const originalFetch = envAny.fetch ?? fetch;
  envAny.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const matched = SELF_HOSTED_CONFIG_FILES.find(
      (f) => url.includes("huggingface.co") && url.endsWith(f)
    );
    if (matched) {
      return originalFetch(`/models/whisper-base/${matched}`, init);
    }
    return originalFetch(input, init);
  };
}

async function loadPipeline(onProgress?: ProgressCallback) {
  installConfigFetchOverride();
  const hasWebGPU = await detectWebGPU();
  return pipeline("automatic-speech-recognition", MODEL_ID, {
    device: hasWebGPU ? "webgpu" : "wasm",
    progress_callback: onProgress,
  });
}

export async function getTranscriber(
  onProgress?: ProgressCallback
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriberInstance) return transcriberInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = loadPipeline(onProgress).then((p) => {
    transcriberInstance = p;
    return p;
  });

  return loadingPromise;
}

interface RawChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * True word-level timestamps ("word" mode) need the model's cross-attention
 * weights for DTW alignment — but the ONNX export used here doesn't expose
 * those outputs, which is what produces:
 *   "Model outputs must contain cross attentions to extract timestamps"
 * This isn't specific to this setup; it's a known gap across several
 * onnx-community Whisper exports in Transformers.js.
 *
 * Segment-level timestamps ("true" mode) are reliably supported everywhere,
 * so we use those and approximate per-word timing by distributing each
 * segment's duration across its words, weighted by word length. Whisper
 * segments are typically short (a handful of words), so this is a close
 * enough approximation for filler/pause detection — not perfectly accurate
 * to the millisecond, but not meaningfully worse for that purpose.
 */
function interpolateWordsFromSegment(text: string, start: number, end: number): WordTimestamp[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const duration = Math.max(end - start, 0.05);
  const totalChars = words.reduce((sum, w) => sum + w.length, 0) || words.length;

  let cursor = start;
  return words.map((word) => {
    const share = (word.length / totalChars) * duration;
    const wordStart = cursor;
    const wordEnd = cursor + share;
    cursor = wordEnd;
    return { word, start: wordStart, end: wordEnd };
  });
}

export async function transcribeAudio(
  audio: Float32Array,
  onProgress?: ProgressCallback
): Promise<TranscriptionResult> {
  const transcriber = await getTranscriber(onProgress);

  const output = await transcriber(audio, {
    return_timestamps: true, // segment-level — see interpolateWordsFromSegment for why
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  // Transformers.js can return either a single result or an array
  // depending on input shape — audio input always yields a single object.
  const result = Array.isArray(output) ? output[0] : output;
  const chunks = (result.chunks ?? []) as RawChunk[];

  const words: WordTimestamp[] = chunks
    .filter((c) => c.timestamp[1] !== null)
    .flatMap((c) => interpolateWordsFromSegment(c.text, c.timestamp[0], c.timestamp[1] as number));

  const durationSec = words.length > 0 ? words[words.length - 1].end : 0;

  return {
    text: (result.text ?? "").trim(),
    words,
    durationSec,
  };
}
