import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaRecorder } from "@/media/recording/useMediaRecorder";
import { useFaceTracking } from "@/media/vision/useFaceTracking";
import { useWhisperTranscription } from "@/media/audio/useWhisperTranscription";
import { useModelPreload } from "@/media/useModelPreload";
import { useCompositorContext } from "@/context/CompositorContext";
import { detectFillers } from "@/media/audio/fillerDetection";
import { detectPauses } from "@/media/audio/pauseDetection";
import { detectFilledPauses } from "@/media/audio/filledPauseDetection";
import { computeVocabMetrics } from "@/media/audio/paceAndVocab";
import { summarizeGazeFrames } from "@/media/vision/gazeMath";
import { computeScore } from "@/media/scoring/scoreEngine";
import { checkBrowserSupport } from "@/lib/browserSupport";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import type { GazeZone, AudioMetrics, VideoMetrics, SessionResult } from "@/types/metrics";

// Displayed as a simple binary — ON_CAMERA reads as "Focus: On" (sage/
// green), every other direction reads as "Focus: Off" (orange/red).
// The underlying 5-zone data (LEFT/RIGHT/UP/DOWN/ON_CAMERA) is still
// collected and scored exactly as before — this only simplifies what's
// SHOWN, not what's measured.
function isFocusOn(zone: GazeZone): boolean {
  return zone === "ON_CAMERA";
}

type PipelineStepStatus = "pending" | "active" | "done";

