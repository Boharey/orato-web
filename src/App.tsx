import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import ErrorBoundary from "@/components/ErrorBoundary";
import InstallBanner from "@/components/InstallBanner";
import Home from "@/pages/Home";
import About from "@/pages/About";
import Results from "@/pages/Results";
import NotFound from "@/pages/NotFound";
import { CompositorProvider } from "@/context/CompositorContext";
import { InstallPromptProvider } from "@/context/InstallPromptContext";

// Lazy-loaded, deliberately — Practice.tsx is the only route that pulls
// in MediaPipe + Transformers.js, a genuinely large chunk of JS/WASM.
// Home has zero import path to either (verified directly, not assumed),
// so splitting this out keeps the homepage bundle small and lets someone
// just browsing Home/About skip that download entirely.
const Practice = lazy(() => import("@/pages/Practice"));

function PracticeLoadingFallback() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-orange border-t-transparent" />
      <p className="mt-4 font-mono text-xs text-teal-dark/50">Loading Practice…</p>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <InstallPromptProvider>
          <CompositorProvider>
            <div className="flex min-h-screen flex-col">
              <Navbar />
              <InstallBanner />
              <main className="flex-1">
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/about" element={<About />} />
                  <Route
                    path="/practice"
                    element={
                      <Suspense fallback={<PracticeLoadingFallback />}>
                        <Practice />
                      </Suspense>
                    }
                  />
                  <Route path="/results" element={<Results />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
              <Footer />
            </div>
          </CompositorProvider>
        </InstallPromptProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
