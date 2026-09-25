import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { TranscriptionResult, WordTimestamp } from "@/types/metrics";

const MODEL_ID = "onnx-community/whisper-base";

export type ProgressCallback = (progress: { status: string; progress?: number }) => void;

let transcriberInstance: AutomaticSpeechRecognitionPipeline | null = null;
let loadingPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

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

function configureLocalModelFallback(): void {
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  env.allowRemoteModels = true;
}

async function loadPipeline(onProgress?: ProgressCallback) {
  configureLocalModelFallback();
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
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });

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