/**
 * scenarios.ts
 * -------------
 * Small hardcoded prompt list for Practice — turns an empty record
 * button into something that feels like actual coaching. Free practice
 * (no prompt) stays available as its own explicit choice, not just the
 * absence of one — see Practice.tsx's scenario-picker state.
 */

export interface Scenario {
  id: string;
  title: string;
  prompt: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "pitch",
    title: "30-second pitch",
    prompt: "Pitch a product or idea you care about in 30 seconds, as if talking to a potential investor.",
  },
  {
    id: "challenge",
    title: "Overcoming a challenge",
    prompt: "Tell a short story about a time you overcame a difficult challenge.",
  },
  {
    id: "self-intro",
    title: "Introduce yourself",
    prompt: "Introduce yourself as if meeting a new team on your first day at a job.",
  },
  {
    id: "explain-simply",
    title: "Explain something simply",
    prompt: "Explain a topic you know well to someone with no background in it at all.",
  },
];
