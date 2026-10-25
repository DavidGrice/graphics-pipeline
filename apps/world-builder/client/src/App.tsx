/**
 * S2-F-E2 / S2-G-E2 — World-builder viewer: clip UX + importMeta + scene compose/author.
 * Compose stage=scene children by transform + defaultClip; author CRUD; no demo fallback.
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

type SceneNodeDraft = {
  id: string;
  assetId: string;
  defaultClip?: string;
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
};

type ImportMetaView = {
  source?: string;
  originalFilename?: string;
  actionMap?: Record<string, string>;
  boneMapStub?: string;
  characterTypeHint?: string;
  humanoidPngApproved?: boolean;
};

type AssetMeta = {
  id: string;
  slug: string;
  name: string;
  clips?: string[];
  clipUx?: ClipUx;
  importMeta?: ImportMetaView;
  formats?: { glb?: string; obj?: string; preview?: string };
  rig?: { hasArmature?: boolean; hasWeights?: boolean };
  characterType?: string;
  stage?: string;
  tags?: string[];
  scene?: {
    version?: number;
    nodes?: Array<{
      id: string;
      assetId: string;
      defaultClip?: string;
      transform?: {
        position?: [number, number, number];
        rotation?: [number, number, number];
        scale?: [number, number, number];
      };
    }>;
    rootId?: string;
  };
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


/** S2-F-E2 — place one scene child GLB by transform; play defaultClip when set. */
function SceneNodeModel({
  url,
  clipName,
  transform,
  highlighted,
}: {
  url: string;
  clipName?: string;
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
  highlighted?: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const clone = useMemo(() => scene.clone(true), [scene]);
  const pos = transform?.position ?? ([0, 0, 0] as [number, number, number]);
  const rot = transform?.rotation ?? ([0, 0, 0] as [number, number, number]);
  const scl = transform?.scale ?? ([1, 1, 1] as [number, number, number]);

  useEffect(() => {
    const m = new THREE.AnimationMixer(clone);
    mixer.current = m;
    let action: THREE.AnimationAction | null = null;
    if (clipName) {
      const clip =
        animations.find((a) => a.name === clipName) ?? animations[0] ?? null;
      if (clip) {
        action = m.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      m.update(dt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      m.stopAllAction();
      mixer.current = null;
    };
  }, [clone, animations, clipName]);

  return (
    <group position={pos} rotation={rot} scale={scl}>
      <primitive object={clone} />
      {highlighted ? (
        <mesh position={[0, 0.05, 0]}>
          <ringGeometry args={[0.55, 0.65, 32]} />
          <meshBasicMaterial color="#5b6cff" side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

function SceneNodeMissing({
  transform,
  label,
}: {
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
  label: string;
}) {
  const pos = transform?.position ?? ([0, 0, 0] as [number, number, number]);
  return (
    <group position={pos}>
      <mesh>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <meshStandardMaterial color="#a33" wireframe />
      </mesh>
      {/* label reserved for a11y / future Html overlay */}
      <group userData={{ missingLabel: label }} />
    </group>
  );
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
  const [sceneNodeId, setSceneNodeId] = useState<string | null>(null);
  const [sceneDraft, setSceneDraft] = useState<SceneNodeDraft[]>([]);
  const [sceneRootId, setSceneRootId] = useState<string | undefined>(undefined);
  const [sceneSaveError, setSceneSaveError] = useState<string | null>(null);
  const [sceneSaving, setSceneSaving] = useState(false);

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
      setSceneNodeId(null);
      return;
    }
    setClipUx(mergeClipUx(selected));
    if (selected.stage === "scene") {
      const nodes = (selected.scene?.nodes ?? []).map((n) => ({
        id: n.id,
        assetId: n.assetId,
        defaultClip: n.defaultClip,
        transform: n.transform
          ? {
              position: (n.transform.position ?? [0, 0, 0]) as [
                number,
                number,
                number,
              ],
              rotation: (n.transform.rotation ?? [0, 0, 0]) as [
                number,
                number,
                number,
              ],
              scale: (n.transform.scale ?? [1, 1, 1]) as [number, number, number],
            }
          : {
              position: [0, 0, 0] as [number, number, number],
              rotation: [0, 0, 0] as [number, number, number],
              scale: [1, 1, 1] as [number, number, number],
            },
      }));
      setSceneDraft(nodes as SceneNodeDraft[]);
      setSceneRootId(selected.scene?.rootId ?? nodes[0]?.id);
      setSceneNodeId(selected.scene?.rootId ?? nodes[0]?.id ?? null);
      setSceneSaveError(null);
    } else {
      setSceneDraft([]);
      setSceneRootId(undefined);
      setSceneNodeId(null);
      setSceneSaveError(null);
    }
  }, [selected?.id, selected?.clipUx, selected?.stage, selected?.scene]);

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

  const isScene = selected?.stage === "scene";
  const sceneNodes = isScene && sceneDraft.length > 0 ? sceneDraft : selected?.scene?.nodes ?? [];
  const nonSceneAssets = useMemo(
    () => assets.filter((a) => a.stage !== "scene"),
    [assets],
  );

  const newNodeId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `n-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  const addSceneNode = () => {
    const first = nonSceneAssets[0];
    const id = newNodeId();
    setSceneDraft((prev) => [
      ...prev,
      {
        id,
        assetId: first?.id ?? first?.slug ?? "",
        transform: {
          position: [prev.length * 2, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ]);
    if (!sceneRootId) setSceneRootId(id);
    setSceneNodeId(id);
  };

  const removeSceneNode = (id: string) => {
    setSceneDraft((prev) => {
      if (prev.length <= 1) {
        setSceneSaveError("scene must keep ≥1 node (V1)");
        return prev;
      }
      const next = prev.filter((n) => n.id !== id);
      if (sceneRootId === id) {
        setSceneRootId(next[0]?.id);
      }
      if (sceneNodeId === id) setSceneNodeId(next[0]?.id ?? null);
      return next;
    });
  };

  const patchSceneNode = (id: string, patch: Partial<SceneNodeDraft>) => {
    setSceneDraft((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    );
  };

  const patchNodeVec = (
    id: string,
    key: "position" | "rotation" | "scale",
    idx: 0 | 1 | 2,
    raw: string,
  ) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    setSceneDraft((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const base =
          n.transform?.[key] ??
          (key === "scale" ? [1, 1, 1] : [0, 0, 0]);
        const next = [...base] as [number, number, number];
        next[idx] = num;
        return {
          ...n,
          transform: {
            position: (n.transform?.position ?? [0, 0, 0]) as [
              number,
              number,
              number,
            ],
            rotation: (n.transform?.rotation ?? [0, 0, 0]) as [
              number,
              number,
              number,
            ],
            scale: (n.transform?.scale ?? [1, 1, 1]) as [number, number, number],
            [key]: next,
          },
        };
      }),
    );
  };

  const persistScene = async () => {
    if (!selected || selected.stage !== "scene") return;
    if (sceneDraft.length < 1) {
      setSceneSaveError("scene.nodes must have ≥1 node");
      return;
    }
    if (sceneDraft.some((n) => !n.assetId.trim())) {
      setSceneSaveError("every node needs assetId (id or slug)");
      return;
    }
    setSceneSaving(true);
    setSceneSaveError(null);
    try {
      const body = {
        ...selected,
        updatedAt: new Date().toISOString(),
        scene: {
          version: selected.scene?.version ?? 1,
          rootId: sceneRootId ?? sceneDraft[0]?.id,
          nodes: sceneDraft.map((n) => ({
            id: n.id,
            assetId: n.assetId.trim(),
            defaultClip: n.defaultClip || undefined,
            transform: n.transform,
          })),
        },
      };
      const r = await fetch(`${API}/api/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const textBody = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${textBody}`);
      const updated = JSON.parse(textBody) as AssetMeta;
      setAssets((list) =>
        list.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      );
      setSelected((cur) =>
        cur && cur.id === updated.id ? { ...cur, ...updated } : cur,
      );
    } catch (err) {
      setSceneSaveError(`Save failed: ${err}`);
    } finally {
      setSceneSaving(false);
    }
  };

  const resolveChild = useCallback(
    (assetId: string): AssetMeta | null => {
      return (
        assets.find((a) => a.id === assetId || a.slug === assetId) ?? null
      );
    },
    [assets],
  );

  const canPlay = clipsForUi.length > 0 && !isScene;
  const glbUrl =
    selected && !isScene ? `${API}/api/assets/${selected.id}/file` : null;
  const formatLabel = selected?.formats?.glb
    ? "glb"
    : selected?.formats?.obj
      ? "obj (static)"
      : "—";
  const stage = selected?.stage ?? "—";
  const modeBadge =
    stage === "scene"
      ? "Scene"
      : stage === "rigged"
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
        <p className="muted">localhost · Sprint 2-G</p>
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
            {selected?.importMeta?.source && (
              <span
                className={
                  selected.importMeta.source === "mixamo"
                    ? "badge import src-mixamo"
                    : selected.importMeta.source === "fbx"
                      ? "badge import src-fbx"
                      : "badge import src-other"
                }
                title="importMeta.source"
              >
                {selected.importMeta.source}
              </span>
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
            {isScene
              ? sceneNodes.map((n) => {
                  const child = resolveChild(n.assetId);
                  const childUrl = child
                    ? `${API}/api/assets/${child.id}/file`
                    : null;
                  const clipForNode =
                    n.defaultClip ||
                    child?.clipUx?.defaultClip ||
                    (child?.clips && child.clips[0]) ||
                    undefined;
                  if (!child || !child.formats?.glb) {
                    return (
                      <SceneNodeMissing
                        key={n.id}
                        transform={n.transform}
                        label={n.assetId}
                      />
                    );
                  }
                  return (
                    <SceneNodeModel
                      key={n.id}
                      url={childUrl!}
                      clipName={clipForNode}
                      transform={n.transform}
                      highlighted={sceneNodeId === n.id}
                    />
                  );
                })
              : glbUrl && !loadError ? (
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
        {selected?.importMeta && (
          <div className="import-meta-panel" aria-label="Import metadata">
            <div className="import-meta-title">Import</div>
            <div className="import-meta-row">
              <span className="muted">source</span>
              <strong>{selected.importMeta.source ?? "—"}</strong>
            </div>
            {selected.importMeta.originalFilename && (
              <div className="import-meta-row">
                <span className="muted">originalFilename</span>
                <code>{selected.importMeta.originalFilename}</code>
              </div>
            )}
            {selected.importMeta.boneMapStub && (
              <div className="import-meta-row">
                <span className="muted">boneMapStub</span>
                <code>{selected.importMeta.boneMapStub}</code>
              </div>
            )}
            {selected.importMeta.characterTypeHint && (
              <div className="import-meta-row">
                <span className="muted">characterTypeHint</span>
                <span>{selected.importMeta.characterTypeHint}</span>
              </div>
            )}
            {selected.importMeta.humanoidPngApproved === true && (
              <div className="import-meta-row">
                <span className="muted">humanoidPngApproved</span>
                <span>true</span>
              </div>
            )}
            {selected.importMeta.actionMap &&
              Object.keys(selected.importMeta.actionMap).length > 0 && (
                <div className="import-meta-actions">
                  <span className="muted">actionMap</span>
                  <div className="action-chips">
                    {Object.entries(selected.importMeta.actionMap).map(
                      ([src, dest]) => (
                        <span key={src} className="action-chip">
                          {src} → {dest}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              )}
          </div>
        )}
        {isScene && (
          <div className="scene-stub-panel scene-author-panel" aria-label="Scene author">
            <div className="import-meta-title">
              Scene author · v{selected?.scene?.version ?? 1} ·{" "}
              {sceneDraft.length} node{sceneDraft.length === 1 ? "" : "s"}
              {sceneRootId ? ` · root ${sceneRootId}` : ""}
            </div>
            <div className="scene-author-actions">
              <button type="button" className="tiny" onClick={addSceneNode}>
                + Add node
              </button>
              <button
                type="button"
                className="tiny primary"
                disabled={sceneSaving || sceneDraft.length < 1}
                onClick={() => void persistScene()}
              >
                {sceneSaving ? "Saving…" : "Save / Register"}
              </button>
            </div>
            {sceneSaveError && <p className="err">{sceneSaveError}</p>}
            <ul className="scene-node-list">
              {sceneDraft.map((n) => {
                const child = resolveChild(n.assetId);
                const isRoot = (sceneRootId ?? sceneDraft[0]?.id) === n.id;
                const pos = n.transform?.position ?? [0, 0, 0];
                const rot = n.transform?.rotation ?? [0, 0, 0];
                const scl = n.transform?.scale ?? [1, 1, 1];
                const childClips = child?.clips ?? [];
                const resolveOk =
                  !!child && child.stage !== "scene" && !!child.stage;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={
                        sceneNodeId === n.id
                          ? "scene-node active"
                          : "scene-node"
                      }
                      onClick={() => setSceneNodeId(n.id)}
                    >
                      {isRoot ? "★ " : ""}
                      <code>{n.id.slice(0, 8)}</code>
                      <span className="muted"> → </span>
                      <code>{child?.slug ?? (n.assetId || "—")}</code>
                      {resolveOk ? (
                        <span className="badge stage" title="Resolve ✓">
                          {child?.stage} ✓
                        </span>
                      ) : (
                        <span className="badge off" title="Resolve ✗">
                          unresolved
                        </span>
                      )}
                      {n.defaultClip ? (
                        <span className="badge mode">▶ {n.defaultClip}</span>
                      ) : null}
                    </button>
                    {sceneNodeId === n.id && (
                      <div className="scene-node-edit">
                        <label className="scene-edit-row">
                          <span>asset</span>
                          <select
                            value={n.assetId}
                            onChange={(e) =>
                              patchSceneNode(n.id, {
                                assetId: e.target.value,
                                defaultClip: undefined,
                              })
                            }
                            aria-label={`asset for ${n.id}`}
                          >
                            <option value="">— pick —</option>
                            {n.assetId &&
                              !nonSceneAssets.some(
                                (a) => a.id === n.assetId || a.slug === n.assetId,
                              ) && (
                                <option value={n.assetId}>{n.assetId}</option>
                              )}
                            {nonSceneAssets.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.slug} ({a.stage})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="scene-edit-row">
                          <span>defaultClip</span>
                          <select
                            value={n.defaultClip ?? ""}
                            onChange={(e) =>
                              patchSceneNode(n.id, {
                                defaultClip: e.target.value || undefined,
                              })
                            }
                            aria-label={`defaultClip for ${n.id}`}
                          >
                            <option value="">— none —</option>
                            {childClips.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="scene-edit-row">
                          <span>pos</span>
                          {([0, 1, 2] as const).map((i) => (
                            <input
                              key={`p${i}`}
                              type="number"
                              step="0.1"
                              value={pos[i]}
                              onChange={(e) =>
                                patchNodeVec(n.id, "position", i, e.target.value)
                              }
                              aria-label={`pos ${i}`}
                            />
                          ))}
                        </div>
                        <div className="scene-edit-row">
                          <span>rot</span>
                          {([0, 1, 2] as const).map((i) => (
                            <input
                              key={`r${i}`}
                              type="number"
                              step="0.1"
                              value={rot[i]}
                              onChange={(e) =>
                                patchNodeVec(n.id, "rotation", i, e.target.value)
                              }
                              aria-label={`rot ${i}`}
                            />
                          ))}
                        </div>
                        <div className="scene-edit-row">
                          <span>scale</span>
                          {([0, 1, 2] as const).map((i) => (
                            <input
                              key={`s${i}`}
                              type="number"
                              step="0.1"
                              value={scl[i]}
                              onChange={(e) =>
                                patchNodeVec(n.id, "scale", i, e.target.value)
                              }
                              aria-label={`scale ${i}`}
                            />
                          ))}
                        </div>
                        <div className="scene-author-actions">
                          <button
                            type="button"
                            className="tiny"
                            onClick={() => setSceneRootId(n.id)}
                            disabled={isRoot}
                          >
                            Set root
                          </button>
                          <button
                            type="button"
                            className="tiny danger"
                            onClick={() => removeSceneNode(n.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {sceneDraft.length === 0 && (
              <p className="muted">No nodes — click + Add node.</p>
            )}
          </div>
        )}
        {loadError && <p className="viewer-err">{loadError}</p>}
      </div>
    </div>
  );
}
