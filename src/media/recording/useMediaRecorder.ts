/**
 * useMediaRecorder.ts
 * -------------------
 * Handles webcam+mic permission, live preview stream, and recording via the
 * browser's native MediaRecorder API. Produces a Blob + object URL once
 * recording stops — no analysis happens here, this hook only owns capture.
 *
 * Downstream (later steps) will read the Blob to extract audio for Whisper
 * and will have already run FaceLandmarker live against the same stream
 * during recording.
 */

import { useCallback, useRef, useState } from "react";
import { friendlyMediaError } from "@/lib/mediaErrors";

export type RecorderStatus = "idle" | "requesting" | "ready" | "recording" | "stopped" | "error";

interface UseMediaRecorderResult {
  status: RecorderStatus;
  error: string | null;
  stream: MediaStream | null;
  recordedBlob: Blob | null;
  recordedUrl: string | null;
  durationSec: number;
  videoFrameRate: number | null;
  requestPermissions: () => Promise<void>;
  startRecording: () => void;
  stopRecording: () => void;
  reset: () => void;
  recordAgain: () => Promise<void>;
}

const PREFERRED_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  // Safari fallback — WebM video *encoding* support (as opposed to
  // playback) is inconsistent before Safari 18.4 (March 2025), and even
  // that version's WebM support is primarily audio-focused per current
  // documentation. Without this, recording would silently fail or
  // produce an unusable file on a meaningful share of real iOS/macOS
  // Safari visitors — checked via MediaRecorder.isTypeSupported() same
  // as every other entry here, so this only activates where WebM
  // genuinely isn't available.
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

function pickSupportedMimeType(): string {
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm"; // last-resort fallback, browser default
}

export function useMediaRecorder(): UseMediaRecorderResult {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [videoFrameRate, setVideoFrameRate] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const requestPermissions = useCallback(async () => {
    setStatus("requesting");
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setStream(mediaStream);

      // Read the ACTUAL negotiated capture rate rather than assuming one —
      // this is what makes the compositor's export match the real source
      // instead of a hardcoded guess. getSettings().frameRate isn't
      // guaranteed by every browser/device, hence the fallback.
      const videoTrack = mediaStream.getVideoTracks()[0];
      const negotiatedFps = videoTrack?.getSettings().frameRate;
      setVideoFrameRate(negotiatedFps && negotiatedFps > 0 ? Math.round(negotiatedFps) : null);

      setStatus("ready");
    } catch (err) {
      setError(friendlyMediaError(err));
      setStatus("error");
    }
  }, []);

  const startRecording = useCallback(() => {
    if (!stream) {
      setError("No active camera/mic stream. Call requestPermissions() first.");
      setStatus("error");
      return;
    }

    chunksRef.current = [];
    setRecordedBlob(null);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);

    const mimeType = pickSupportedMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setRecordedUrl(url);
      setDurationSec((Date.now() - startTimeRef.current) / 1000);
      setStatus("stopped");

      // Release the camera/mic hardware now that we have the recording —
      // without this, the browser's recording indicator stays lit and the
      // live stream keeps running in the background indefinitely.
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    };

    recorder.onerror = () => {
      setError("Recording failed unexpectedly.");
      setStatus("error");
    };

    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    recorder.start(250); // collect data every 250ms — keeps memory bounded on long recordings
    setStatus("recording");
  }, [stream, recordedUrl]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setDurationSec(0);
    setError(null);
    setStatus(stream ? "ready" : "idle");
  }, [recordedUrl, stream]);

  // Since onstop releases the camera/mic (see above), going again means
  // re-requesting a fresh stream rather than reusing the stopped one.
  const recordAgain = useCallback(async () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setDurationSec(0);
    setError(null);
    await requestPermissions();
  }, [recordedUrl, requestPermissions]);

  return {
    status,
    error,
    stream,
    recordedBlob,
    recordedUrl,
    durationSec,
    videoFrameRate,
    requestPermissions,
    startRecording,
    stopRecording,
    reset,
    recordAgain,
  };
}
