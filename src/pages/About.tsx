import { Link } from "react-router-dom";

const STEPS = [
  { n: "01", title: "Record", desc: "Your browser captures webcam + mic — nothing leaves this device." },
  { n: "02", title: "Analyze on-device", desc: "MediaPipe + Whisper run right here, in your browser." },
  { n: "03", title: "See your score", desc: "Speech and eye-contact signals combined into one clear result." },
];

const FAQS = [
  {
    q: "Does my video or audio get uploaded anywhere?",
    a: "No. Face tracking, transcription, scoring, and even the annotated video export all run directly in your browser using WebAssembly and (where available) WebGPU. Nothing is sent to a server — there isn't one in this version of ORATO.",
  },
  {
    q: "How does ORATO know where I'm looking?",
    a: "A machine learning model (MediaPipe's FaceLandmarker) tracks your eyes in real time as you record. It's calibrated to your own camera angle at the start of each session — looking straight at the camera for a moment — then classifies whether you're looking at the camera or away from it.",
  },
  {
    q: "How does it know what I said?",
    a: "OpenAI's Whisper speech-recognition model runs locally via Transformers.js — the same technology used server-side elsewhere, just running entirely on your device instead. The first time you use it, your browser downloads the model (a one-time cost); after that it's cached and reused.",
  },
  {
    q: "Is my session saved anywhere?",
    a: "A small history of your past scores is kept in your browser's local storage, purely so you can see your progress over time. It never leaves your device, and you can clear it any time from the results page after a session.",
  },
  {
    q: "Why build it this way instead of with a normal backend?",
    a: "Partly a genuine privacy preference — a lot of speech-coaching tools ask you to upload video of yourself, which not everyone is comfortable with. Partly a technical exercise in seeing how far modern on-device AI (WASM + WebGPU) can go without a server at all.",
  },
];

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-center font-display text-3xl font-bold text-teal-dark">
        How ORATO works
      </h1>
      <p className="mt-3 text-center font-body text-teal-dark/70">
        A straightforward explanation of what actually happens when you record.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-teal/10 bg-white/50 p-5">
            <span className="font-mono text-xs text-orange">{s.n}</span>
            <h3 className="mt-2 font-display font-bold text-teal-dark">{s.title}</h3>
            <p className="mt-1 font-body text-sm text-teal-dark/70">{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 space-y-6">
        {FAQS.map((f) => (
          <div key={f.q} className="border-b border-teal/10 pb-6">
            <h3 className="font-display font-semibold text-teal-dark">{f.q}</h3>
            <p className="mt-2 font-body text-sm leading-relaxed text-teal-dark/70">{f.a}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 text-center">
        <Link
          to="/practice"
          className="inline-block rounded-full bg-orange px-8 py-3 font-body font-semibold text-paper hover:bg-orange/90"
        >
          Try it yourself
        </Link>
      </div>
    </div>
  );
}
