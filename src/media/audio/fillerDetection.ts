/**
 * fillerDetection.ts
 * -------------------
 * Scans transcribed words for filler words/phrases. Kept intentionally
 * conservative: words like "so", "well", "right" are excluded from the
 * default list even though they're sometimes used as fillers, because
 * they're far more often legitimate — flagging them produces false
 * positives that erode trust in the score faster than missing a real
 * filler does.
 */

import type { WordTimestamp, FillerMetrics, FillerOccurrence } from "@/types/metrics";

// Multi-word phrases are checked first (greedy match), then single words.
const FILLER_PHRASES: string[][] = [
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
];

const FILLER_WORDS = new Set([
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "erm",
  "like",
  "actually",
  "basically",
  "literally",
]);

function normalize(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:]/g, "");
}

export function detectFillers(words: WordTimestamp[], durationSec: number): FillerMetrics {
  const occurrences: FillerOccurrence[] = [];
  let i = 0;

  while (i < words.length) {
    let matchedPhrase: string[] | null = null;

    for (const phrase of FILLER_PHRASES) {
      if (i + phrase.length > words.length) continue;
      const slice = words.slice(i, i + phrase.length).map((w) => normalize(w.word));
      if (slice.join(" ") === phrase.join(" ")) {
        matchedPhrase = phrase;
        break;
      }
    }

    if (matchedPhrase) {
      occurrences.push({
        word: matchedPhrase.join(" "),
        start: words[i].start,
        end: words[i + matchedPhrase.length - 1].end,
      });
      i += matchedPhrase.length;
      continue;
    }

    const w = normalize(words[i].word);
    if (FILLER_WORDS.has(w)) {
      occurrences.push({ word: w, start: words[i].start, end: words[i].end });
    }
    i += 1;
  }

  const minutes = Math.max(durationSec / 60, 1e-6);
  return {
    count: occurrences.length,
    occurrences,
    fillersPerMinute: Math.round((occurrences.length / minutes) * 10) / 10,
  };
}
