/**
 * paceAndVocab.ts
 * ----------------
 * Lexical diversity (MATTR), speaking pace excluding pauses, speech ratio,
 * and repeated-phrase detection.
 */

import type { WordTimestamp, VocabMetrics, PauseMetrics } from "@/types/metrics";

const MATTR_WINDOW = 25;

/**
 * Moving-Average Type-Token Ratio — lexical diversity that stays stable
 * regardless of speech length, unlike a plain type/token ratio which
 * trends downward the longer someone talks (more words = more chance of
 * repeats), even if their actual vocabulary use isn't getting less varied.
 */
export function computeMATTR(words: WordTimestamp[]): number {
  const tokens = words.map((w) => w.word.toLowerCase().replace(/[.,!?;:]/g, ""));
  if (tokens.length === 0) return 0;

  if (tokens.length < MATTR_WINDOW) {
    const unique = new Set(tokens).size;
    return Math.round((unique / tokens.length) * 1000) / 1000;
  }

  let sum = 0;
  let windows = 0;
  for (let i = 0; i + MATTR_WINDOW <= tokens.length; i++) {
    const window = tokens.slice(i, i + MATTR_WINDOW);
    sum += new Set(window).size / MATTR_WINDOW;
    windows += 1;
  }
  return Math.round((sum / windows) * 1000) / 1000;
}

/** Finds 3-word phrases repeated 2+ times — a sign of verbal crutches. */
export function computeRepeatedPhrases(words: WordTimestamp[], n = 3): string[] {
  const tokens = words.map((w) => w.word.toLowerCase().replace(/[.,!?;:]/g, ""));
  const counts = new Map<string, number>();

  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  return [...counts.entries()].filter(([, count]) => count >= 2).map(([gram]) => gram);
}

export function computeVocabMetrics(
  words: WordTimestamp[],
  durationSec: number,
  pause: PauseMetrics
): VocabMetrics {
  const totalPauseSec = pause.occurrences.reduce((s, p) => s + p.durationSec, 0);
  const speakingSec = Math.max(durationSec - totalPauseSec, 1e-6);

  return {
    mattr: computeMATTR(words),
    articulationRate: Math.round((words.length / (speakingSec / 60)) * 10) / 10, // wpm excluding pauses
    speechRatio: Math.round((speakingSec / Math.max(durationSec, 1e-6)) * 1000) / 1000,
    repeatedPhrases: computeRepeatedPhrases(words),
  };
}
