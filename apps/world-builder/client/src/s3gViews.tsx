/**
 * S3-G E2 — client routes and overlays: #84 compare (`?compare=a,b`), #44 health page (`/health`),
 * the shared NIT-F-1 overlay placement hook (D1 §1) and the tiny pushState router. No new API:
 * only the existing GETs (/api/assets/:id, /api/assets/:id/file, /api/health, /api/activity).
 */
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, useGLTF } from "@react-three/drei";
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import * as THREE from "three";
import { activityVerb, systemActivityLabel, type ActivityItem } from "./s3fActivity";
import {
  diffRows,
  healthView,
  nextPollMs,
  parseCompare,
  placeOverlay,
  updatedAgo,
  HEALTH_POLL_MS,
  type CompareAsset,
  type HealthJson,
} from "./s3gAuthor";

// ---------------------------------------------------------------- router
export function navigate(to: string) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function useLocationKey(): string {
  const [k, setK] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setK(window.location.pathname + window.location.search);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return k;
}
export function NavLink({ to, children, testId, className }: { to: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <a
      href={to}
      className={className}
      data-testid={testId}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------- D1 §1 overlay placement
/** NIT-F-1 for every popover / overlay: below the anchor, flip above, clamp left; < 600px bottom sheet. */
export function useOverlayPlacement(open: boolean, anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, dep?: unknown): CSSProperties {
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current, p = pop.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const o = placeOverlay({ left: r.left, top: r.top, bottom: r.bottom }, { width: p.offsetWidth, height: p.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      setPos(o.sheet ? { left: o.left, top: o.top, width: o.width, position: "fixed" } : { left: o.left, top: o.top, position: "fixed" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, dep]);
  return pos;
}

// ---------------------------------------------------------------- #84 compare
type Stats = { tris?: number; bones?: number };

function CompareModel({ url, onStats }: { url: string; onStats: (s: Stats) => void }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => scene.clone(true), [scene]);
  useEffect(() => {
    let tris = 0;
    let bones = 0;
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) tris += m.geometry.index ? m.geometry.index.count / 3 : (m.geometry.attributes.position?.count ?? 0) / 3;
      if ((o as THREE.Bone).isBone) bones += 1;
    });
    onStats({ tris: Math.round(tris), bones });
  }, [clone, onStats]);
  return <primitive object={clone} />;
}

class ViewBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: String((e as Error)?.message ?? e).replace(/\/(home|workspace|tmp|etc|usr|var)\/\S*/g, "…") };
  }
  render() {
    return this.state.err ? <p className="err" role="alert">Viewer error: {this.state.err}</p> : this.props.children;
  }
}

type CamState = { pos: THREE.Vector3; target: THREE.Vector3; from: "a" | "b" } | null;

function CompareViewport({
  side,
  asset,
  sync,
  shared,
  onStats,
}: {
  side: "a" | "b";
  asset: CompareAsset & { formats?: { glb?: string } };
  sync: boolean;
  shared: React.MutableRefObject<{ a: any; b: any }>;
  onStats: (s: Stats) => void;
}) {
  const url = asset.formats?.glb ? `/api/assets/${asset.id}/file` : null;
  const ctl = useRef<any>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(() => {
    shared.current[side] = ctl;
    return () => {
      shared.current[side] = null;
      // R1 #84 — dispose on exit: no WebGL context leak across open/close cycles
      const gl = glRef.current;
      if (gl) {
        gl.dispose();
        gl.forceContextLoss();
      }
    };
  }, [side, shared]);
  const onChange = useCallback(() => {
    if (!sync) return;
    const me = ctl.current;
    const other = shared.current[side === "a" ? "b" : "a"]?.current;
    if (!me || !other || other.__syncing) return;
    other.__syncing = true;
    other.object.position.copy(me.object.position);
    other.target.copy(me.target);
    other.update();
    other.__syncing = false;
  }, [sync, side, shared]);
  return (
    <div className="compare-viewport" data-testid={side === "a" ? "compare-left" : "compare-right"}>
      <div className="compare-side-head">
        <strong>{asset.slug ?? asset.id}</strong> <span className="badge stage">{asset.stage ?? "—"}</span>
      </div>
      <div className="compare-canvas" role="img" aria-label={`${asset.slug ?? asset.id} preview`}>
        <Canvas camera={{ position: [2, 1.5, 3], fov: 50 }} gl={{ alpha: false }} onCreated={({ gl }) => (glRef.current = gl)}>
          <color attach="background" args={["#14161c"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 2]} intensity={1.1} />
          <Grid infiniteGrid fadeDistance={20} />
          <OrbitControls ref={ctl} makeDefault onChange={onChange} />
          <ViewBoundary>
            <Suspense fallback={null}>{url ? <CompareModel url={url} onStats={onStats} /> : null}</Suspense>
          </ViewBoundary>
        </Canvas>
        {!url ? <p className="muted compare-nomesh">No GLB for this asset</p> : null}
      </div>
    </div>
  );
}

