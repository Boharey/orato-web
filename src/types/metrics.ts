/**
 * types/metrics.ts
 * -----------------
 * Single source of truth for the shape of data flowing through the ORATO
 * pipeline: recording -> analysis -> scoring -> results UI.
 *
 * Every module in src/media/ should import from here rather than declaring
 * its own local shapes. If a module needs a field that isn't here yet,
 * add it here first.
 */

// ── Transcription ─────────────────────────────────────────────────────────

export interface WordTimestamp {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface TranscriptionResult {
  text: string;
  words: WordTimestamp[];
  durationSec: number;
}

// ── Audio metrics ────────────────────────────────────────────────────────

export interface FillerOccurrence {
  word: string;       // e.g. "um", "like", "you know"
  start: number;
  end: number;
}

export interface FillerMetrics {
  count: number;
  occurrences: FillerOccurrence[];
  fillersPerMinute: number;
}

export interface PauseOccurrence {
  start: number;
  end: number;
  durationSec: number;
}

export interface PauseMetrics {
  count: number;
  occurrences: PauseOccurrence[];
  avgPauseDurationSec: number;
  longestPauseSec: number;
}

export interface VocabMetrics {
  mattr: number;              // moving-average type-token ratio, 0..1
  articulationRate: number;   // syllables/words per second, excluding pauses
  speechRatio: number;        // speaking time / total duration, 0..1
  repeatedPhrases: string[];  // phrases repeated 2+ times
}

export interface AudioMetrics {
  transcription: TranscriptionResult;
  filler: FillerMetrics;
  pause: PauseMetrics;
  vocab: VocabMetrics;
  wordsPerMinute: number;
}

// ── Video metrics ────────────────────────────────────────────────────────

export type GazeZone = "ON_CAMERA" | "LEFT" | "RIGHT" | "UP" | "DOWN";

export interface GazeFrame {
  frame: number;
  time: number; // seconds
  zone: GazeZone;
}

export interface HeadPoseSample {
  time: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface CalibrationBaseline {
  neutralHoriz: number;
  neutralVert: number;
  neutralYaw: number;
  neutralPitch: number;
  calibrated: boolean;
}

export interface VideoMetrics {
  blinkCount: number;
  attentionScore: number;       // 0..100
  gazeOnScreenPct: number;      // 0..100
  gazePerFrame: GazeFrame[];
  zoneDistribution: Record<GazeZone, number>; // percentages, sum ~100
  headPoseSamples: HeadPoseSample[];
  calibration: CalibrationBaseline;
}

// ── Scoring ──────────────────────────────────────────────────────────────

export type MetricGrade = "excellent" | "good" | "fair" | "needs_work";

export interface ScoredMetric {
  label: string;
  value: number;
  grade: MetricGrade;
  unit?: string; // e.g. "%", "wpm", "s"
}

export interface ScoreBreakdown {
  audioScore: number;         // 0..100, the foundation score
  eyeContactMultiplier: number; // 0.50..1.00, trust multiplier
  combinedScore: number;      // 0..100, audioScore * eyeContactMultiplier
  metrics: ScoredMetric[];
}

// ── Session result (what Practice.tsx produces, Results.tsx consumes) ────

export interface SessionResult {
  scenarioId: string | null;
  recordedAt: string; // ISO timestamp
  durationSec: number;
  audio: AudioMetrics;
  video: VideoMetrics;
  score: ScoreBreakdown;
  annotatedVideoBlobUrl: string | null; // set after compositor runs
}
