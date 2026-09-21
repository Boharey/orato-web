import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * ErrorBoundary.tsx
 * ------------------
 * Standard React catch-all — without this, any unexpected runtime error
 * anywhere in the tree (a browser quirk, an unhandled edge case) shows a
 * blank white screen with no way to recover short of manually navigating
 * away. Must be a class component; React doesn't have a hook equivalent
 * for error boundaries.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("ORATO crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
          <h1 className="font-display text-2xl font-bold text-teal-dark">Something went wrong</h1>
          <p className="mt-3 font-body text-sm text-teal-dark/60">
            ORATO hit an unexpected error. Refreshing usually fixes it — your camera/mic
            permissions and any downloaded models stay intact.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