async function headSize(id: string): Promise<number | undefined> {
  try {
    const r = await fetch(`/api/assets/${id}/file`, { method: "HEAD" });
    const n = Number(r.headers.get("content-length"));
    return r.ok && Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export function CompareView({ search }: { search: string }) {
  const parsed = parseCompare(search);
  const [pair, setPair] = useState<{ a: any; b: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sync, setSync] = useState(true);
  const [stats, setStats] = useState<{ a?: Stats; b?: Stats }>({});
  const shared = useRef<{ a: any; b: any }>({ a: null, b: null });
  const onA = useCallback((s: Stats) => setStats((p) => ({ ...p, a: s })), []);
  const onB = useCallback((s: Stats) => setStats((p) => ({ ...p, b: s })), []);
  useEffect(() => {
    setPair(null);
    setErr(null);
    setStats({});
    if (!parsed || !parsed.ok) return;
    let alive = true;
    const get = async (id: string) => {
      const r = await fetch(`/api/assets/${encodeURIComponent(id)}`);
      if (r.status === 404) throw new Error(`Unknown asset id "${id}"`);
      if (!r.ok) throw new Error(`Could not load asset "${id}" (HTTP ${r.status})`);
      const j = await r.json();
      return { ...j, sizeBytes: j.formats?.glb ? await headSize(j.id) : undefined };
    };
    Promise.all([get(parsed.a), get(parsed.b)])
      .then(([a, b]) => alive && setPair({ a, b }))
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [search]);
  const error = parsed && !parsed.ok ? parsed.error : err;
  const rows = pair ? diffRows(pair.a, pair.b, stats) : [];
  return (
    <main className="compare-page" data-testid="compare-page" aria-label="Compare assets">
      <div className="compare-top">
        <h1>Compare</h1>
        <NavLink to="/" className="tiny" testId="compare-back">Back to assets</NavLink>
        {pair ? (
          <label className="compare-sync" data-testid="compare-sync">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Sync orbit
          </label>
        ) : null}
      </div>
      {error ? (
        <div className="compare-error" role="alert" data-testid="compare-error">
          <p className="err">{error}</p>
          <NavLink to="/" testId="compare-error-back">Back to assets</NavLink>
        </div>
      ) : !pair ? (
        <p className="muted" role="status">Loading…</p>
      ) : (
        <>
          <div className="compare-split">
            <CompareViewport side="a" asset={pair.a} sync={sync} shared={shared} onStats={onA} />
            <CompareViewport side="b" asset={pair.b} sync={sync} shared={shared} onStats={onB} />
          </div>
          <table className="compare-diff" data-testid="compare-diff">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">{pair.a.slug}</th>
                <th scope="col">{pair.b.slug}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.differs ? "differs" : undefined} data-differs={r.differs ? "1" : "0"} data-row={r.key}>
                  <th scope="row">
                    {r.differs ? <span className="diff-mark" aria-label="differs">≠ </span> : null}
                    {r.label}
                  </th>
                  <td>{r.a}</td>
                  <td>{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- #44 health page
export function HealthPage() {
  const [health, setHealth] = useState<HealthJson | null>(null);
  const [httpErr, setHttpErr] = useState<string | null>(null);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(() => document.hidden);
  const [rlUntil, setRlUntil] = useState(0);
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      document.removeEventListener("visibilitychange", on);
      window.clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (hidden) return; // R1 #44 — document.hidden pauses polling
    let alive = true;
    let timer = 0;
    const poll = async () => {
      let wait = HEALTH_POLL_MS;
      try {
        const [h, a] = await Promise.all([fetch("/api/health"), fetch("/api/activity?limit=5")]);
        if (!alive) return;
        setPolls((n) => n + 1);
        if (h.status === 429 || a.status === 429) {
          const r = h.status === 429 ? h : a;
          wait = nextPollMs(429, r.headers.get("retry-after"));
          setRlUntil(Date.now() + wait);
        } else {
          setRlUntil(0);
          const hj = (await h.json().catch(() => null)) as HealthJson | null;
          setHealth(hj);
          setHttpErr(h.ok ? null : `HTTP ${h.status}`);
          const aj = await a.json().catch(() => null);
          if (a.ok && aj && Array.isArray(aj.items)) setActs(aj.items.slice(0, 5));
          setLast(Date.now());
        }
      } catch {
        if (alive) setHttpErr("API unreachable");
      }
      if (alive) timer = window.setTimeout(poll, wait);
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [hidden]);
  const v = healthView(health);
  const rlLeft = Math.max(0, Math.ceil((rlUntil - now) / 1000));
  return (
    <main className="health-page" data-testid="health-page" data-polls={polls} aria-label="Bridge health">
      <div className="compare-top">
        <h1>Health</h1>
        <NavLink to="/" className="tiny" testId="health-back">Back to assets</NavLink>
      </div>
      <p className="muted" role="status" data-testid="health-updated">
        {hidden ? "Paused (tab hidden)" : rlLeft > 0 ? `Rate limited, retrying in ${rlLeft}s` : updatedAgo(last, now)}
        {httpErr ? ` · ${httpErr}` : ""}
      </p>
      <div className="health-grid">
        <section className={`health-card health-${v.status}`} data-testid="health-bridge">
          <h2>Bridge</h2>
          <p>
            <span aria-hidden="true">{v.icon}</span> <strong>{v.status}</strong>
          </p>
          <p className="muted">mode: {v.mode}{v.http != null ? ` · HTTP ${v.http}` : ""}</p>
        </section>
        <section className="health-card"><h2>Krita port</h2><p>{v.port}</p></section>
        <section className="health-card">
          <h2>Tools</h2>
          <ul>{v.tools.map((t) => <li key={t.name}>{t.name}: {t.version}</li>)}</ul>
        </section>
        <section className="health-card">
          <h2>Limits</h2>
          <ul>{v.limits.map((l) => <li key={l.name}>{l.name}: {l.value}</li>)}</ul>
        </section>
        <section className="health-card"><h2>Share base</h2><p>{v.share}</p></section>
        <section className="health-card" data-testid="health-dataroot"><h2>Data root</h2><p>{v.dataRoot}</p></section>
        <section className="health-card health-activity" data-testid="health-activity">
          <h2>Recent activity</h2>
          {acts.length === 0 ? <p className="muted">No activity yet</p> : (
            <ul className="activity-list">
              {acts.map((it, k) => (
                <li key={`${it.at}-${it.id ?? it.kind}-${k}`} className="activity-row">
                  {systemActivityLabel(it) ?? (
                    <>
                      <span className="activity-verb">{activityVerb(it.kind)}</span> <code>{it.slug ?? (it.id ?? "").slice(0, 8)}</code>
                    </>
                  )}{" "}
                  <time className="muted" dateTime={it.at} title={it.at}>{new Date(it.at).toLocaleTimeString()}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
