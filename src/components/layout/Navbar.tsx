import { Link } from "react-router-dom";

export default function Navbar() {
  return (
    <header className="border-b border-teal/10">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
        <Link to="/" className="font-display text-lg font-bold tracking-tight text-teal-dark sm:text-xl">
          ORATO
        </Link>
        <nav className="flex items-center gap-4 font-body text-sm text-teal-dark/70 sm:gap-8">
          <Link to="/about" className="hover:text-teal-dark">
            About
          </Link>
          <Link
            to="/practice"
            className="rounded-full bg-orange px-4 py-2.5 text-xs font-medium text-paper hover:bg-orange/90 sm:px-5 sm:text-sm"
          >
            Try it now
          </Link>
        </nav>
      </div>
    </header>
  );
}
