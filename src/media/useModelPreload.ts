/**
 * useModelPreload.ts
 * -------------------
 * Kicks off both model downloads (MediaPipe face landmarker + Whisper) as
 * soon as this hook mounts, rather than waiting for the user to start
 * recording or stop recording respectively. Both underlying loaders
 * (getFaceLandmarker, getTranscriber) cache their in-flight promise, so
 * calling them early is safe — later calls from useFaceTracking /
 * useWhisperTranscription just await the same download, they don't
 * trigger a second one.
 */

import { useEffect, useState } from "react";
import { getFaceLandmarker } from "@/media/vision/faceLandmarker";
import { getTranscriber } from "@/media/audio/whisperTranscriber";

interface ModelPreloadState {
  faceModelReady: boolean;
  whisperModelReady: boolean;
  whisperDownloadPct: number | null;
  allReady: boolean;
  error: string | null;
}

export function useModelPreload(): ModelPreloadState {
  const [faceModelReady, setFaceModelReady] = useState(false);
  const [whisperModelReady, setWhisperModelReady] = useState(false);
  const [whisperDownloadPct, setWhisperDownloadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getFaceLandmarker()
      .then(() => {
        if (!cancelled) setFaceModelReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load face model.");
        }
      });

    getTranscriber((progress) => {
      if (cancelled) return;
      if (progress.status === "progress" && typeof progress.progress === "number") {
        setWhisperDownloadPct(Math.round(progress.progress));
      }
    })
      .then(() => {
        if (!cancelled) {
          setWhisperModelReady(true);
          setWhisperDownloadPct(100);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Whisper model.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    faceModelReady,
    whisperModelReady,
    whisperDownloadPct,
    allReady: faceModelReady && whisperModelReady,
    error,
  };
}
