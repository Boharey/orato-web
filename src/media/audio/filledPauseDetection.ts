/**
 * filledPauseDetection.ts
 * ------------------------
 * Detects filled pauses ("um", "uh", "err") acoustically rather than from
 * Whisper's transcribed text. Whisper — in the browser and elsewhere —
 * tends to silently drop these sounds from its output rather than
 * transcribing them as words; the usual fix (Whisper's `initial_prompt`)
 * isn't available here since Transformers.js doesn't support prompt_ids
 * yet (huggingface/transformers.js#923, #1028 — both still open).
 *
 * Approach: a filled pause has real vocal energy (a sustained, voiced
 * hum), unlike genuine silence. We measure the person's OWN average
 * speech energy from the audio during words Whisper did transcribe, then
 * check every detected "pause" gap against that self-calibrated baseline
 * — same philosophy as the gaze calibration: measure the person's actual
 * signal rather than hardcoding an absolute volume threshold, which would
 * break across different mics, gain levels, and room noise.
 */

import type {
  WordTimestamp,
  PauseOccurrence,
  FillerOccurrence,
  PauseMetrics,
  FillerMetrics,
} from "@/types/metrics";
import { WHISPER_SAMPLE_RATE } from "@/media/audio/extractAudioBuffer";

// A pause whose RMS energy is at least this fraction of the person's own
// average speech energy is treated as a filled pause rather than silence.
// Tunable: lower this if real "um"s are being missed, raise it if genuine
// silence is getting flagged. Needs testing against real recordings —
// this is a starting point, not a derived constant.
const FILLED_PAUSE_ENERGY_RATIO = 0.15;

function rms(samples: Float32Array, startIdx: number, endIdx: number): number {
  const from = Math.max(0, startIdx);
  const to = Math.min(samples.length, endIdx);
  if (to <= from) return 0;
  let sumSquares = 0;
  for (let i = from; i < to; i++) {
    sumSquares += samples[i] * samples[i];
  }
  return Math.sqrt(sumSquares / (to - from));
}

function secToSampleIdx(sec: number): number {
  return Math.round(sec * WHISPER_SAMPLE_RATE);
}

export interface FilledPauseResult {
  filler: FillerMetrics;
  pause: PauseMetrics;
}

/**
 * Re-examines Whisper's detected "silent" pauses against actual audio
 * energy, reclassifying vocally-active ones as filled pauses (folded into
 * the filler count) and removing them from the silent-pause stats they
 * were originally counted under.
 */
export function detectFilledPauses(
  audioSamples: Float32Array,
  words: WordTimestamp[],
  existingFiller: FillerMetrics,
  existingPause: PauseMetrics,
  durationSec: number
): FilledPauseResult {
  if (words.length === 0 || existingPause.occurrences.length === 0) {
    return { filler: existingFiller, pause: existingPause };
  }

  // Self-calibrated baseline: average RMS energy during words Whisper
  // actually transcribed as speech.
  const speechLevels = words
    .map((w) => rms(audioSamples, secToSampleIdx(w.start), secToSampleIdx(w.end)))
    .filter((v) => v > 0);
  const speechLevel =
    speechLevels.length > 0 ? speechLevels.reduce((a, b) => a + b, 0) / speechLevels.length : 0;

  if (speechLevel === 0) {
    // No usable baseline (e.g. corrupted/silent audio) — don't guess.
    return { filler: existingFiller, pause: existingPause };
  }

  const threshold = speechLevel * FILLED_PAUSE_ENERGY_RATIO;

  const filledOccurrences: FillerOccurrence[] = [];
  const genuineSilentPauses: PauseOccurrence[] = [];

  for (const p of existingPause.occurrences) {
    const level = rms(audioSamples, secToSampleIdx(p.start), secToSampleIdx(p.end));
    if (level >= threshold) {
      filledOccurrences.push({ word: "(filled pause)", start: p.start, end: p.end });
    } else {
      genuineSilentPauses.push(p);
    }
  }

  const mergedOccurrences = [...existingFiller.occurrences, ...filledOccurrences].sort(
    (a, b) => a.start - b.start
  );
  const minutes = Math.max(durationSec / 60, 1e-6);

  const filler: FillerMetrics = {
    count: mergedOccurrences.length,
    occurrences: mergedOccurrences,
    fillersPerMinute: Math.round((mergedOccurrences.length / minutes) * 10) / 10,
  };

  const count = genuineSilentPauses.length;
  const avgPauseDurationSec =
    count > 0
      ? Math.round((genuineSilentPauses.reduce((s, p) => s + p.durationSec, 0) / count) * 100) /
        100
      : 0;
  const longestPauseSec =
    count > 0 ? Math.round(Math.max(...genuineSilentPauses.map((p) => p.durationSec)) * 100) / 100 : 0;

  const pause: PauseMetrics = {
    count,
    occurrences: genuineSilentPauses,
    avgPauseDurationSec,
    longestPauseSec,
  };

  return { filler, pause };
}
