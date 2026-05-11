import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "/";
    const serviceWorkerUrl = `${base.replace(/\/$/, "/")}sw.js`;
    navigator.serviceWorker.register(serviceWorkerUrl).catch(() => {
      // best-effort PWA registration
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
