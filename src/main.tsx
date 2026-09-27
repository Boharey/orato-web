import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./registerServiceWorker";
import "./index.css";

const SELF_HOSTED_WHISPER_CONFIG_FILES = [
  "tokenizer.json",
  "tokenizer_config.json",
  "config.json",
  "preprocessor_config.json",
];

const originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const matched = SELF_HOSTED_WHISPER_CONFIG_FILES.find(
    (f) => url.includes("huggingface.co") && url.endsWith(f)
  );
  if (matched) {
    return originalFetch(`/models/whisper-base/${matched}`, init);
  }
  return originalFetch(input, init);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker();