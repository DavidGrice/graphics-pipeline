/**
 * S2-D-E1 — World-builder viewer: clip authoring UX (D1 wire).
 * Persist clipUx (default/order/disabled); loop + scrub; no demo fallback.
 */
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, useGLTF } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type ClipUx = {
  defaultClip?: string;
  order?: string[];
  disabled?: string[];
};

type AssetMeta = {
  id: string;
  slug: string;
  name: string;
  clips?: string[];
  clipUx?: ClipUx;
  formats?: { glb?: string; obj?: string; preview?: string };
  rig?: { hasArmature?: boolean; hasWeights?: boolean };
  characterType?: string;
  stage?: string;
  tags?: string[];
};

const API = "";

/** Optional allowlist + required + billboard (D1 §2). Unlisted stay in raw probe only. */
const CLIP_ALLOWLIST = new Set([
  "idle",
  "walk",
  "run",
  "spin",
  "jump",
  "wave",
  "attack",
  "death",
  "sit",
]);

function isAllowlisted(name: string): boolean {
  return CLIP_ALLOWLIST.has(name) || name.startsWith("emote_");
}

function lsKey(assetId: string): string {
  return `gp.clipUx.${assetId}`;
}

function readLocalClipUx(assetId: string): ClipUx | null {
  try {
    const raw = localStorage.getItem(lsKey(assetId));
    if (!raw) return null;
    return JSON.parse(raw) as ClipUx;
  } catch {
    return null;
  }
}

function writeLocalClipUx(assetId: string, ux: ClipUx): void {
  try {
    localStorage.setItem(lsKey(assetId), JSON.stringify(ux));
  } catch {
    /* ignore quota */
  }
}

function mergeClipUx(asset: AssetMeta | null): ClipUx {
  if (!asset) return {};
  const local = readLocalClipUx(asset.id) ?? {};
  const remote = asset.clipUx ?? {};
  return {
    defaultClip: remote.defaultClip ?? local.defaultClip,
    order: remote.order ?? local.order,
    disabled: remote.disabled ?? local.disabled,
  };
}

function orderClips(probed: string[], ux: ClipUx): string[] {
  const allow = probed.filter(isAllowlisted);
  const disabled = new Set(ux.disabled ?? []);
  const ordered: string[] = [];
  for (const name of ux.order ?? []) {
    if (allow.includes(name) && !disabled.has(name) && !ordered.includes(name)) {
      ordered.push(name);
    }
  }
  for (const name of allow) {
    if (!disabled.has(name) && !ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

function pickDefaultClip(names: string[], ux: ClipUx): string {
  if (ux.defaultClip && names.includes(ux.defaultClip)) return ux.defaultClip;
  if (names.includes("idle")) return "idle";
  if (names.includes("spin")) return "spin";
  return names[0] ?? "";
}

function GltfPlayer({
  url,
  clipName,
  playing,
  loop,
  scrub,
  scrubbing,
  onClips,
  onError,
  onDuration,
}: {
  url: string;
  clipName: string;
  playing: boolean;
  loop: boolean;
  scrub: number;
  scrubbing: boolean;
  onClips: (names: string[]) => void;
  onError: (msg: string | null) => void;
  onDuration: (sec: number) => void;
}) {
  const { scene, animations } = useGLTF(url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const clone = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    onError(null);
    onClips(animations.map((a) => a.name));
  }, [animations, onClips, onError]);

  useEffect(() => {
    mixer.current = new THREE.AnimationMixer(clone);
    return () => {
      mixer.current?.stopAllAction();
      mixer.current = null;
      actionRef.current = null;
    };
  }, [clone]);

  useEffect(() => {
    const m = mixer.current;
    if (!m) return;
    m.stopAllAction();
    actionRef.current = null;
    if (!clipName) {
      onDuration(0);
      return;
    }
    const clip =
      animations.find((a) => a.name === clipName) ?? animations[0] ?? null;
    if (!clip) {
      onDuration(0);
      return;
    }
    onDuration(clip.duration || 0);
    const action = m.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    if (playing && !scrubbing) {
      action.play();
    } else {
      action.play();
      action.paused = true;
      if (clip.duration > 0) {
        action.time = scrub * clip.duration;
      }
      m.update(0);
    }
    actionRef.current = action;
  }, [animations, clipName, playing, loop, clone, scrubbing, scrub, onDuration]);

  // Apply scrub while dragging without restarting action setup every frame when already scrubbing.
  useEffect(() => {
    if (!scrubbing) return;
    const action = actionRef.current;
    const m = mixer.current;
    if (!action || !m) return;
    const clip = action.getClip();
    action.paused = true;
    action.time = (clip.duration || 0) * scrub;
    m.update(0);
  }, [scrub, scrubbing]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!scrubbing) {
        mixer.current?.update(dt);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scrubbing]);

  return <primitive object={clone} />;
}

function LoadError({ message }: { message: string }) {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#a33" />
    </mesh>
  );
}

