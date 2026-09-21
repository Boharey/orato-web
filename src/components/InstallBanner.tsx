import { useState } from "react";
import { useInstallPrompt } from "@/context/InstallPromptContext";

const DISMISS_KEY = "orato_install_banner_dismissed";

/**
 * A slim, dismissible bar rather than a Navbar button — deliberately.
 * The Navbar is already tight at a 320px viewport (a real overflow bug
 * was fixed there once already); a conditional 4th item would risk the
 * same problem the moment install support is available. Dismissal
 * persists in localStorage so it doesn't nag on every visit once someone
 * has said no, but fails silently if storage is unavailable (private
 * browsing) — worst case it just reappears next visit, not harmful.
 */
export default function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (!canInstall || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore — worst case it reappears next visit
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 bg-teal-dark px-4 py-2 text-center">
      <p className="font-body text-xs text-paper">
        Install ORATO for quick access and offline practice.
      </p>
      <button
        onClick={promptInstall}
        className="shrink-0 rounded-full bg-orange px-3 py-1 font-body text-xs font-semibold text-paper hover:bg-orange/90"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss install banner"
        className="shrink-0 font-mono text-xs text-paper/50 hover:text-paper/80"
      >
        ✕
      </button>
    </div>
  );
}