export default function Practice() {
  const navigate = useNavigate();

  // Static per-session capability check — run once, doesn't change during
  // the session, so a lazy useState initializer is simpler than an effect.
  const [browserSupport] = useState(() => checkBrowserSupport());

  // undefined = picker not yet shown a choice; null = "free practice"
  // explicitly chosen; Scenario = a specific prompt chosen. Distinguishing
  // undefined from null (rather than just using null for "no selection
  // yet") is what lets "free practice" be a real choice instead of just
  // the absence of one.
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null | undefined>(undefined);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const preload = useModelPreload();

  const {
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
    recordAgain,
  } = useMediaRecorder();

  const {
    isLoading: modelLoading,
    loadError,
    currentZone,
    calibState,
    blinkCount,
    gazeFrames,
    startTracking,
    stopTracking,
  } = useFaceTracking();

  const {
    status: transcriptionStatus,
    modelDownloadPct,
    error: transcriptionError,
    result: transcription,
    audioSamples,
    transcribe,
  } = useWhisperTranscription();

  const {
    status: compositorStatus,
    progress: compositorProgress,
    error: compositorError,
    startComposing,
    resetCompositor,
  } = useCompositorContext();

  // Combined handler: recordAgain() resets the recorder/tracking hooks
  // (all per-component-instance state, resets naturally), but the
  // compositor context lives ABOVE this component and persists across
  // takes — without explicitly resetting it too, its status would stay
  // stuck at "done" (or "error") from the previous take, silently
  // blocking the new video from ever composing while the OLD one kept
  // showing as if current. See CompositorContext.tsx for the full story.
  const handleRecordAgain = () => {
    resetCompositor();
    recordAgain();
  };

  // Same reasoning applies to the FIRST "Start recording" click, not just
  // "Record again" — someone could navigate away (Home, About) and back
  // to Practice through normal nav, bypassing the recordAgain button
  // entirely, then hit this original button for what's still a genuinely
  // new take relative to whatever the compositor context is holding.
  // resetCompositor() is a safe no-op if it's already idle.
  //
  // This no longer starts recording immediately — it kicks off a 3-2-1
  // countdown instead (see the countdown effect below), which calls the
  // actual startRecording() once it reaches zero.
  const handleStartRecording = () => {
    resetCompositor();
    setCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      startRecording();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const playbackVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (status === "recording" && liveVideoRef.current) {
      startTracking(liveVideoRef.current);
    }
    if (status !== "recording") {
      stopTracking();
    }
    return () => stopTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Kick off transcription automatically once a recording is ready.
  useEffect(() => {
    if (status === "stopped" && recordedBlob) {
      transcribe(recordedBlob);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, recordedBlob]);

  // Score depends on the finished transcription + gaze data collected
  // during recording, plus the raw audio samples for acoustic filled-pause
  // detection (um/uh/err) — Whisper's text output silently drops these,
  // so they're recovered from the audio's energy signature instead. See
  // filledPauseDetection.ts for why.
  const scoreBreakdown = useMemo(() => {
    if (!transcription) return null;

    const textFiller = detectFillers(transcription.words, transcription.durationSec);
    const textPause = detectPauses(transcription.words);

    // Reclassify any "silent" pause that actually has vocal energy in it
    // as a filled pause instead — only possible once we have the raw
    // audio samples, which may arrive a beat after the transcript itself.
    const { filler, pause } = audioSamples
      ? detectFilledPauses(audioSamples, transcription.words, textFiller, textPause, transcription.durationSec)
      : { filler: textFiller, pause: textPause };

    const vocab = computeVocabMetrics(transcription.words, transcription.durationSec, pause);

    const audio: AudioMetrics = {
      transcription,
      filler,
      pause,
      vocab,
      wordsPerMinute: Math.round((transcription.words.length / (durationSec / 60)) * 10) / 10,
    };

    const { gazeOnScreenPct, zoneDistribution } = summarizeGazeFrames(gazeFrames);
    const video: VideoMetrics = {
      blinkCount,
      attentionScore: gazeOnScreenPct,
      gazeOnScreenPct,
      gazePerFrame: gazeFrames,
      zoneDistribution,
      headPoseSamples: [],
      calibration: { neutralHoriz: 0, neutralVert: 0, neutralYaw: 0, neutralPitch: 0, calibrated: true },
    };

    return { audio, video, score: computeScore(audio, video) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcription, audioSamples]);

  // Composition triggers automatically once transcription + scoring are
  // ready, via the shared context — NOT gated on the person staying on
  // this page. This is the actual fix for the slow-step problem: starting
  // it here just kicks it off; it runs independently of whether Practice
  // stays mounted.
  useEffect(() => {
    if (
      status === "stopped" &&
      transcriptionStatus === "done" &&
      scoreBreakdown &&
      recordedBlob &&
      compositorStatus === "idle"
    ) {
      startComposing(
        recordedBlob,
        {
          gazeFrames: scoreBreakdown.video.gazePerFrame,
          words: scoreBreakdown.audio.transcription.words,
          fillers: scoreBreakdown.audio.filler.occurrences,
        },
        videoFrameRate
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, transcriptionStatus, scoreBreakdown, recordedBlob, compositorStatus]);

  // IMPROVEMENT: navigating to Results no longer waits for the video.
  // annotatedVideoBlobUrl starts null here on purpose — Results reads the
  // LIVE compositor state from the same shared context this page just
  // started, and shows its own "generating…" placeholder until that
  // finishes, wherever the person happens to be looking by then.
  const goToResults = () => {
    if (!scoreBreakdown) return;
    const result: SessionResult = {
      scenarioId: selectedScenario?.id ?? null,
      recordedAt: new Date().toISOString(),
      durationSec,
      audio: scoreBreakdown.audio,
      video: scoreBreakdown.video,
      score: scoreBreakdown.score,
      annotatedVideoBlobUrl: null,
    };
    navigate("/results", { state: result });
  };

  // Derived processing steps for the stepper — video generation is
  // deliberately NOT one of these blocking steps anymore. It's shown as a
  // small non-blocking status line instead (see below), since a failed or
  // slow video should never prevent seeing an already-ready score.
  const steps: { label: string; status: PipelineStepStatus }[] = [
    {
      label: "Transcribing speech",
      status:
        transcriptionStatus === "done"
          ? "done"
          : transcriptionStatus === "idle"
            ? "pending"
            : "active",
    },
    {
      label: "Scoring session",
      status: scoreBreakdown ? "done" : transcriptionStatus === "done" ? "active" : "pending",
    },
  ];

  const scoreReady = status === "stopped" && transcriptionStatus === "done" && !!scoreBreakdown;
  const isProcessing = status === "stopped" && !scoreReady && transcriptionStatus !== "error";

  // Small shared render helper so both places "Record again" can appear
  // (the transcription-error state and the scoreReady state) show the
  // same confirm-before-discard UI instead of instantly wiping the
  // current take with no way back.
  const renderRecordAgainControl = (label: string) => {
    if (confirmingDiscard) {
      return (
        <div className="flex flex-col items-center gap-2">
          <p className="font-body text-sm text-teal-dark">
            Discard this take and start over? This can't be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setConfirmingDiscard(false);
                handleRecordAgain();
              }}
              className="rounded-full bg-orange px-5 py-2 font-body text-sm font-semibold text-paper hover:bg-orange/90"
            >
              Yes, discard it
            </button>
            <button
              onClick={() => setConfirmingDiscard(false)}
              className="rounded-full border border-teal/20 px-5 py-2 font-body text-sm font-semibold text-teal-dark hover:bg-teal/5"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        onClick={() => setConfirmingDiscard(true)}
        className={
          label === "Record again instead"
            ? "font-body text-sm text-teal-dark/60 underline hover:text-teal-dark"
            : "rounded-full border border-teal/20 px-6 py-3 font-body font-semibold text-teal-dark hover:bg-teal/5"
        }
      >
        {label}
      </button>
    );
  };

  // Unsupported browser — checked once on mount, before anything else in
  // this component tries to use camera/recording/WASM APIs that would
  // otherwise fail with a confusing error deep in the flow instead of a
  // clear message up front.
  if (!browserSupport.supported) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-teal-dark">
          Browser not fully supported
        </h1>
        <p className="mt-3 font-body text-sm text-teal-dark/60">
          ORATO needs a modern browser to work — it's missing:
        </p>
        <ul className="mt-2 font-mono text-xs text-teal-dark/50">
          {browserSupport.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="mt-4 font-body text-sm text-teal-dark/60">
          Try the latest version of Chrome, Firefox, Edge, or Brave.
        </p>
      </div>
    );
  }

  // Scenario picker — shown once, before the person even grants camera
  // access. "Free practice" is its own explicit choice (selectedScenario
  // set to null), not just skipping the picker — see the state comment
  // above for why that distinction matters.
  if (selectedScenario === undefined) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="font-display text-3xl font-bold text-teal-dark">What will you practice?</h1>
        <p className="mt-2 font-body text-sm text-teal-dark/60">
          Pick a prompt, or skip straight to free practice.
        </p>
        <div className="mt-8 grid gap-4 text-left sm:grid-cols-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedScenario(s)}
              className="rounded-2xl border border-teal/10 bg-white/50 p-5 text-left hover:border-orange/40 hover:bg-white/80"
            >
              <h3 className="font-display font-bold text-teal-dark">{s.title}</h3>
              <p className="mt-2 font-body text-sm text-teal-dark/60">{s.prompt}</p>
            </button>
          ))}
        </div>
        <button
          onClick={() => setSelectedScenario(null)}
          className="mt-8 font-body text-sm text-teal-dark/60 underline hover:text-teal-dark"
        >
          Skip — free practice instead
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-3xl font-bold text-teal-dark">Practice</h1>
      <p className="mt-2 font-body text-sm text-teal-dark/60">
        Record a short take — you'll get a scored breakdown and an annotated video when it's ready.
      </p>

      {selectedScenario && (
        <div className="mt-4 rounded-xl border border-orange/20 bg-orange/5 px-4 py-3 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-orange">
              {selectedScenario.title}
            </span>
            {(status === "idle" || status === "ready") && countdown === null && (
              <button
                onClick={() => setSelectedScenario(undefined)}
                className="font-mono text-[10px] text-teal-dark/40 underline hover:text-teal-dark/70"
              >
                Change prompt
              </button>
            )}
          </div>
          <p className="mt-1 font-body text-sm text-teal-dark">{selectedScenario.prompt}</p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-orange/10 px-4 py-2 font-body text-sm text-orange">
          {error}
        </p>
      )}
      {loadError && (
        <p className="mt-4 rounded-lg bg-orange/10 px-4 py-2 font-body text-sm text-orange">
          {loadError}
        </p>
      )}

      {!preload.allReady && !preload.error && status !== "recording" && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-sage/10 px-4 py-2 font-mono text-xs text-teal-dark/70">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sage" />
          Preparing on-device AI
          {preload.whisperDownloadPct !== null && !preload.whisperModelReady
            ? ` — ${preload.whisperDownloadPct}%`
            : "…"}
        </div>
      )}

      <div className="relative mt-8 overflow-hidden rounded-2xl border border-teal/10 bg-teal-dark">
        {status === "stopped" && recordedUrl ? (
          <video
            key="playback"
            ref={playbackVideoRef}
            src={recordedUrl}
            controls
            className="aspect-video w-full"
          />
        ) : (
          <video
            key="live"
            ref={liveVideoRef}
            autoPlay
            muted
            playsInline
            // NOT mirrored, deliberately — see note below. MediaPipe reads
            // the raw camera frame regardless of any CSS applied here, so
            // a mirrored preview would make left/right during recording
            // feel backwards relative to the (also unmirrored) gaze
            // labels and exported video.
            className="aspect-video w-full"
          />
        )}

        {countdown !== null && countdown > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-teal-dark/40">
            <span className="font-display text-8xl font-bold text-paper">{countdown}</span>
          </div>
        )}

        {(status === "ready" || status === "recording") && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 font-mono text-[10px] text-white/80">
            Shown unmirrored — this is how others actually see you
          </div>
        )}

        {status === "recording" && (
          <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-lg bg-black/60 px-3 py-2 font-mono text-xs text-white">
            {modelLoading && <span>loading model…</span>}
            {!modelLoading && calibState !== "tracking" && (
              <span>{calibState === "discarding" ? "settling…" : "calibrating…"}</span>
            )}
            {!modelLoading && calibState === "tracking" && currentZone && (
              <span className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${isFocusOn(currentZone) ? "bg-sage" : "bg-orange"}`}
                />
                Focus: {isFocusOn(currentZone) ? "On" : "Off"}
              </span>
            )}
            <span>blinks: {blinkCount}</span>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {status === "idle" && (
          <button
            onClick={requestPermissions}
            className="rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
          >
            Enable camera & mic
          </button>
        )}

        {status === "requesting" && (
          <p className="font-body text-sm text-teal-dark/60">Requesting permissions…</p>
        )}

        {status === "ready" && countdown === null && (
          <button
            onClick={handleStartRecording}
            className="rounded-full bg-teal px-6 py-3 font-body font-semibold text-paper hover:bg-teal-dark"
          >
            Start recording
          </button>
        )}

        {status === "ready" && countdown !== null && (
          <p className="font-body text-sm text-teal-dark/60">Get ready…</p>
        )}

        {status === "recording" && (
          <button
            onClick={stopRecording}
            className="rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
          >
            Stop recording
          </button>
        )}

        {status === "stopped" && (
          <span className="font-mono text-xs text-teal-dark/50">
            {durationSec.toFixed(1)}s · {blinkCount} blinks
          </span>
        )}

        {status === "error" && (
          <button
            onClick={requestPermissions}
            className="rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
          >
            Try again
          </button>
        )}
      </div>

      {/* Processing stepper — only the two steps that genuinely block
          seeing a result. Video generation used to be a third step here;
          it's now shown separately, below, as non-blocking. */}
      {isProcessing && (
        <div className="mt-8 rounded-2xl border border-teal/10 bg-white/40 p-6 text-left">
          <h2 className="mb-4 text-center font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
            Processing your session
          </h2>
          <ul className="space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 font-body text-sm">
                <span
                  className={
                    s.status === "done"
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-sage text-xs text-white"
                      : s.status === "active"
                        ? "h-5 w-5 animate-pulse rounded-full border-2 border-orange"
                        : "h-5 w-5 rounded-full border-2 border-teal/20"
                  }
                >
                  {s.status === "done" && "✓"}
                </span>
                <span className={s.status === "pending" ? "text-teal-dark/40" : "text-teal-dark"}>
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
          {transcriptionStatus === "loading_model" && (
            <p className="mt-4 font-mono text-xs text-teal-dark/40">
              {preload.whisperModelReady
                ? "Finishing up…"
                : `Downloading Whisper model${modelDownloadPct !== null ? ` — ${modelDownloadPct}%` : "…"}`}
            </p>
          )}
        </div>
      )}

      {transcriptionStatus === "error" && (
        <div className="mt-8">
          <p className="mb-3 font-body text-sm text-orange">{transcriptionError}</p>
          {renderRecordAgainControl("Record again")}
        </div>
      )}

      {/* Score is ready — hand off to Results immediately. Video keeps
          composing in the background via CompositorContext regardless of
          whether the person navigates away right now. */}
      {scoreReady && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={goToResults}
            className="rounded-full bg-orange px-8 py-3 font-body font-semibold text-paper hover:bg-orange/90"
          >
            View my results
          </button>
          {renderRecordAgainControl("Record again instead")}

          {/* Non-blocking status — informational only. A slow or failed
              video never hides or delays the button above it. */}
          {compositorStatus === "composing" && (
            <p className="font-mono text-xs text-teal-dark/40">
              Annotated video generating in the background — {compositorProgress}%. You can view
              your results now; the video will be ready on that page shortly.
            </p>
          )}
          {compositorStatus === "error" && (
            <p className="font-mono text-xs text-orange">
              Video generation failed ({compositorError}) — your score and transcript are
              unaffected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
