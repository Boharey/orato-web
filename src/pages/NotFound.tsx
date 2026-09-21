import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="font-mono text-sm text-orange">404</span>
      <h1 className="mt-2 font-display text-2xl font-bold text-teal-dark">Page not found</h1>
      <p className="mt-3 font-body text-sm text-teal-dark/60">
        That page doesn't exist — might be a typo in the URL.
      </p>
      <Link
        to="/"
        className="mt-6 rounded-full bg-orange px-6 py-3 font-body font-semibold text-paper hover:bg-orange/90"
      >
        Back home
      </Link>
    </div>
  );
}