export function App() {
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [selected, setSelected] = useState<AssetMeta | null>(null);
  const [clip, setClip] = useState("");
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [scrub, setScrub] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gltfClips, setGltfClips] = useState<string[]>([]);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [regJson, setRegJson] = useState("");
  const [clipUx, setClipUx] = useState<ClipUx>({});

  const refresh = () =>
    fetch(`${API}/api/assets`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/assets ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setAssets(list);
        setSelected((cur) => {
          if (cur && list.some((a: AssetMeta) => a.id === cur.id)) {
            return list.find((a: AssetMeta) => a.id === cur.id) ?? cur;
          }
          return list[0] ?? null;
        });
        setError(null);
      })
      .catch((err) => setError(String(err)));

  useEffect(() => {
    refresh();
  }, []);

  const probedClips = useMemo(() => {
    if (selected?.clips && selected.clips.length > 0) return selected.clips;
    if (gltfClips.length > 0) return gltfClips;
    return [] as string[];
  }, [selected, gltfClips]);

  const clipsForUi = useMemo(
    () => orderClips(probedClips, clipUx),
    [probedClips, clipUx],
  );

  useEffect(() => {
    if (!selected) {
      setClipUx({});
      return;
    }
    setClipUx(mergeClipUx(selected));
  }, [selected?.id, selected?.clipUx]);

  useEffect(() => {
    const next = pickDefaultClip(clipsForUi, clipUx);
    setClip(next);
    setPlaying(next.length > 0);
    setScrub(0);
  }, [selected?.id, clipsForUi.join("|"), clipUx.defaultClip]);

  const persistClipUx = useCallback(
    async (next: ClipUx) => {
      if (!selected) return;
      setClipUx(next);
      writeLocalClipUx(selected.id, next);
      // Durable register field (prefer over localStorage-only).
      try {
        const r = await fetch(`${API}/api/assets/${selected.id}/clip-ux`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (r.ok) {
          const updated = (await r.json()) as AssetMeta;
          setAssets((list) =>
            list.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
          );
          setSelected((cur) =>
            cur && cur.id === updated.id ? { ...cur, ...updated } : cur,
          );
        }
      } catch {
        /* localStorage already written — offline OK */
      }
    },
    [selected],
  );

  const setDefaultClip = (name: string) => {
    if (!clipsForUi.includes(name)) return;
    void persistClipUx({ ...clipUx, defaultClip: name });
    setClip(name);
    setPlaying(true);
  };

  const moveClip = (name: string, dir: -1 | 1) => {
    const list = [...clipsForUi];
    const i = list.indexOf(name);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void persistClipUx({ ...clipUx, order: list });
  };

  const toggleDisabled = (name: string) => {
    const disabled = new Set(clipUx.disabled ?? []);
    if (disabled.has(name)) disabled.delete(name);
    else disabled.add(name);
    void persistClipUx({ ...clipUx, disabled: [...disabled] });
  };

  const filtered = assets.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      a.slug.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      (a.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
    );
  });

  const canPlay = clipsForUi.length > 0;
  const glbUrl = selected
    ? `${API}/api/assets/${selected.id}/file`
    : null;
  const formatLabel = selected?.formats?.glb
    ? "glb"
    : selected?.formats?.obj
      ? "obj (static)"
      : "—";
  const stage = selected?.stage ?? "—";
  const modeBadge =
    stage === "rigged"
      ? "Rigged"
      : stage === "mvp-billboard" || selected?.characterType === "billboard"
        ? "Billboard"
        : selected?.characterType ?? "—";

  async function submitRegister() {
    try {
      const body = JSON.parse(regJson);
      const r = await fetch(`${API}/api/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${text}`);
      setRegisterOpen(false);
      await refresh();
    } catch (err) {
      setError(`Register failed: ${err}`);
    }
  }

  const authorPool = useMemo(() => {
    // Author list: allowlisted probed, including disabled (so they can re-enable).
    return probedClips.filter(isAllowlisted);
  }, [probedClips]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Graphics World Builder</h1>
        <p className="muted">localhost · Sprint 2-D</p>
        <input
          className="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search assets"
        />
        {error && <p className="err">{error}</p>}
        <ul className="asset-list">
          {filtered.length === 0 && (
            <li className="muted">No assets — run pipeline or Register.</li>
          )}
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={selected?.id === a.id ? "asset active" : "asset"}
                onClick={() => {
                  setSelected(a);
                  setLoadError(null);
                  setGltfClips([]);
                }}
              >
                {selected?.id === a.id ? "★ " : ""}
                {a.name || a.slug}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="primary" onClick={() => setRegisterOpen((o) => !o)}>
          Register asset
        </button>
        {registerOpen && (
          <div className="register">
            <textarea
              rows={10}
              placeholder='Paste Asset JSON (id, slug, clips, formats…)'
              value={regJson}
              onChange={(e) => setRegJson(e.target.value)}
            />
            <button type="button" onClick={submitRegister}>
              POST /api/assets
            </button>
          </div>
        )}
      </aside>
      <div className="viewer">
        <div className="viewer-header">
          <div className="asset-title">
            {selected ? (
              <>
                <strong>{selected.name || selected.slug}</strong>
                <span className="muted"> / {selected.slug}</span>
              </>
            ) : (
              <span className="muted">No asset selected</span>
            )}
          </div>
          <div className="badges" aria-label="Asset badges">
            <span className="badge stage">{stage}</span>
            <span className="badge mode">{modeBadge}</span>
            <span
              className={
                selected?.rig?.hasArmature ? "badge on" : "badge off"
              }
            >
              Armature
            </span>
            <span
              className={selected?.rig?.hasWeights ? "badge on" : "badge off"}
            >
              Weights
            </span>
            {selected?.characterType && (
              <span className="badge mode">{selected.characterType}</span>
            )}
          </div>
        </div>
        <Canvas camera={{ position: [2, 1.5, 3], fov: 50 }}>
          <color attach="background" args={["#12151c"]} />
          <ambientLight intensity={0.65} />
          <directionalLight position={[3, 5, 2]} intensity={1.1} />
          <Grid infiniteGrid fadeDistance={20} sectionColor="#333" cellColor="#222" />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial color="#1a1e28" transparent opacity={0.5} />
          </mesh>
          <OrbitControls makeDefault />
          <Suspense fallback={null}>
            {glbUrl && !loadError ? (
              <GltfPlayer
                url={glbUrl}
                clipName={clip}
                playing={playing && canPlay}
                loop={loop}
                scrub={scrub}
                scrubbing={scrubbing}
                onClips={setGltfClips}
                onError={setLoadError}
                onDuration={setDuration}
              />
            ) : loadError ? (
              <LoadError message={loadError} />
            ) : null}
          </Suspense>
        </Canvas>
        <div className="clip-bar">
          <div className="clip-list" role="listbox" aria-label="Clips">
            {canPlay ? (
              clipsForUi.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={clip === c}
                  className={clip === c ? "clip active" : "clip"}
                  onClick={() => {
                    setClip(c);
                    setPlaying(true);
                    setScrub(0);
                  }}
                  title={
                    clipUx.defaultClip === c
                      ? "Default clip"
                      : "Click to play"
                  }
                >
                  {c}
                  {clipUx.defaultClip === c ? " ★" : ""}
                </button>
              ))
            ) : (
              <span className="muted empty-clips">
                No clips on this asset — static empty-state (no demo fallback).
                {(clipUx.disabled?.length ?? 0) > 0
                  ? " Re-enable a clip in Author."
                  : ""}
              </span>
            )}
          </div>
          <label className="loop-toggle">
            <input
              type="checkbox"
              checked={loop}
              disabled={!canPlay}
              onChange={(e) => setLoop(e.target.checked)}
            />
            ⟲ loop
          </label>
          <label className="clip-select">
            Clip:{" "}
            <select
              value={clip}
              disabled={!canPlay}
              onChange={(e) => {
                setClip(e.target.value);
                setPlaying(true);
                setScrub(0);
              }}
            >
              {canPlay ? (
                clipsForUi.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              ) : (
                <option value="">(none — static)</option>
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={!canPlay}
            onClick={() => setPlaying((p) => !p)}
            title={canPlay ? "Play / pause" : "No clips — Play disabled"}
          >
            {playing && canPlay ? "Pause" : "▶ Play"}
          </button>
          <label className="scrub">
            Timeline
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={scrub}
              disabled={!canPlay || duration <= 0}
              aria-label="Scrub active clip 0–1"
              onMouseDown={() => setScrubbing(true)}
              onTouchStart={() => setScrubbing(true)}
              onMouseUp={() => setScrubbing(false)}
              onTouchEnd={() => setScrubbing(false)}
              onChange={(e) => {
                setScrub(Number(e.target.value));
                setScrubbing(true);
              }}
            />
            <span className="muted">
              {duration > 0 ? `${(scrub * duration).toFixed(2)}s` : "—"}
            </span>
          </label>
          <span className="meta">Format: {formatLabel}</span>
        </div>
        {selected && authorPool.length > 0 && (
          <div className="clip-author" aria-label="Clip authoring">
            <span className="muted">Author:</span>
            {authorPool.map((c) => {
              const disabled = (clipUx.disabled ?? []).includes(c);
              return (
                <span key={c} className="author-row">
                  <strong className={disabled ? "muted" : ""}>{c}</strong>
                  <button
                    type="button"
                    title="Move up"
                    disabled={disabled}
                    onClick={() => moveClip(c, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={disabled}
                    onClick={() => moveClip(c, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="Set default"
                    disabled={disabled}
                    onClick={() => setDefaultClip(c)}
                  >
                    ★ default
                  </button>
                  <button
                    type="button"
                    title={disabled ? "Re-enable" : "Disable"}
                    onClick={() => toggleDisabled(c)}
                  >
                    {disabled ? "Enable" : "Disable"}
                  </button>
                </span>
              );
            })}
            <span className="muted persist-note">
              Persist: asset <code>clipUx</code> (API) + localStorage fallback
            </span>
          </div>
        )}
        {loadError && <p className="viewer-err">{loadError}</p>}
      </div>
    </div>
  );
}
