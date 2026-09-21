import { Link } from "react-router-dom";
import { useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

const STEPS = [
  { n: "01", title: "Record", desc: "Speak to your camera and mic — a scenario prompt, or free practice." },
  { n: "02", title: "Analyze", desc: "On-device AI reads your speech and tracks your eye contact, live." },
  { n: "03", title: "Improve", desc: "Get a scored breakdown and a video showing exactly where to focus." },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col items-center px-6 py-16 text-center sm:py-24">
        <WaveIrisSignature />
        <h1 className="mt-10 max-w-2xl font-display text-3xl font-bold leading-tight text-teal-dark sm:text-4xl md:text-5xl">
          Practice speaking.
          <br />
          See what others see.
        </h1>
        <p className="mt-5 max-w-lg font-body text-base text-teal-dark/70 sm:text-lg">
          ORATO listens to how you speak and watches where you look — then shows you both,
          scored, in your browser. Nothing uploaded.
        </p>
        <Link
          to="/practice"
          className="mt-8 rounded-full bg-orange px-6 py-3 font-body text-sm font-semibold text-paper transition hover:bg-orange/90 sm:px-8 sm:text-base"
        >
          Start a practice session
        </Link>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-6 pb-16 sm:pb-24">
        <div className="grid gap-6 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-teal/10 bg-white/40 p-6">
              <span className="font-mono text-sm text-orange">{s.n}</span>
              <h3 className="mt-3 font-display text-lg font-bold text-teal-dark">{s.title}</h3>
              <p className="mt-2 font-body text-sm text-teal-dark/70">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** Signature element: waveform bars that resolve into a scanning ring on hover —
 * ORATO reads audio (waveform) and gaze (ring) at once. */
function WaveIrisSignature() {
  const [hovered, setHovered] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const bars = Array.from({ length: 24 }, (_, i) => i);
  const cx = 144;
  const cy = 56;
  const radius = 34;

  return (
    <div
      className="aspect-[288/112] w-full max-w-[288px] cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg viewBox="0 0 288 112" className="h-full w-full">
        {bars.map((i) => {
          const angle = (i / bars.length) * Math.PI * 2;
          const waveX = 12 + i * 11.5;
          const waveH = 14 + Math.abs(Math.sin(i * 0.7)) * 46;
          const ringX = cx + Math.cos(angle) * radius;
          const ringY = cy + Math.sin(angle) * radius;

          const x = hovered ? ringX - 2 : waveX;
          const y = hovered ? ringY - 6 : cy - waveH / 2;
          const h = hovered ? 12 : waveH;

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width="4"
              height={h}
              rx="2"
              // Respect prefers-reduced-motion: skip the staggered morph
              // transition entirely (instant state change) rather than
              // running a 24-bar cascading animation someone asked their
              // OS to avoid.
              className={prefersReducedMotion ? "fill-teal" : "fill-teal transition-all duration-500 ease-out"}
              style={{
                transitionDelay: prefersReducedMotion ? undefined : `${i * 12}ms`,
                fill: hovered ? "#FF6B35" : "#2E4F4F",
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}
