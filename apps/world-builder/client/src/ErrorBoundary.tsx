/**
 * S3-D #89 — App + Viewer error boundaries with a recoverable error card (D1 §1, R1 §1).
 * A viewer failure (missing/corrupt GLB, loader throw) never unmounts the sidebar/list.
 */
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import {
  capJson,
  describeLoadError,
  errorDetailsJson,
  statusLine,
  type LoadErrorInfo,
} from "./s3dErrors";

type Props = {
  scope: "app" | "viewer";
  children: ReactNode;
  assetId?: string | null;
  url?: string | null;
  probe?: Record<string, unknown> | null;
  /** Any change resets the boundary (e.g. selected asset id, retry nonce). */
  resetKey?: string | number;
  onRetry?: () => void;
  onBack?: () => void;
};
type State = { error: unknown; resetKey?: string | number };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("unknown error") };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[error-boundary:${this.props.scope}]`, error, info.componentStack);
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error == null) return this.props.children;
    return (
      <ErrorCard
        scope={this.props.scope}
        error={this.state.error}
        assetId={this.props.assetId ?? null}
        url={this.props.url ?? null}
        probe={this.props.probe ?? null}
        onRetry={this.retry}
        onBack={this.props.onBack}
      />
    );
  }
}

export function ErrorCard({
  scope,
  error,
  info: givenInfo,
  assetId,
  url,
  probe,
  onRetry,
  onBack,
}: {
  scope: "app" | "viewer";
  error?: unknown;
  /** Pre-described failure (e.g. GLB preflight) — skips describeLoadError + code fetch. */
  info?: LoadErrorInfo;
  assetId: string | null;
  url: string | null;
  probe: Record<string, unknown> | null;
  onRetry: () => void;
  onBack?: () => void;
}) {
  const [info, setInfo] = useState<LoadErrorInfo>(() => givenInfo ?? describeLoadError(error, url));
  const [copied, setCopied] = useState<string | null>(null);

  // HTTP failures: read the API's stable `code` (R1 §0 envelope) for the status line.
  useEffect(() => {
    if (givenInfo) {
      setInfo(givenInfo);
      return;
    }
    const base = describeLoadError(error, url);
    setInfo(base);
    if (base.status == null || base.status < 400 || !base.url || base.code) return;
    let alive = true;
    fetch(base.url)
      .then((r) => (r.headers.get("content-type")?.includes("json") ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j.code === "string") setInfo({ ...base, code: j.code });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [error, url, givenInfo]);

  const dump = capJson(probe);
  const title = scope === "viewer" ? `Couldn't load ${assetId ?? "asset"}` : "Something went wrong";

  async function copy() {
    const text = errorDetailsJson(assetId, info, probe);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      setCopied(ok ? "Copied" : "Copy failed — select the probe text manually");
    }
  }

  return (
    <div className={`error-card error-card-${scope}`} role="alert" data-testid="error-card">
      <h2 className="error-card-title">{title}</h2>
      <p className="error-card-status" data-testid="error-card-status">
        {statusLine(info)}
      </p>
      <p className="error-card-msg">{info.message}</p>
      <details className="error-card-probe">
        <summary>Probe summary{dump.truncated ? " (truncated)" : ""}</summary>
        <pre data-testid="error-card-probe">{probe ? dump.text : "No probe data for this asset."}</pre>
      </details>
      <div className="error-card-actions">
        <button type="button" onClick={onRetry} data-testid="error-card-retry">
          Retry
        </button>
        {onBack ? (
          <button type="button" onClick={onBack} data-testid="error-card-back">
            Back to list
          </button>
        ) : null}
        <button type="button" onClick={copy} data-testid="error-card-copy">
          Copy details
        </button>
        {copied ? (
          <span className="muted" role="status">
            {copied}
          </span>
        ) : null}
      </div>
    </div>
  );
}
