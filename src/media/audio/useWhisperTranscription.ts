/**
 * useWhisperTranscription.ts
 * ---------------------------
 * Orchestrates the two-step process: extract audio from a recorded Blob,
 * then run it through Whisper. Exposes granular status so the UI can show
 * "downloading model" vs "transcribing" separately — the first happens once
 * per session and can take a while on a cold cache.
 */

import { useCallback, useState } from "react";
import { blobToWhisperAudio } from "@/media/audio/extractAudioBuffer";
import { transcribeAudio } from "@/media/audio/whisperTranscriber";
import type { TranscriptionResult } from "@/types/metrics";

export type TranscriptionStatus =
  | "idle"
  | "loading_model"
  | "extracting_audio"
  | "transcribing"
  | "done"
  | "error";

interface UseWhisperTranscriptionResult {
  status: TranscriptionStatus;
  modelDownloadPct: number | null;
  error: string | null;
  result: TranscriptionResult | null;
  audioSamples: Float32Array | null;
  transcribe: (videoBlob: Blob) => Promise<TranscriptionResult | null>;
  reset: () => void;
}

export function useWhisperTranscription(): UseWhisperTranscriptionResult {
  const [status, setStatus] = useState<TranscriptionStatus>("idle");
  const [modelDownloadPct, setModelDownloadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [audioSamples, setAudioSamples] = useState<Float32Array | null>(null);

  const transcribe = useCallback(async (videoBlob: Blob) => {
    setError(null);
    setResult(null);
    setAudioSamples(null);

    try {
      setStatus("loading_model");
      setModelDownloadPct(0);

      // extractAudioBuffer runs independently of model loading, but we
      // kick off both immediately — extraction is fast (local decode), so
      // in practice this just overlaps a bit with the model fetch.
      // The extracted samples are also kept in state (not just passed to
      // Whisper) so filledPauseDetection.ts can reuse them afterward
      // without decoding the audio a second time.
      const audioPromise = blobToWhisperAudio(videoBlob).then((audio) => {
        setAudioSamples(audio);
        setStatus((prev) => (prev === "loading_model" ? "loading_model" : "extracting_audio"));
        return audio;
      });

      const transcription = await transcribeAudio(await audioPromise, (progress) => {
        if (progress.status === "progress" && typeof progress.progress === "number") {
          setModelDownloadPct(Math.round(progress.progress));
        }
        if (progress.status === "ready" || progress.status === "done") {
          setStatus("transcribing");
        }
      });

      setResult(transcription);
      setStatus("done");
      return transcription;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed.";
      setError(message);
      setStatus("error");
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setModelDownloadPct(null);
    setError(null);
    setResult(null);
    setAudioSamples(null);
  }, []);

  return { status, modelDownloadPct, error, result, audioSamples, transcribe, reset };
}
