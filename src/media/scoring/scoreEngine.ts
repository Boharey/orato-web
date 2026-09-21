/**
 * scoreEngine.ts
 * ---------------
 * Combines audio metrics (filler rate, vocab richness, pace, speech ratio)
 * into a 0-100 audio score, then applies eye contact as a 0.50-1.00 TRUST
 * MULTIPLIER — not averaged in — so strong eye contact can't mask genuinely
 * poor speech, and poor eye contact never fully zeroes out a good delivery.
 * This mirrors the backend's established scoring model.
 */

import type {
  AudioMetrics,
  VideoMetrics,
  ScoreBreakdown,
  ScoredMetric,
  MetricGrade,
} from "@/types/metrics";

function grade(value: number, thresholds: [number, number, number]): MetricGrade {
  // thresholds = [excellent_min, good_min, fair_min] — higher value is better.
  if (value >= thresholds[0]) return "excellent";
  if (value >= thresholds[1]) return "good";
  if (value >= thresholds[2]) return "fair";
  return "needs_work";
}

function gradeInverse(value: number, thresholds: [number, number, number]): MetricGrade {
  // thresholds = [excellent_max, good_max, fair_max] — lower value is better.
  if (value <= thresholds[0]) return "excellent";
  if (value <= thresholds[1]) return "good";
  if (value <= thresholds[2]) return "fair";
  return "needs_work";
}

/**
 * All thresholds/weights below are initial heuristics, not derived from
 * real user data yet — flag clearly since they'll likely need tuning once
 * you have actual practice sessions to calibrate against.
 */
export function computeAudioScore(audio: AudioMetrics): { score: number; metrics: ScoredMetric[] } {
  const fillerScore = Math.max(0, 100 - audio.filler.fillersPerMinute * 12);
  const vocabScore = Math.min(100, (audio.vocab.mattr / 0.75) * 100);

  const idealRateWpm = 145;
  const rateDeviation = Math.abs(audio.vocab.articulationRate - idealRateWpm);
  const paceScore = Math.max(0, 100 - rateDeviation * 0.8);

  const ratioScore = Math.min(100, audio.vocab.speechRatio * 115);

  const score = Math.round(
    fillerScore * 0.35 + vocabScore * 0.25 + paceScore * 0.25 + ratioScore * 0.15
  );

  const metrics: ScoredMetric[] = [
    {
      label: "Filler words",
      value: audio.filler.fillersPerMinute,
      unit: "/min",
      grade: gradeInverse(audio.filler.fillersPerMinute, [1, 3, 5]),
    },
    {
      label: "Vocabulary richness",
      value: Math.round(audio.vocab.mattr * 100),
      unit: "%",
      grade: grade(audio.vocab.mattr * 100, [70, 55, 40]),
    },
    {
      label: "Speaking pace",
      value: audio.vocab.articulationRate,
      unit: "wpm",
      grade: grade(100 - rateDeviation, [85, 70, 50]),
    },
    {
      label: "Speech ratio",
      value: Math.round(audio.vocab.speechRatio * 100),
      unit: "%",
      grade: grade(audio.vocab.speechRatio * 100, [80, 65, 50]),
    },
  ];

  return { score: Math.max(0, Math.min(100, score)), metrics };
}

/** Linear map: 0% on-screen -> 0.50, 100% on-screen -> 1.00. Clamped so a
 * bad session never zeroes the score entirely — this is a trust modifier,
 * not a gate. */
export function computeEyeContactMultiplier(video: VideoMetrics): number {
  const pct = Math.max(0, Math.min(100, video.gazeOnScreenPct));
  return Math.round((0.5 + (pct / 100) * 0.5) * 100) / 100;
}

export function computeScore(audio: AudioMetrics, video: VideoMetrics): ScoreBreakdown {
  const { score: audioScore, metrics: audioMetrics } = computeAudioScore(audio);
  const eyeContactMultiplier = computeEyeContactMultiplier(video);
  const combinedScore = Math.round(audioScore * eyeContactMultiplier);

  const eyeContactMetric: ScoredMetric = {
    label: "Eye contact",
    value: Math.round(video.gazeOnScreenPct),
    unit: "%",
    grade: grade(video.gazeOnScreenPct, [80, 60, 40]),
  };

  return {
    audioScore,
    eyeContactMultiplier,
    combinedScore,
    metrics: [...audioMetrics, eyeContactMetric],
  };
}
