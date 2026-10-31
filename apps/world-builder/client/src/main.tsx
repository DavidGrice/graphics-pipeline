import React from "react";
import { createRoot } from "react-dom/client";
import { App as WorldBuilder } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { CompareView, HealthPage, useLocationKey } from "./s3gViews";
import "./styles.css";

/** S3-G E2 — client routes: `/health` (#44), `?compare=a,b` (#84), else the world builder. */
function App() {
  useLocationKey();
  const { pathname, search } = window.location;
  if (pathname === "/health") return <HealthPage />;
  if (new URLSearchParams(search).has("compare")) return <CompareView search={search} />;
  return <WorldBuilder />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
