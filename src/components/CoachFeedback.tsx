import type { CoachFeedbackItem } from "@/lib/coachFeedback";

export default function CoachFeedback({ items }: { items: CoachFeedbackItem[] }) {
  return (
    <div className="rounded-2xl border border-teal/10 bg-white/50 p-6">
      <h2 className="font-display text-sm font-bold uppercase tracking-wide text-teal-dark/70">
        Coach feedback
      </h2>
      <ul className="mt-4 space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 font-body text-sm text-teal-dark">
            <span className={item.type === "praise" ? "text-sage" : "text-orange"}>
              {item.type === "praise" ? "✓" : "→"}
            </span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-[10px] text-teal-dark/30">
        Rule-based feedback from your measured metrics — not AI-generated commentary.
      </p>
    </div>
  );
}
