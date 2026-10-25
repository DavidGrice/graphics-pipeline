/**
 * S2-C-E2 — World-builder viewer: clip list + rig/stage badges (C3 wire).
 * No demo GLB / invented-clip fallback when asset has empty clips.
 */
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type AssetMeta = {
  id: string;
  slug: string;
  name: string;
  clips?: string[];
  formats?: { glb?: string; obj?: string; preview?: string };
  rig?: { hasArmature?: boolean; hasWeights?: boolean };
  characterType?: string;
  stage?: string;
  tags?: string[];
};

const API = "";

function pickDefaultClip(names: string[]): string {
  if (names.includes("idle")) return "idle";
  if (names.includes("spin")) return "spin";
  return names[0] ?? "";
}

function GltfPlayer({
  url,
  clipName,
  playing,
  onClips,
  onError,
}: {
  url: string;
  clipName: string;
  playing: boolean;
  onClips: (names: string[]) => void;
  onError: (msg: string | null) => void;
}) {
  const { scene, animations } = useGLTF(url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
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
    };
  }, [clone]);

  useEffect(() => {
    const m = mixer.current;
    if (!m) return;
    m.stopAllAction();
    if (!playing || !clipName) return;
    const clip =
      animations.find((a) => a.name === clipName) ?? animations[0] ?? null;
    if (!clip) return;
    m.clipAction(clip).reset().play();
  }, [animations, clipName, playing, clone]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      mixer.current?.update(1 / 60);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

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
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gltfClips, setGltfClips] = useState<string[]>([]);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [regJson, setRegJson] = useState("");

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
          if (cur && list.some((a: AssetMeta) => a.id === cur.id)) return cur;
          return list[0] ?? null;
        });
        setError(null);
      })
      .catch((err) => setError(String(err)));

  useEffect(() => {
    refresh();
  }, []);

  // Prefer metadata clips[]; fall back to GLB-probed names only (never invent).
  const clipsForUi = useMemo(() => {
    if (selected?.clips && selected.clips.length > 0) return selected.clips;
    if (gltfClips.length > 0) return gltfClips;
    return [] as string[];
  }, [selected, gltfClips]);

  useEffect(() => {
    const next = pickDefaultClip(clipsForUi);
    setClip(next);
    setPlaying(next.length > 0);
  }, [selected?.id, clipsForUi.join("|")]);

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

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Graphics World Builder</h1>
        <p className="muted">localhost · Sprint 2-C</p>
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
                onClips={setGltfClips}
                onError={setLoadError}
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
                  }}
                >
                  {c}
                </button>
              ))
            ) : (
              <span className="muted empty-clips">
                No clips on this asset — static / OBJ only (no demo fallback).
              </span>
            )}
          </div>
          <label className="clip-select">
            Clip:{" "}
            <select
              value={clip}
              disabled={!canPlay}
              onChange={(e) => {
                setClip(e.target.value);
                setPlaying(true);
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
          <span className="meta">Format: {formatLabel}</span>
        </div>
        {loadError && <p className="viewer-err">{loadError}</p>}
      </div>
    </div>
  );
}
