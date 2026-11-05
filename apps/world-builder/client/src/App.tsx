/**
 * S2-F-E2 / S2-G-E2 — World-builder viewer: clip UX + importMeta + scene compose/author.
 * Compose stage=scene children by transform + defaultClip; author CRUD; no demo fallback.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, useGLTF, TransformControls } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import * as THREE from "three";
import { characterTypeBadge } from "./characterTypeBadge";
import { ErrorBoundary, ErrorCard } from "./ErrorBoundary";
import { preflightGlb, probeDump, type PreflightResult } from "./s3dErrors";
import {
  ALT_TEXT_MAX,
  CANVAS_THEME,
  MOTION_PREFS,
  RECENT_IMPORTS_LIMIT,
  THEME_PREFS,
  altTextState,
  ambiguousSlugOf,
  applySuggestedSlug,
  canvasAriaLabel,
  effectiveBlendMs,
  parseSlugClash,
  recentImports,
  relativeTime,
  resolveReducedMotion,
  resolveTheme,
  shouldAutoplay,
  sortNewestFirst,
  warningsCount,
  type MotionPref,
  type SlugClash,
  type ThemePref,
} from "./s3dPrefs";
import {
  parseRateLimited,
  rateLimitMessage,
  remainingSec,
  timingsTitle,
  type TimingsMirror,
} from "./s3eRateLimit";
import {
  SCENE_MAX_NODES_DEFAULT,
  atCap,
  capLabel,
  capTitle,
  capTone,
  deleteBlock,
  inUseHint,
  isTombstone,
  liveNodes,
  purgeConfirmText,
  purgeTombstones,
  replaceNodeAsset,
  restoreNode,
  tombstoneNode,
  tombstones,
  undoReplace,
  wireNode,
  type ReplaceUndo,
} from "./s3eScene";
import { activityVerb, bridgeBadge, systemActivityLabel, type ActivityItem, type BridgeInfo } from "./s3fActivity";
import {
  clipRequiresIssue,
  isLoopbackUrl,
  moveItem,
  requiresCaption,
  shareUrl,
  stepIndex,
  toggleRequire,
  type ClipRequiresErr,
} from "./s3fShare";
import { drawQr } from "./s3fQr";
// S3-G E2 — #36 undo/redo, #29 multi-select, #84 compare entry, #44 health nav
import {
  batchApply,
  boxSelect,
  canRedo,
  canUndo,
  centroid,
  emptyHistory,
  historyKey,
  isDirty,
  moveBy,
  pruneSel,
  pushCoalesced,
  reloadKeepsHistory,
  redo as redoStep,
  redoTitle,
  restoreCapText,
  selectAllLive,
  selectionLabel,
  skipToast,
  toggleSel,
  undo as undoStep,
  undoTitle,
  type BatchOp,
  type History,
} from "./s3gAuthor";
import { navigate, NavLink, useOverlayPlacement } from "./s3gViews";
import {
  BLEND_MS_DEFAULT,
  BLEND_MS_MAX,
  TIMESCALE_DEFAULT,
  TIMESCALE_MAX,
  TIMESCALE_MIN,
  TIMESCALE_STEP,
  CAMERAS_MAX,
  addCameraBookmark,
  blendControlEnabled,
  bonesToggleEnabled,
  clampBlendMs,
  clampTimeScale,
  clipForHotkey,
  deleteCameraBookmark,
  duplicateSceneNode,
  effectiveDurationMs,
  hotkeyLabel,
  nextCameraName,
  planCrossfade,
  renameCameraBookmark,
  resolveSceneView,
  roundVec,
  type CameraBookmark,
  type SceneView,
} from "./s3cViewer";

type ClipUx = {
  defaultClip?: string;
  order?: string[];
  disabled?: string[];
  /** S3-C #1 crossfade ms (0–1000). */
  blendMs?: number;
  /** S3-C #2 mixer timeScale (0.5–2.0). */
  timeScale?: number;
};

type SceneNodeDraft = {
  id: string;
  assetId: string;
  defaultClip?: string;
  visible?: boolean;
  /** S3-E #41 — tombstone (absent = live) */
  deleted?: boolean;
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
  /** S3-D #49/#97 warn-only import warnings */
  warnings?: Array<{ code: string; message?: string }>;
  /** S3-E #66 — optional mirror of timings.json */
  timingsMs?: TimingsMirror;
  /** S3-F #47 — .kra source basename (echo only) */
  sourceKra?: string;
};

/** S3-E #139 — which control a 429 countdown is shown under. */
type RateLimitWhere = "register" | "alt" | "actionMap" | "scene" | "assetDelete";

type AssetMeta = {
  id: string;
  slug: string;
  name: string;
  clips?: string[];
  clipUx?: ClipUx;
  importMeta?: ImportMetaView;
  formats?: { glb?: string; obj?: string; preview?: string };
  rig?: { hasArmature?: boolean; hasWeights?: boolean; boneCount?: number };
  characterType?: string;
  stage?: string;
  tags?: string[];
  clipTags?: Record<string, Array<"locomotion" | "emote" | "combat">>;
  /** S3-F #11 — clip → required clips */
  clipRequires?: Record<string, string[]>;
  clipDurations?: Record<string, number>;
  license?: string;
  /** S3-D #88 */
  altText?: string;
  /** S3-D #94 */
  createdAt?: string;
  assetSchemaVersion?: number;
  scene?: {
    version?: number;
    nodes?: Array<{
      id: string;
      assetId: string;
      defaultClip?: string;
      visible?: boolean;
      deleted?: boolean;
      transform?: {
        position?: [number, number, number];
        rotation?: [number, number, number];
        scale?: [number, number, number];
      };
    }>;
    rootId?: string;
    /** S3-C #31 */
    view?: SceneView;
    /** S3-C #32 */
    cameras?: CameraBookmark[];
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

const CONTRACT_CLIP_DESTS = [
  "idle",
  "walk",
  "run",
  "spin",
  "jump",
  "wave",
  "attack",
  "death",
  "sit",
] as const;

function isContractClipDest(name: string): boolean {
  return (
    (CONTRACT_CLIP_DESTS as readonly string[]).includes(name) ||
    (name.startsWith("emote_") && name.length > "emote_".length)
  );
}

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
    blendMs: remote.blendMs ?? local.blendMs,
    timeScale: remote.timeScale ?? local.timeScale,
  };
}

/**
 * S3-C #82 — wireframe + SkeletonHelper overlay on a cloned GLB.
 * Wireframe swaps in cloned materials (never mutates the cached GLTF materials)
 * and restores originals on toggle off. Session-only; nothing persisted.
 */
function useViewerOverlay(
  object: THREE.Object3D,
  wireframe: boolean,
  bones: boolean,
  shadows: boolean,
): THREE.SkeletonHelper | null {
  useEffect(() => {
    if (!wireframe) return;
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const clones: THREE.Material[] = [];
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      originals.set(mesh, mesh.material);
      const swap = (m: THREE.Material) => {
        const c = m.clone() as THREE.Material & { wireframe?: boolean };
        c.wireframe = true;
        clones.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    return () => {
      for (const [mesh, mat] of originals) mesh.material = mat;
      for (const c of clones) c.dispose();
    };
  }, [object, wireframe]);

  useEffect(() => {
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
      }
    });
  }, [object, shadows]);

  const helper = useMemo(() => {
    if (!bones) return null;
    let hasSkin = false;
    object.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true;
    });
    return hasSkin ? new THREE.SkeletonHelper(object) : null;
  }, [object, bones]);
  useEffect(() => () => helper?.dispose(), [helper]);
  return helper;
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
  blendMs = BLEND_MS_DEFAULT,
  timeScale = TIMESCALE_DEFAULT,
  wireframe = false,
  bones = false,
  shadows = false,
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
  blendMs?: number;
  timeScale?: number;
  wireframe?: boolean;
  bones?: boolean;
  shadows?: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const prevClipRef = useRef<string | null>(null);
  const clone = useMemo(() => scene.clone(true), [scene]);
  const skeleton = useViewerOverlay(clone, wireframe, bones, shadows);

  // S3-C #2 — timeScale on the active mixer only (clipDurations untouched).
  useEffect(() => {
    if (mixer.current) mixer.current.timeScale = clampTimeScale(timeScale);
  }, [timeScale, clone]);

  useEffect(() => {
    onError(null);
    onClips(animations.map((a) => a.name));
  }, [animations, onClips, onError]);

  useEffect(() => {
    mixer.current = new THREE.AnimationMixer(clone);
    mixer.current.timeScale = clampTimeScale(timeScale);
    return () => {
      mixer.current?.stopAllAction();
      mixer.current = null;
      actionRef.current = null;
      prevClipRef.current = null;
    };
  }, [clone]);

  useEffect(() => {
    const m = mixer.current;
    if (!m) return;
    // S3-C #1 — crossfade prev → next when the clip changes while playing.
    const prevClip = prevClipRef.current;
    prevClipRef.current = clipName || null;
    const plan = planCrossfade({
      prevClip,
      nextClip: clipName,
      blendMs,
      clipCount: animations.length,
      playing,
      scrubbing,
    });
    const prevAction = actionRef.current;
    const nextClipObj = clipName ? animations.find((a) => a.name === clipName) ?? null : null;
    if (plan.kind === "fade" && prevAction && nextClipObj) {
      const next = m.clipAction(nextClipObj);
      // keep ≤ 2 weighted actions: stop everything except outgoing + incoming
      for (const a of animations) {
        const act = m.existingAction(a);
        if (act && act !== prevAction && act !== next) act.stop();
      }
      next.reset();
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !loop;
      next.setEffectiveWeight(1);
      next.play();
      prevAction.crossFadeTo(next, plan.seconds, false);
      onDuration(nextClipObj.duration || 0);
      actionRef.current = next;
      return;
    }
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
  }, [animations, clipName, playing, loop, clone, scrubbing, scrub, onDuration, blendMs]);

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

  return (
    <>
      <primitive object={clone} />
      {skeleton ? <primitive object={skeleton} /> : null}
      <MeshStatsReporter
        object={clone}
        onStats={(s) => {
          /* bubbled via custom event on window for App to pick up cheaply */
          window.dispatchEvent(
            new CustomEvent("gp-mesh-stats", { detail: s }),
          );
        }}
      />
    </>
  );
}


/** S2-F / S3-A/B — scene child + translate/rotate/scale gizmo + snap + visibility. */
/** S3-G #29 — mounted TransformControls; a Shift+drag that starts on a hovered/dragging handle stays a gizmo drag. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const liveGizmos = new Set<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useGizmoRegistry(ref: { current: any }, deps: unknown[]) {
  useEffect(() => {
    const c = ref.current;
    if (c) liveGizmos.add(c);
    return () => {
      if (c) liveGizmos.delete(c);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
const gizmoHot = (): boolean => [...liveGizmos].some((g) => g && (g.dragging || (g.axis !== null && g.axis !== undefined)));

function snapScalar(v: number, step: number): number {
  const s = Number.isFinite(step) && step > 0 ? step : 0.25;
  return Math.round(v / s) * s;
}

function SceneNodeModel({
  url,
  clipName,
  transform,
  highlighted,
  selected,
  visible = true,
  gizmoMode = "translate",
  snapEnabled = false,
  snapStep = 0.25,
  onTransformCommit,
  wireframe = false,
  bones = false,
  shadows = false,
}: {
  url: string;
  clipName?: string;
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
  highlighted?: boolean;
  selected?: boolean;
  visible?: boolean;
  gizmoMode?: "translate" | "rotate" | "scale";
  snapEnabled?: boolean;
  snapStep?: number;
  onTransformCommit?: (next: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }) => void;
  wireframe?: boolean;
  bones?: boolean;
  shadows?: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const [groupObj, setGroupObj] = useState<THREE.Group | null>(null);
  const clone = useMemo(() => scene.clone(true), [scene]);
  const skeleton = useViewerOverlay(clone, wireframe, bones, shadows);
  const pos = transform?.position ?? ([0, 0, 0] as [number, number, number]);
  const rot = transform?.rotation ?? ([0, 0, 0] as [number, number, number]);
  const scl = transform?.scale ?? ([1, 1, 1] as [number, number, number]);
  const showGizmo = Boolean(selected && visible !== false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tcRef = useRef<any>(null);
  useGizmoRegistry(tcRef, [showGizmo, groupObj]);

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

  if (visible === false) {
    return null;
  }

  return (
    <>
      <group ref={setGroupObj} position={pos} rotation={rot} scale={scl}>
        <primitive object={clone} />
        {skeleton ? <primitive object={skeleton} /> : null}
        {highlighted ? (
          <mesh position={[0, 0.05, 0]}>
            <ringGeometry args={[0.55, 0.65, 32]} />
            <meshBasicMaterial color="#5b6cff" side={THREE.DoubleSide} />
          </mesh>
        ) : null}
      </group>
      {showGizmo && groupObj ? (
        <TransformControls
          ref={tcRef}
          object={groupObj}
          mode={gizmoMode}
          onMouseUp={() => {
            if (!groupObj || !onTransformCommit) return;
            let position: [number, number, number] = [
              groupObj.position.x,
              groupObj.position.y,
              groupObj.position.z,
            ];
            let rotation: [number, number, number] = [
              groupObj.rotation.x,
              groupObj.rotation.y,
              groupObj.rotation.z,
            ];
            const scale: [number, number, number] = [
              groupObj.scale.x,
              groupObj.scale.y,
              groupObj.scale.z,
            ];
            if (snapEnabled && gizmoMode === "translate") {
              const step = Number.isFinite(snapStep) && snapStep > 0 ? snapStep : 0.25;
              position = [
                snapScalar(position[0], step),
                snapScalar(position[1], step),
                snapScalar(position[2], step),
              ];
              groupObj.position.set(...position);
            }
            if (snapEnabled && gizmoMode === "rotate") {
              // nice-to-have: 15° increments
              const deg = Math.PI / 12;
              rotation = [
                snapScalar(rotation[0], deg),
                snapScalar(rotation[1], deg),
                snapScalar(rotation[2], deg),
              ];
              groupObj.rotation.set(...rotation);
            }
            onTransformCommit({ position, rotation, scale });
          }}
        />
      ) : null}
    </>
  );
}


/** S3-G #29 — one translate gizmo on the selection centroid; commits a shared delta on gesture end. */
function MultiGizmo({ at, onCommit }: { at: [number, number, number]; onCommit: (d: [number, number, number]) => void }) {
  const [g, setG] = useState<THREE.Group | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tcRef = useRef<any>(null);
  useGizmoRegistry(tcRef, [g]);
  useEffect(() => {
    g?.position.set(...at);
  }, [g, at[0], at[1], at[2]]);
  return (
    <>
      <group ref={setG} position={at} />
      {g ? (
        <TransformControls
          ref={tcRef}
          object={g}
          mode="translate"
          onMouseUp={() => {
            const d: [number, number, number] = [g.position.x - at[0], g.position.y - at[1], g.position.z - at[2]];
            if (d.some((x) => Math.abs(x) > 1e-9)) onCommit(d);
          }}
        />
      ) : null}
    </>
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

/** S3-D #86/#90 — matchMedia helpers (SSR/test-safe). */
function mediaMatches(query: string, fallback: boolean): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return fallback;
  return window.matchMedia(query).matches;
}
function watchMedia(query: string, set: (v: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(query);
  const on = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener("change", on);
  set(mq.matches);
  return () => mq.removeEventListener("change", on);
}

function LoadError({ message }: { message: string }) {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#a33" />
    </mesh>
  );
}

/** Walk loaded object graph for triangle + bone counts (S3-A #83). */
function MeshStatsReporter({
  object,
  onStats,
}: {
  object: THREE.Object3D;
  onStats: (s: { tris: number; bones: number }) => void;
}) {
  useEffect(() => {
    let tris = 0;
    let bones = 0;
    object.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        const g = mesh.geometry;
        const idx = g.index;
        if (idx) tris += idx.count / 3;
        else if (g.attributes.position) {
          tris += g.attributes.position.count / 3;
        }
      }
      if ((obj as THREE.Bone).isBone) bones += 1;
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && skinned.skeleton?.bones) {
        bones = Math.max(bones, skinned.skeleton.bones.length);
      }
    });
    onStats({ tris: Math.round(tris), bones });
  }, [object, onStats]);
  return null;
}


/** Normalize scene graph for dirty-diff (#23). */
function normalizeSceneSnapshot(
  nodes: Array<{
    id: string;
    assetId: string;
    defaultClip?: string;
    visible?: boolean;
    deleted?: boolean;
    transform?: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
    };
  }>,
  rootId?: string,
  view?: SceneView,
  cameras?: CameraBookmark[],
): string {
  const normNodes = nodes.map((n) => ({
    id: n.id,
    assetId: n.assetId,
    defaultClip: n.defaultClip || undefined,
    visible: n.visible !== false,
    deleted: n.deleted === true,
    transform: {
      position: (n.transform?.position ?? [0, 0, 0]) as [number, number, number],
      rotation: (n.transform?.rotation ?? [0, 0, 0]) as [number, number, number],
      scale: (n.transform?.scale ?? [1, 1, 1]) as [number, number, number],
    },
  }));
  return JSON.stringify({
    rootId: rootId ?? normNodes[0]?.id,
    nodes: normNodes,
    view: resolveSceneView(view),
    cameras: (cameras ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      target: c.target,
      fov: c.fov,
    })),
  });
}

/** S3-G CO-4 — reports the first rendered frame for `k` (the selection whose scene JSON was applied). */
function FirstFrame({ k, onFrame }: { k: string | null; onFrame: (k: string) => void }) {
  const done = useRef<string | null>(null);
  useFrame(() => {
    if (k && done.current !== k) {
      done.current = k;
      onFrame(k);
    }
  });
  return null;
}

export function App() {
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [selected, setSelected] = useState<AssetMeta | null>(null);
  // S3-D #89 — bump to re-mount the viewer boundary (Retry) after clearing the GLTF cache.
  const [viewerRetry, setViewerRetry] = useState(0);
  /** url → GLB preflight (missing/non-GLB never reaches useGLTF → no uncaught throw). */
  const [preflight, setPreflight] = useState<Record<string, PreflightResult>>({});
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
  // S3-D #127 — inline slug-clash state for the register form
  const [regClash, setRegClash] = useState<SlugClash | null>(null);
  // S3-D #94 — Recent imports (newest 20 by createdAt)
  const [recent, setRecent] = useState<AssetMeta[]>([]);
  // S3-D #88 — alt text draft for the selected asset
  const [altDraft, setAltDraft] = useState("");
  const [altSaving, setAltSaving] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  // S3-E #139 — one shared cooldown (the API bucket is per client); inline countdown, no auto-retry.
  const [rlUntil, setRlUntil] = useState(0);
  const [rlWhere, setRlWhere] = useState<RateLimitWhere | null>(null);
  const [rlNow, setRlNow] = useState(() => Date.now());
  // S3-D #86/#90 — session-only overrides (not persisted, no schema)
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [motionPref, setMotionPref] = useState<MotionPref>("system");
  const [sysDark, setSysDark] = useState(() => mediaMatches("(prefers-color-scheme: dark)", true));
  const [sysReduce, setSysReduce] = useState(() =>
    mediaMatches("(prefers-reduced-motion: reduce)", false),
  );
  const theme = resolveTheme(themePref, sysDark);
  const reducedMotion = resolveReducedMotion(motionPref, sysReduce);
  const canvasTheme = CANVAS_THEME[theme];
  const [clipUx, setClipUx] = useState<ClipUx>({});
  const [sceneNodeId, setSceneNodeId] = useState<string | null>(null);
  const [sceneDraft, setSceneDraft] = useState<SceneNodeDraft[]>([]);
  // S3-G CO-4 — data-scene-ready: scene JSON applied for this selection AND a frame rendered after it
  const [sceneAppliedFor, setSceneAppliedFor] = useState<string | null>(null);
  const [sceneFramedFor, setSceneFramedFor] = useState<string | null>(null);
  const [sceneRootId, setSceneRootId] = useState<string | undefined>(undefined);
  const [sceneSaveError, setSceneSaveError] = useState<string | null>(null);
  const [sceneSaving, setSceneSaving] = useState(false);
  // S3-G #36 — client-only undo/redo (cap 100); the save marker drives the dirty state
  const [hist, setHist] = useState<History<{ nodes: SceneNodeDraft[]; rootId: string | undefined }>>(() => emptyHistory());
  const histFor = useRef<string | null>(null);
  const draftRef = useRef<{ nodes: SceneNodeDraft[]; rootId: string | undefined }>({ nodes: [], rootId: undefined });
  // S3-G #29 — multi-select (ids; tombstones may be selected for a batch Restore)
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [batchToast, setBatchToast] = useState<string | null>(null);
  const [selBox, setSelBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // S3-G #84 — "Compare…" picker (NIT-F-1 placement)
  const [cmpOpen, setCmpOpen] = useState(false);
  const [cmpQuery, setCmpQuery] = useState("");
  const cmpBtnRef = useRef<HTMLButtonElement | null>(null);
  const cmpPopRef = useRef<HTMLDivElement | null>(null);
  const cmpPos = useOverlayPlacement(cmpOpen, cmpBtnRef, cmpPopRef, cmpQuery);
  // S3-E #38/#41/#35 — cap (from /api/health limits), deleted-row toggle, purge confirm, replace
  const [sceneMaxNodes, setSceneMaxNodes] = useState(SCENE_MAX_NODES_DEFAULT);
  const [showDeleted, setShowDeleted] = useState(true);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [replaceUndo, setReplaceUndo] = useState<ReplaceUndo | null>(null);
  const [replaceErr, setReplaceErr] = useState<string | null>(null);
  // S3-E #41 — asset delete (asset panel) with inline confirm + in-use hint
  const [assetDelConfirm, setAssetDelConfirm] = useState(false);
  const [assetDelMsg, setAssetDelMsg] = useState<string | null>(null);
  // S3-F #52 — bridge status badge; #128 activity feed (refreshes whenever the asset list reloads,
  // i.e. after every successful local mutation — no polling).
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [activity, setActivity] = useState<{ items: ActivityItem[]; total: number } | null>(null);
  const [activityErr, setActivityErr] = useState<string | null>(null);
  const [activityLimit, setActivityLimit] = useState(20);
  // S3-F #85 — share popover (QR drawn locally; base from health share.baseUrl or location.origin)
  const [shareBase, setShareBase] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  // S3-F #11 — clip requires editor (inline register/PATCH errors)
  const [reqOpen, setReqOpen] = useState<string | null>(null);
  const [reqIssue, setReqIssue] = useState<{ message: string; clips: string[] } | null>(null);
  // S3-F #140 — featured strip + editor
  const [featured, setFeatured] = useState<{ sceneIds: string[]; scenes: { id: string; slug: string; title?: string }[] } | null>(null);
  const [featIdx, setFeatIdx] = useState(0);
  const [featPaused, setFeatPaused] = useState(false);
  const [featEditOpen, setFeatEditOpen] = useState(false);
  const [featDraft, setFeatDraft] = useState<string[]>([]);
  const [featErr, setFeatErr] = useState<string | null>(null);
  // S3-F #85 — deep link ?asset=<id> / ?scene=<id> picked once the list loads
  const deepLink = useRef<string | null>(
    (() => {
      try {
        const q = new URLSearchParams(window.location.search);
        return q.get("asset") || q.get("scene");
      } catch {
        return null;
      }
    })(),
  );
  // S3-E #38 — live-node cap from the API (GET, never rate-limited); default 256 if unreachable.
  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((j: { limits?: { sceneMaxNodes?: unknown }; bridge?: unknown; share?: { baseUrl?: unknown } }) => {
        if (alive && typeof j?.share?.baseUrl === "string") setShareBase(j.share.baseUrl);
        const m = j?.limits?.sceneMaxNodes;
        if (alive && typeof m === "number" && Number.isInteger(m) && m >= 1) setSceneMaxNodes(m);
        // S3-F #52 — bridge badge from health (once; no polling)
        if (alive && j?.bridge && typeof j.bridge === "object") setBridge(j.bridge as BridgeInfo);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate" | "scale">(
    "translate",
  );
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapStep, setSnapStep] = useState(0.25);
  const [actionMapDraft, setActionMapDraft] = useState<Record<string, string>>(
    {},
  );
  const [actionMapSource, setActionMapSource] = useState<string>("unknown");
  const [actionMapDirty, setActionMapDirty] = useState(false);
  const [actionMapError, setActionMapError] = useState<string | null>(null);
  const [actionMapSaving, setActionMapSaving] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [viewerStats, setViewerStats] = useState<{
    tris: number | null;
    bones: number | null;
    clips: number;
  }>({ tris: null, bones: null, clips: 0 });
  const viewerShellRef = useRef<HTMLDivElement | null>(null);
  // S3-C #82 — session-only overlay toggles (never persisted)
  const [wireframe, setWireframe] = useState(false);
  const [showBones, setShowBones] = useState(false);
  // S3-C #31 — view toggles (scene: persisted in scene.view; non-scene: session)
  const [viewDraft, setViewDraft] = useState<Required<SceneView>>(resolveSceneView(undefined));
  // S3-C #32 — orbit bookmarks draft
  const [camerasDraft, setCamerasDraft] = useState<CameraBookmark[]>([]);
  const [cameraSel, setCameraSel] = useState<string>("");
  const [cameraErr, setCameraErr] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const clipUxTimer = useRef<number | null>(null);

  // S3-D #94 — server-sorted history; falls back to client sort if the API predates sort/limit.
  const refreshRecent = () =>
    fetch(`${API}/api/assets?sort=-createdAt&limit=${RECENT_IMPORTS_LIMIT}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data)) setRecent(recentImports(data as AssetMeta[]));
      })
      .catch(() => {
        /* panel is advisory; the main list reports API errors */
      });

  // S3-D #86/#90 — follow the OS settings live; the session selects override them.
  useEffect(() => {
    const unsubs = [
      watchMedia("(prefers-color-scheme: dark)", setSysDark),
      watchMedia("(prefers-reduced-motion: reduce)", setSysReduce),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "on";
  }, [theme, reducedMotion]);

  const refresh = () => {
    void refreshRecent();
    return fetch(`${API}/api/assets`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/assets ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setAssets(list);
        setSelected((cur) => {
          const dl = deepLink.current;
          if (dl) {
            deepLink.current = null;
            const hit = list.find((a: AssetMeta) => a.id === dl || a.slug === dl);
            if (hit) return hit;
          }
          if (cur && list.some((a: AssetMeta) => a.id === cur.id)) {
            return list.find((a: AssetMeta) => a.id === cur.id) ?? cur;
          }
          return list[0] ?? null;
        });
        setError(null);
      })
      .catch((err) => setError(String(err)));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setAltDraft(selected?.altText ?? "");
    setAltError(null);
  }, [selected?.id, selected?.altText]);
  useEffect(() => {
    setAssetDelConfirm(false);
    setAssetDelMsg(null);
  }, [selected?.id]);

  useEffect(() => {
    if (rlUntil <= Date.now()) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      setRlNow(now);
      if (now >= rlUntil) window.clearInterval(t);
    }, 250);
    return () => window.clearInterval(t);
  }, [rlUntil]);
  const rlLeft = remainingSec(rlUntil, rlNow);
  /** true (and countdown armed) when `r` is a 429 RATE_LIMITED. */
  const noteRateLimit = (r: Response, text: string, where: RateLimitWhere): boolean => {
    const sec = parseRateLimited(r.status, text, r.headers.get("Retry-After"));
    if (sec == null) return false;
    const now = Date.now();
    setRlNow(now);
    setRlUntil(now + sec * 1000);
    setRlWhere(where);
    return true;
  };
  const rateLimitNote = (where: RateLimitWhere) =>
    rlLeft > 0 && rlWhere === where ? (
      <p className="err rate-limited" role="status" aria-live="polite" data-testid="rate-limited">
        {rateLimitMessage(rlLeft)}
      </p>
    ) : null;

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/activity?limit=${activityLimit}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j || !Array.isArray(j.items)) {
          setActivityErr(j?.code ?? `HTTP ${r.status}`);
          return;
        }
        setActivityErr(null);
        setActivity({ items: j.items as ActivityItem[], total: Number(j.total) || j.items.length });
      })
      .catch(() => alive && setActivityErr("NETWORK"));
    return () => {
      alive = false;
    };
  }, [assets, activityLimit]);

  // S3-F #140 — featured list (GET; stale ids are simply not shown)
  const loadFeatured = useCallback(() => {
    fetch(`${API}/api/featured`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && Array.isArray(j.scenes)) setFeatured({ sceneIds: j.sceneIds ?? [], scenes: j.scenes });
      })
      .catch(() => {});
  }, []);
  useEffect(() => loadFeatured(), [assets, loadFeatured]);
  const featN = featured?.scenes.length ?? 0;
  useEffect(() => {
    if (featN < 2 || reducedMotion || featPaused || featEditOpen) return;
    const t = window.setInterval(() => setFeatIdx((i) => stepIndex(i, 1, featN)), 8000);
    return () => window.clearInterval(t);
  }, [featN, reducedMotion, featPaused, featEditOpen]);
  const featCur = featN ? featured!.scenes[Math.min(featIdx, featN - 1)] : null;
  const goFeatured = (dir: -1 | 1) => {
    if (!featN) return;
    const i = stepIndex(Math.min(featIdx, featN - 1), dir, featN);
    setFeatIdx(i);
    const hit = assets.find((a) => a.id === featured!.scenes[i].id);
    if (hit) setSelected(hit);
  };
  async function saveFeatured() {
    setFeatErr(null);
    try {
      const r = await fetch(`${API}/api/featured`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIds: featDraft }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setFeatErr(
          j?.code === "FEATURED_INVALID"
            ? `FEATURED_INVALID (${j.reason}): ${(j.invalid ?? []).join(", ") || j.error}`
            : j?.code === "RATE_LIMITED"
              ? `RATE_LIMITED: retry in ${j.retryAfterSec ?? "a few"}s`
              : `${j?.code ?? `HTTP ${r.status}`}: ${j?.error ?? "save failed"}`,
        );
        return;
      }
      setFeatEditOpen(false);
      setFeatIdx(0);
      loadFeatured();
    } catch {
      setFeatErr("NETWORK: save failed");
    }
  }

  // S3-F #85 — share URL for the selected asset/scene; QR drawn when the popover opens (no request)
  const shareLink = selected
    ? shareUrl(shareBase ?? window.location.origin, selected.stage === "scene" ? "scene" : "asset", selected.id)
    : "";
  useEffect(() => {
    if (shareOpen && qrRef.current && shareLink) drawQr(qrRef.current, shareLink, 168);
  }, [shareOpen, shareLink]);
  // NIT-F-1 — keep the share popover inside the viewport (8px margin): clamp left, prefer below,
  // flip above; < 600px wide it becomes a bottom sheet (CSS). Recomputed on resize/scroll.
  const shareBtnRef = useRef<HTMLButtonElement | null>(null);
  const sharePopRef = useRef<HTMLDivElement | null>(null);
  const [sharePos, setSharePos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!shareOpen) return;
    const place = () => {
      const btn = shareBtnRef.current, pop = sharePopRef.current;
      if (!btn || !pop) return;
      const vw = window.innerWidth, vh = window.innerHeight, M = 8;
      if (vw < 600) { setSharePos({}); return; }
      const b = btn.getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      const left = Math.max(M, Math.min(b.right - w, vw - w - M));
      let top = b.bottom + 4;
      if (top + h > vh - M) top = b.top - 4 - h >= M ? b.top - 4 - h : Math.max(M, vh - h - M);
      setSharePos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shareOpen, shareLink]);
  useEffect(() => {
    setShareOpen(false);
    setReqOpen(null);
    setReqIssue(null);
  }, [selected?.id]);

  // S3-F #11 — save one clip's requires (PATCH clipRequires; errors inline, save stays enabled)
  async function saveClipRequires(next: Record<string, string[]>) {
    if (!selected) return;
    setReqIssue(null);
    try {
      const r = await fetch(`${API}/api/assets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipRequires: Object.keys(next).length ? next : null }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setReqIssue(clipRequiresIssue((j ?? { code: `HTTP_${r.status}` }) as ClipRequiresErr));
        return;
      }
      setAssets((list) => list.map((a) => (a.id === j.id ? { ...a, ...j, clipRequires: j.clipRequires } : a)));
      setSelected((cur) => (cur && cur.id === j.id ? { ...cur, ...j, clipRequires: j.clipRequires } : cur));
    } catch {
      setReqIssue({ message: "NETWORK: save failed", clips: [] });
    }
  }

  async function deleteSelectedAsset() {
    if (!selected) return;
    const target = selected;
    try {
      const r = await fetch(`${API}/api/assets/${target.id}`, { method: "DELETE" });
      const text = r.status === 204 ? "" : await r.text();
      if (noteRateLimit(r, text, "assetDelete")) return;
      if (r.status === 204) {
        setAssetDelConfirm(false);
        setAssetDelMsg(null);
        setSelected(null);
        await refresh();
        return;
      }
      let j: { code?: string; error?: string; refs?: string[]; deletedRefs?: string[] } | null = null;
      try {
        j = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      const name = (id: string) => assets.find((a) => a.id === id)?.slug ?? id.slice(0, 8);
      setAssetDelMsg(
        inUseHint(j, name) ??
          (j?.code === "ASSET_IN_USE"
            ? `Used by scene(s) ${(j.refs ?? []).map(name).join(", ")} — remove those nodes first`
            : `${j?.code ?? r.status}: ${j?.error ?? "delete failed"}`),
      );
      setAssetDelConfirm(false);
    } catch (err) {
      setAssetDelMsg(`Delete failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function saveAltText() {
    if (!selected) return;
    const st = altTextState(altDraft);
    if (st.over) return;
    setAltSaving(true);
    setAltError(null);
    try {
      const r = await fetch(`${API}/api/assets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ altText: st.trimmed }),
      });
      const text = await r.text();
      if (noteRateLimit(r, text, "alt")) return;
      if (!r.ok) {
        let msg = `${r.status}`;
        try {
          const j = JSON.parse(text);
          msg = `${j.code ?? r.status}: ${j.error ?? ""}`;
        } catch {
          /* keep status */
        }
        throw new Error(msg);
      }
      await refresh();
    } catch (err) {
      setAltError(`Alt text not saved — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAltSaving(false);
    }
  }

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
    setActionMapDraft({ ...(selected.importMeta?.actionMap ?? {}) });
    setActionMapSource(selected.importMeta?.source ?? "unknown");
    setActionMapDirty(false);
    setActionMapError(null);
    if (selected.stage === "scene") {
      const nodes = (selected.scene?.nodes ?? []).map((n) => ({
        id: n.id,
        assetId: n.assetId,
        defaultClip: n.defaultClip,
        visible: n.visible !== false,
        ...(n.deleted === true ? { deleted: true } : {}),
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
      // S3-G #36 (Leader ruling) — a server reload that would REPLACE the draft clears the undo/redo
      // stack and resets the save marker; a reload that leaves the draft untouched (same scene, same
      // nodes — e.g. our own Save echo or a list refresh) keeps history and the draft as-is.
      const keep = reloadKeepsHistory(
        histFor.current === selected.id,
        normalizeSceneSnapshot(draftRef.current.nodes, draftRef.current.rootId),
        normalizeSceneSnapshot(nodes, selected.scene?.rootId ?? nodes[0]?.id),
      );
      if (!keep) {
      histFor.current = selected.id;
      setHist(emptyHistory());
      setMultiSel([]);
      setBatchToast(null);
      setSceneDraft(nodes as SceneNodeDraft[]);
      setViewDraft(resolveSceneView(selected.scene?.view));
      setCamerasDraft((selected.scene?.cameras ?? []).map((c) => ({ ...c })));
      setCameraSel("");
      setCameraErr(null);
      setSceneRootId(selected.scene?.rootId ?? nodes[0]?.id);
      setSceneNodeId(selected.scene?.rootId ?? liveNodes(nodes)[0]?.id ?? null);
      setSceneSaveError(null);
      setReplaceUndo(null);
      setReplaceOpen(false);
      setPurgeConfirm(false);
      }
    } else {
      setSceneDraft([]);
      setCamerasDraft([]);
      setSceneRootId(undefined);
      setSceneNodeId(null);
      setSceneSaveError(null);
    }
    setSceneAppliedFor(selected?.id ?? null);
    // non-scene selection: a switch clears the stack
    if (selected.stage !== "scene" && histFor.current !== (selected?.id ?? null)) {
      histFor.current = selected?.id ?? null;
      setHist(emptyHistory());
      setMultiSel([]);
      setBatchToast(null);
    }
  }, [selected?.id, selected?.clipUx, selected?.stage, selected?.scene]);

  useEffect(() => {
    const next = pickDefaultClip(clipsForUi, clipUx);
    setClip(next);
    // S3-D #90 — no autoplay when motion is reduced (the user presses Play)
    setPlaying(shouldAutoplay(next.length > 0, reducedMotion));
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

  // S3-C #1 / #2 — viewer blend + speed, persisted via clip-ux PATCH (debounced).
  const blendMs = clampBlendMs(clipUx.blendMs ?? BLEND_MS_DEFAULT);
  const timeScale = clampTimeScale(clipUx.timeScale ?? TIMESCALE_DEFAULT);
  const setPlaybackPref = (patch: Partial<Pick<ClipUx, "blendMs" | "timeScale">>) => {
    const next: ClipUx = { ...clipUx, ...patch };
    setClipUx(next);
    if (clipUxTimer.current) window.clearTimeout(clipUxTimer.current);
    clipUxTimer.current = window.setTimeout(() => void persistClipUx(next), 300);
  };

  const selectClip = useCallback((name: string) => {
    setClip(name);
    setPlaying(true);
    setScrub(0);
  }, []);

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
  // S3-E #41 — tombstoned nodes are never rendered / preflighted / gizmo-selectable.
  const sceneNodes = liveNodes(isScene && sceneDraft.length > 0 ? sceneDraft : selected?.scene?.nodes ?? []);
  const liveCount = liveNodes(sceneDraft).length;
  const deletedCount = sceneDraft.length - liveCount;
  const capReached = atCap(sceneDraft, sceneMaxNodes);
  const nonSceneAssets = useMemo(
    () => assets.filter((a) => a.stage !== "scene"),
    [assets],
  );

  // S3-G #36 — every draft edit is one step {label, before, after}; nothing reaches the server until Save
  const commitDraft = (label: string, nodes: SceneNodeDraft[], rootId: string | undefined = sceneRootId, key?: string) => {
    const before = { nodes: sceneDraft, rootId: sceneRootId };
    setHist((h) => pushCoalesced(h, { label, before, after: { nodes, rootId }, key }));
    setSceneDraft(nodes);
    if (rootId !== sceneRootId) setSceneRootId(rootId);
  };
  const applySnap = (st: { nodes: SceneNodeDraft[]; rootId: string | undefined }) => {
    setSceneDraft(st.nodes);
    setSceneRootId(st.rootId);
    setMultiSel((sel) => pruneSel(sel, st.nodes));
    setSceneNodeId((cur) => (cur && st.nodes.some((n) => n.id === cur && !isTombstone(n)) ? cur : st.rootId ?? liveNodes(st.nodes)[0]?.id ?? null));
    setReplaceUndo(null);
  };
  const doUndo = () => {
    const r = undoStep(hist);
    if (!r) return;
    setHist(r.history);
    applySnap(r.state);
  };
  const doRedo = () => {
    const r = redoStep(hist);
    if (!r) return;
    setHist(r.history);
    applySnap(r.state);
  };
  const multiLive = multiSel.filter((id) => sceneDraft.some((n) => n.id === id && !isTombstone(n)));
  const multiCentroid = multiLive.length > 1 ? centroid(sceneDraft, multiLive) : null;
  const OP_LABEL: Record<BatchOp, string> = { hide: "Hide", show: "Show", delete: "Delete", restore: "Restore" };
  const runBatch = (op: BatchOp) => {
    const res = batchApply(sceneDraft, multiSel, op, sceneRootId ?? sceneDraft[0]?.id, sceneMaxNodes);
    if (res.error) {
      setBatchToast(res.error.startsWith("SCENE_NODES_MAX") ? restoreCapText(sceneMaxNodes) : res.error.replace(/^[A-Z_]+: /, ""));
      return;
    }
    if (res.changed.length > 0) {
      commitDraft(`${OP_LABEL[op]} ${res.changed.length} node${res.changed.length === 1 ? "" : "s"}`, res.nodes);
      if (op === "delete" && sceneNodeId && res.changed.includes(sceneNodeId)) setSceneNodeId(sceneRootId ?? null);
    }
    setBatchToast(skipToast(op, res.skipped));
  };
  const moveSelection = (d: [number, number, number]) => {
    commitDraft(`Move ${multiLive.length} nodes`, moveBy(sceneDraft, multiLive, d));
  };
  // S3-G #29 — drag box (Shift+drag on the empty canvas; plain drag keeps orbiting)
  const boxStart = useRef<{ x: number; y: number } | null>(null);
  const onCanvasPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!isScene || !e.shiftKey || e.button !== 0) return;
    if ((e.target as HTMLElement).tagName !== "CANVAS") return;
    if (gizmoHot()) return; // on a gizmo handle → gizmo drag, never a box
    if (controlsRef.current) controlsRef.current.enabled = false;
    const r = e.currentTarget.getBoundingClientRect();
    boxStart.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setSelBox({ x0: boxStart.current.x, y0: boxStart.current.y, x1: boxStart.current.x, y1: boxStart.current.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const boxIds = (box: { x0: number; y0: number; x1: number; y1: number }, el: HTMLElement) => {
    const cam = controlsRef.current?.object as THREE.Camera | undefined;
    if (!cam) return [] as string[];
    const r = el.getBoundingClientRect();
    const pts = liveNodes(sceneDraft).map((n) => {
      const v = new THREE.Vector3(...(n.transform?.position ?? [0, 0, 0])).project(cam);
      return { id: n.id, x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
    });
    return boxSelect(pts, box);
  };
  const onCanvasPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!boxStart.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    setSelBox({ x0: boxStart.current.x, y0: boxStart.current.y, x1: e.clientX - r.left, y1: e.clientY - r.top });
  };
  const onCanvasPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!boxStart.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const box = { x0: boxStart.current.x, y0: boxStart.current.y, x1: e.clientX - r.left, y1: e.clientY - r.top };
    boxStart.current = null;
    setSelBox(null);
    if (controlsRef.current) controlsRef.current.enabled = true;
    const ids = boxIds(box, e.currentTarget);
    setMultiSel(ids);
    if (ids.length === 1) setSceneNodeId(ids[0]);
  };
  draftRef.current = { nodes: sceneDraft, rootId: sceneRootId };
  const keysRef = useRef({ undo: doUndo, redo: doRedo, nodes: sceneDraft });
  keysRef.current = { undo: doUndo, redo: doRedo, nodes: sceneDraft };
  useEffect(() => {
    if (!isScene) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const k = historyKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, target: t });
      if (k) {
        e.preventDefault();
        if (k === "undo") keysRef.current.undo();
        else keysRef.current.redo();
        return;
      }
      const tag = (t?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setMultiSel(selectAllLive(keysRef.current.nodes));
      } else if (e.key === "Escape") {
        setMultiSel([]);
        setBatchToast(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isScene]);

  const newNodeId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `n-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  const addSceneNode = () => {
    if (atCap(sceneDraft, sceneMaxNodes)) {
      setSceneSaveError(`SCENE_NODES_MAX: ${capTitle(sceneMaxNodes)}`);
      return;
    }
    const first = nonSceneAssets[0];
    const id = newNodeId();
    const prev = sceneDraft;
    commitDraft("Add node", [
      ...prev,
      {
        id,
        assetId: first?.id ?? first?.slug ?? "",
        visible: true,
        transform: {
          position: [liveNodes(prev).length * 2, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ], sceneRootId ?? id);
    setSceneNodeId(id);
  };

  // S3-E #41 — Delete = tombstone (keeps id + transform); root / last live node are blocked.
  const removeSceneNode = (id: string) => {
    const res = tombstoneNode(sceneDraft, id, sceneRootId ?? sceneDraft[0]?.id);
    if ("error" in res) {
      setSceneSaveError(res.error);
      return;
    }
    commitDraft("Delete node", res.nodes);
    if (sceneNodeId === id) setSceneNodeId(sceneRootId ?? liveNodes(res.nodes)[0]?.id ?? null);
    if (replaceUndo?.nodeId === id) setReplaceUndo(null);
    setReplaceOpen(false);
    setSceneSaveError(null);
  };
  const restoreSceneNode = (id: string) => {
    const res = restoreNode(sceneDraft, id, sceneMaxNodes);
    if ("error" in res) {
      setSceneSaveError(res.error);
      return;
    }
    commitDraft("Restore node", res.nodes);
    setSceneSaveError(null);
  };
  const purgeDeleted = () => {
    commitDraft("Purge deleted", purgeTombstones(sceneDraft));
    setPurgeConfirm(false);
  };
  // S3-E #35 — Replace asset… keeps id / transform / visible; one undo step until Save.
  const replaceSelectedAsset = (target: AssetMeta) => {
    if (!sceneNodeId || !selected) return;
    const res = replaceNodeAsset(sceneDraft, sceneNodeId, target, selected.id);
    if ("error" in res) {
      setReplaceErr(res.error);
      return;
    }
    commitDraft("Replace asset", res.nodes);
    setReplaceUndo(res.undo);
    setReplaceErr(null);
    setReplaceOpen(false);
    setReplaceQuery("");
  };

  // S3-C #26 — duplicate selected node (new id, +0.5 X or +snap step).
  const duplicateSelectedNode = () => {
    if (!sceneNodeId) return;
    if (isTombstone(sceneDraft.find((n) => n.id === sceneNodeId))) return;
    if (atCap(sceneDraft, sceneMaxNodes)) {
      setSceneSaveError(`SCENE_NODES_MAX: ${capTitle(sceneMaxNodes)}`);
      return;
    }
    const res = duplicateSceneNode(sceneDraft, sceneNodeId, {
      newId: newNodeId(),
      snapEnabled,
      snapStep,
    });
    if ("error" in res) {
      setSceneSaveError(res.error);
      return;
    }
    commitDraft("Duplicate node", res.nodes as SceneNodeDraft[]);
    setSceneNodeId(res.node.id);
    setSceneSaveError(null);
  };

  // S3-C #32 — orbit bookmarks
  const saveCameraView = () => {
    const ctl = controlsRef.current;
    const cam = ctl?.object as THREE.PerspectiveCamera | undefined;
    if (!ctl || !cam) {
      setCameraErr("camera controls not ready");
      return;
    }
    const res = addCameraBookmark(camerasDraft, {
      id: newNodeId(),
      name: nextCameraName(camerasDraft),
      position: roundVec([cam.position.x, cam.position.y, cam.position.z]),
      target: roundVec([ctl.target.x, ctl.target.y, ctl.target.z]),
      fov: typeof cam.fov === "number" ? Math.round(cam.fov) : undefined,
    });
    if ("error" in res) {
      setCameraErr(res.error);
      return;
    }
    setCamerasDraft(res.cameras);
    setCameraSel(res.cameras[res.cameras.length - 1].id);
    setCameraErr(null);
  };
  // S3-D #90 — bookmark jumps are always instant (set + update, no tween), so reduced motion
  // needs no special case here; OrbitControls damping is disabled when reduced.
  const jumpToCamera = (id: string) => {
    setCameraSel(id);
    const c = camerasDraft.find((x) => x.id === id);
    const ctl = controlsRef.current;
    const cam = ctl?.object as THREE.PerspectiveCamera | undefined;
    if (!c || !ctl || !cam) return;
    cam.position.set(...c.position);
    if (typeof c.fov === "number") {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    ctl.target.set(...c.target);
    ctl.update();
  };
  const renameCamera = (id: string, name: string) => {
    const res = renameCameraBookmark(camerasDraft, id, name);
    if ("error" in res) {
      setCameraErr(res.error);
      return;
    }
    setCamerasDraft(res.cameras);
    setCameraErr(null);
  };
  const deleteCamera = (id: string) => {
    setCamerasDraft((prev) => deleteCameraBookmark(prev, id));
    if (cameraSel === id) setCameraSel("");
  };

  const patchSceneNode = (id: string, patch: Partial<SceneNodeDraft>) => {
    commitDraft(
      "visible" in patch ? (patch.visible === false ? "Hide node" : "Show node") : "Edit node",
      sceneDraft.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      sceneRootId,
      "visible" in patch ? undefined : `patch:${id}:${Object.keys(patch).sort().join(",")}`,
    );
  };

  const patchNodeVec = (
    id: string,
    key: "position" | "rotation" | "scale",
    idx: 0 | 1 | 2,
    raw: string,
  ) => {
    let num = Number(raw);
    if (!Number.isFinite(num)) return;
    if (key === "position" && snapEnabled) {
      const step = Number.isFinite(snapStep) && snapStep > 0 ? snapStep : 0.25;
      num = snapScalar(num, step);
    }
    commitDraft(
      `Edit ${key}`,
      sceneDraft.map((n) => {
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
      sceneRootId,
      `vec:${id}:${key}:${idx}`,
    );
  };


  const persistActionMap = async () => {
    if (!selected) return;
    // Validate dests
    for (const [src, dest] of Object.entries(actionMapDraft)) {
      if (!src.trim()) {
        setActionMapError("actionMap key cannot be empty");
        return;
      }
      if (!isContractClipDest(dest)) {
        setActionMapError(
          `importMeta.actionMap.${src}: "${dest}" is not a contract clip name`,
        );
        return;
      }
    }
    setActionMapSaving(true);
    setActionMapError(null);
    try {
      const importMeta = {
        ...(selected.importMeta ?? {}),
        source: (actionMapSource ||
          selected.importMeta?.source ||
          "unknown") as string,
        actionMap: { ...actionMapDraft },
      };
      const r = await fetch(`${API}/api/assets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importMeta }),
      });
      const textBody = await r.text();
      if (noteRateLimit(r, textBody, "actionMap")) return;
      if (!r.ok) throw new Error(`${r.status} ${textBody}`);
      const updated = JSON.parse(textBody) as AssetMeta;
      setAssets((list) =>
        list.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      );
      setSelected((cur) =>
        cur && cur.id === updated.id ? { ...cur, ...updated } : cur,
      );
      setActionMapDirty(false);
    } catch (err) {
      setActionMapError(`Save actionMap failed: ${err}`);
    } finally {
      setActionMapSaving(false);
    }
  };

  const persistScene = async () => {
    if (!selected || selected.stage !== "scene") return;
    const savedIdx = hist.index;
    if (liveNodes(sceneDraft).length < 1) {
      setSceneSaveError("SCENE_NO_LIVE_NODES: a scene needs at least one live node");
      return;
    }
    if (liveNodes(sceneDraft).some((n) => !n.assetId.trim())) {
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
          // S3-E #41 — tombstones travel as `deleted: true`; Save never purges.
          nodes: sceneDraft.map((n) => wireNode(n)),
          view: { ground: viewDraft.ground, shadows: viewDraft.shadows },
          cameras: camerasDraft,
        },
      };
      // PATCH only (#23 R1 nit): 4xx must surface — never silent POST fallback.
      const r = await fetch(`${API}/api/assets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: body.scene }),
      });
      const textBody = await r.text();
      if (noteRateLimit(r, textBody, "scene")) return;
      if (!r.ok) {
        try {
          const j = JSON.parse(textBody) as { code?: string; max?: number };
          if (j.code === "SCENE_NODES_MAX" && typeof j.max === "number") setSceneMaxNodes(j.max);
        } catch {
          /* non-JSON */
        }
        throw new Error(`${r.status} ${textBody}`);
      }
      setReplaceUndo(null);
      // S3-G #36 — Save keeps the stack; the marker sits on the step that was saved
      setHist((h) => ({ ...h, marker: Math.min(savedIdx, h.steps.length) }));
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
  // S3-D #89 — preflight every GLB the viewer is about to load (single asset or scene children).
  const viewerGlbUrls = useMemo(() => {
    if (!selected) return [] as string[];
    if (!isScene) return glbUrl ? [glbUrl] : [];
    const out: string[] = [];
    for (const n of sceneNodes) {
      const c = resolveChild(n.assetId);
      if (c?.formats?.glb) out.push(`${API}/api/assets/${c.id}/file`);
    }
    return [...new Set(out)];
  }, [selected, isScene, glbUrl, sceneNodes, resolveChild]);
  const viewerGlbKey = viewerGlbUrls.join("|");
  useEffect(() => {
    let alive = true;
    for (const u of viewerGlbUrls) {
      if (preflight[u]) continue;
      preflightGlb(u).then((r) => {
        if (alive) setPreflight((prev) => (prev[u] ? prev : { ...prev, [u]: r }));
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerGlbKey, viewerRetry]);
  const singlePreflight = glbUrl ? preflight[glbUrl] : undefined;

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
      if (noteRateLimit(r, text, "register")) return;
      // S3-D #127 — keep the form and its values; show the inline clash + suggestion
      const clash = parseSlugClash(r.status, text);
      if (clash) {
        setRegClash(clash);
        return;
      }
      if (!r.ok) throw new Error(`${r.status} ${text}`);
      setRegClash(null);
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


  // S3-A #83 — derive stats from metadata + live mesh probe.
  useEffect(() => {
    if (!selected) {
      setViewerStats({ tris: null, bones: null, clips: 0 });
      return;
    }
    const clips = (selected.clips ?? gltfClips ?? []).length;
    const bones =
      typeof selected.rig?.boneCount === "number"
        ? selected.rig.boneCount
        : selected.rig?.hasArmature
          ? null
          : 0;
    setViewerStats({ tris: null, bones, clips });
  }, [selected, gltfClips]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tris: number; bones: number }>).detail;
      if (!detail) return;
      setViewerStats((prev) => ({
        tris: detail.tris,
        bones:
          typeof selected?.rig?.boneCount === "number"
            ? selected.rig.boneCount
            : detail.bones || prev.bones,
        clips: prev.clips,
      }));
    };
    window.addEventListener("gp-mesh-stats", handler);
    return () => window.removeEventListener("gp-mesh-stats", handler);
  }, [selected?.rig?.boneCount]);

  const toggleFullscreen = useCallback(async () => {
    const el = viewerShellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* fullscreen blocked — ignore */
    }
  }, []);



  // S3-G #36 — nodes/root dirty = current step ≠ save marker; view + cameras still diff against saved
  const sceneDirty = useMemo(() => {
    if (!isScene || !selected) return false;
    if (isDirty(hist)) return true;
    const draftSnap = normalizeSceneSnapshot([], undefined, viewDraft, camerasDraft);
    const savedSnap = normalizeSceneSnapshot([], undefined, selected.scene?.view, selected.scene?.cameras);
    return draftSnap !== savedSnap;
  }, [isScene, selected, hist, viewDraft, camerasDraft]);

  // S3-C #80 — hotkeys 1..9 select the n-th CLIP in displayed order (viewer only).
  useEffect(() => {
    if (isScene || clipsForUi.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const name = clipForHotkey(clipsForUi, {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        target: e.target as HTMLElement | null,
      });
      if (!name) return;
      e.preventDefault();
      selectClip(name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isScene, clipsForUi, selectClip]);

  const bonesAvailable = bonesToggleEnabled(
    selected?.rig?.boneCount ?? viewerStats.bones,
    Boolean(selected?.rig?.hasArmature) || isScene,
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Graphics World Builder</h1>
        <p className="muted">localhost · Sprint 3-D</p>
        {(() => {
          const bb = bridgeBadge(bridge);
          return (
            <p className={`bridge-badge bridge-${bb.tone}`} data-testid="bridge-badge" title={bb.title} role="status">
              <span aria-hidden="true">{bb.icon}</span> {bridge ? bb.text : "Krita: checking…"}
            </p>
          );
        })()}
        <nav className="side-nav" aria-label="Pages">
          <NavLink to="/health" className="tiny nav-link" testId="nav-health">Health</NavLink>
        </nav>
        <input
          ref={searchInputRef}
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
                {(() => {
                  const b = characterTypeBadge(a);
                  return (
                    <span
                      className={`badge ctype ctype-${b.tone}`}
                      data-testid="ctype-badge"
                      title={`characterType: ${b.label}`}
                    >
                      {b.label}
                    </span>
                  );
                })()}
              </button>
            </li>
          ))}
        </ul>
        <details className="recent-imports" open data-testid="recent-imports">
          <summary>Recent imports</summary>
          {recent.length === 0 ? (
            <p className="muted">No imports yet.</p>
          ) : (
            <ol aria-label="Recent imports">
              {recent.map((a) => {
                const b = characterTypeBadge(a);
                const n = warningsCount(a);
                // S3-D #94 + S3-E #66 — total import time tooltip when the timings mirror exists
                const tt = timingsTitle(a.importMeta?.timingsMs);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="recent-row"
                      title={tt ?? undefined}
                      data-testid="recent-import-row"
                      onClick={() => {
                        const live = assets.find((x) => x.id === a.id) ?? a;
                        setSelected(live);
                        setLoadError(null);
                        setGltfClips([]);
                      }}
                    >
                      <span>{a.name || a.slug}</span>
                      <span className="muted">· {a.stage ?? "—"}</span>
                      <span className={`badge ctype ctype-${b.tone}`}>{b.label}</span>
                      {n > 0 ? (
                        <span className="recent-warn" title={`${n} import warning(s)`}>
                          ⚠ {n}
                        </span>
                      ) : null}
                      <span className="muted recent-time" title={a.createdAt ?? "no createdAt (legacy)"}>
                        {relativeTime(a.createdAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </details>
        {/* S3-F #128 — Activity (D1 §1): newest first, relative time with ISO title, slug links */}
        <details className="activity-panel" open data-testid="activity-panel">
          <summary>Activity{activity ? ` (${activity.total})` : ""}</summary>
          {activityErr ? (
            <p className="err" role="alert">
              Activity unavailable ({activityErr})
            </p>
          ) : !activity ? (
            <p className="muted">Loading…</p>
          ) : activity.items.length === 0 ? (
            <p className="muted">No activity yet.</p>
          ) : (
            <ol aria-label="Activity">
              {activity.items.map((it, k) => {
                const sys = systemActivityLabel(it);
                if (sys !== null) {
                  return (
                    <li key={`${it.at}-${it.kind}-${k}`} data-testid="activity-row" className="activity-row activity-system muted">
                      <time dateTime={it.at} title={it.at} className="muted">
                        {relativeTime(it.at)}
                      </time>{" "}
                      <span data-testid="activity-system">{sys}</span>
                    </li>
                  );
                }
                const target = assets.find((a) => a.id === it.id);
                const label = it.slug ?? (it.id ?? "").slice(0, 8);
                return (
                  <li key={`${it.at}-${it.id}-${k}`} data-testid="activity-row" className="activity-row">
                    <time dateTime={it.at} title={it.at} className="muted">
                      {relativeTime(it.at)}
                    </time>{" "}
                    <span>{activityVerb(it.kind)}</span>{" "}
                    {target ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => {
                          setSelected(target);
                          setLoadError(null);
                          setGltfClips([]);
                        }}
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="activity-gone" title="no longer exists">
                        {label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {activity && activityLimit < 100 && activity.total > activity.items.length && (
            <button type="button" className="tiny" data-testid="activity-more" onClick={() => setActivityLimit(100)}>
              Show more
            </button>
          )}
        </details>
        <button type="button" className="primary" onClick={() => setRegisterOpen((o) => !o)}>
          Register asset
        </button>
        {registerOpen && (
          <div className="register">
            <textarea
              rows={10}
              placeholder='Paste Asset JSON (id, slug, clips, formats…)'
              value={regJson}
              aria-label="Asset JSON"
              onChange={(e) => setRegJson(e.target.value)}
            />
            {regClash && (
              <div className="slug-clash" role="alert" data-testid="slug-clash">
                <span>
                  <code>{regClash.slug}</code> is already used by <code>{regClash.existingId}</code>
                </span>
                <button
                  type="button"
                  className="tiny primary"
                  data-testid="slug-clash-suggest"
                  onClick={() => {
                    setRegJson((j) => applySuggestedSlug(j, regClash.suggestedSlug));
                    setRegClash(null);
                  }}
                >
                  Use {regClash.suggestedSlug}
                </button>
              </div>
            )}
            {rateLimitNote("register")}
            <button type="button" data-testid="register-submit" disabled={rlLeft > 0} onClick={submitRegister}>
              POST /api/assets
            </button>
          </div>
        )}
      </aside>
      <div
        className="viewer"
        ref={viewerShellRef}
        data-testid="viewer-root"
        data-scene-ready={selected && sceneAppliedFor === selected.id && sceneFramedFor === selected.id ? "1" : "0"}
      >
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
          <div className="viewer-chrome">
            {selected && (
              <span className="share-wrap">
                <button
                  type="button"
                  className="tiny"
                  aria-expanded={shareOpen}
                  data-testid="share-button"
                  ref={shareBtnRef}
                  onClick={() => {
                    setShareCopied(false);
                    setShareOpen((o) => !o);
                  }}
                >
                  Share
                </button>
                {shareOpen && (
                  <div className="share-pop" ref={sharePopRef} style={sharePos} data-testid="share-pop" role="dialog" aria-label="Share link">
                    <canvas
                      ref={qrRef}
                      data-testid="share-qr"
                      role="img"
                      aria-label={`QR code for ${shareLink}`}
                      width={168}
                      height={168}
                    />
                    <input className="share-url" readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} aria-label="Share URL" />
                    <button
                      type="button"
                      className="tiny"
                      data-testid="share-copy"
                      onClick={() => {
                        void navigator.clipboard?.writeText(shareLink).then(() => setShareCopied(true), () => setShareCopied(false));
                      }}
                    >
                      {shareCopied ? "Copied" : "Copy link"}
                    </button>
                    {isLoopbackUrl(shareLink) && (
                      <p className="muted share-hint" data-testid="share-hint-loopback">
                        This link only works on this device.
                      </p>
                    )}
                  </div>
                )}
              </span>
            )}
            {selected && (
              <span className="share-wrap">
                <button
                  type="button"
                  className="tiny"
                  aria-expanded={cmpOpen}
                  data-testid="compare-open"
                  ref={cmpBtnRef}
                  onClick={() => {
                    setCmpQuery("");
                    setCmpOpen((o) => !o);
                  }}
                >
                  Compare…
                </button>
                {cmpOpen && (
                  <div className="share-pop compare-picker" ref={cmpPopRef} style={cmpPos} data-testid="compare-picker" role="dialog" aria-label="Compare with">
                    <input
                      className="search"
                      placeholder="Compare with…"
                      aria-label="Filter assets to compare"
                      value={cmpQuery}
                      onChange={(e) => setCmpQuery(e.target.value)}
                    />
                    <ul className="compare-pick-list">
                      {assets
                        .filter((a) => a.id !== selected.id && (!cmpQuery || a.slug.includes(cmpQuery.toLowerCase())))
                        .slice(0, 8)
                        .map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              className="tiny"
                              data-testid={`compare-pick-${a.slug}`}
                              onClick={() => {
                                setCmpOpen(false);
                                navigate(`/?compare=${encodeURIComponent(selected.id)},${encodeURIComponent(a.id)}`);
                              }}
                            >
                              {a.slug} <span className="muted">{a.stage}</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                    <button type="button" className="tiny" data-testid="compare-cancel" onClick={() => setCmpOpen(false)}>
                      Cancel
                    </button>
                  </div>
                )}
              </span>
            )}
            <button type="button" className="tiny" onClick={() => void toggleFullscreen()}>
              Fullscreen
            </button>
            <button
              type="button"
              className="tiny"
              onClick={() => setStatsOpen((o) => !o)}
            >
              {statsOpen ? "Hide stats" : "Stats"}
            </button>
            {selected?.assetSchemaVersion != null && (
              <span className="badge stage" title="assetSchemaVersion">
                v{selected.assetSchemaVersion}
              </span>
            )}
          </div>
        </div>
        <div className="viewer-stage">
        {statsOpen && (
          <div className="stats-panel" aria-label="Viewer stats">
            <div className="import-meta-title">Stats</div>
            <div className="import-meta-row">
              <span className="muted">tris</span>
              <strong>{viewerStats.tris == null ? "—" : viewerStats.tris}</strong>
            </div>
            <div className="import-meta-row">
              <span className="muted">bones</span>
              <strong>
                {viewerStats.bones == null ? "—" : viewerStats.bones}
              </strong>
            </div>
            <div className="import-meta-row">
              <span className="muted">clips</span>
              <strong>{viewerStats.clips}</strong>
            </div>
            <div className="import-meta-row">
              <span className="muted">stage</span>
              <strong>{selected?.stage ?? "—"}</strong>
            </div>
            <div className="import-meta-row">
              <span className="muted">characterType</span>
              <strong>{selected?.characterType ?? "—"}</strong>
            </div>
          </div>
        )}
        <ErrorBoundary
          scope="viewer"
          assetId={selected?.id ?? null}
          url={glbUrl}
          probe={probeDump(selected as Parameters<typeof probeDump>[0])}
          resetKey={`${selected?.id ?? ""}:${viewerRetry}`}
          onRetry={() => {
            const urls = isScene
              ? sceneNodes
                  .map((n) => resolveChild(n.assetId))
                  .filter((c): c is AssetMeta => Boolean(c))
                  .map((c) => `${API}/api/assets/${c.id}/file`)
              : glbUrl
                ? [glbUrl]
                : [];
            for (const u of urls) useGLTF.clear(u);
            setPreflight((prev) => {
              const next = { ...prev };
              for (const u of urls) delete next[u];
              return next;
            });
            setLoadError(null);
            setViewerRetry((n) => n + 1);
          }}
          onBack={() => {
            setSelected(null);
            setLoadError(null);
            setGltfClips([]);
            searchInputRef.current?.focus();
          }}
        >
        {singlePreflight && !singlePreflight.ok ? (
          <ErrorCard
            scope="viewer"
            info={singlePreflight.info}
            assetId={selected?.id ?? null}
            url={glbUrl}
            probe={probeDump(selected as Parameters<typeof probeDump>[0])}
            onRetry={() => {
              if (glbUrl) {
                useGLTF.clear(glbUrl);
                setPreflight((prev) => {
                  const next = { ...prev };
                  delete next[glbUrl];
                  return next;
                });
              }
              setLoadError(null);
              setViewerRetry((n) => n + 1);
            }}
            onBack={() => {
              setSelected(null);
              setLoadError(null);
              setGltfClips([]);
              searchInputRef.current?.focus();
            }}
          />
        ) : (
        <div
          className="viewer-canvas"
          role="img"
          aria-label={canvasAriaLabel(selected)}
          data-testid="viewer-canvas"
          onPointerDownCapture={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
        {selBox ? (
          <div
            className="select-box"
            data-testid="select-box"
            style={{
              left: Math.min(selBox.x0, selBox.x1),
              top: Math.min(selBox.y0, selBox.y1),
              width: Math.abs(selBox.x1 - selBox.x0),
              height: Math.abs(selBox.y1 - selBox.y0),
            }}
          >
            <span className="select-box-count">{viewerShellRef.current ? boxIds(selBox, viewerShellRef.current.querySelector(".viewer-canvas") as HTMLElement).length : 0}</span>
          </div>
        ) : null}
        {/* S3-D #86 — opaque drawing buffer: translucent GLB pixels must not show the page
            background through (visible once the clear colour differs from the chrome bg). */}
        <Canvas
          camera={{ position: [2, 1.5, 3], fov: 50 }}
          shadows={viewDraft.shadows}
          gl={{ alpha: false }}
        >
          <FirstFrame k={selected && sceneAppliedFor === selected.id ? selected.id : null} onFrame={setSceneFramedFor} />
          <color attach="background" args={[canvasTheme.clear]} />
          <ambientLight intensity={0.65} />
          <directionalLight
            position={[3, 5, 2]}
            intensity={1.1}
            castShadow={viewDraft.shadows}
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <Grid
            infiniteGrid
            fadeDistance={20}
            sectionColor={canvasTheme.gridSection}
            cellColor={canvasTheme.gridCell}
          />
          {viewDraft.ground ? (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -0.001, 0]}
              receiveShadow={viewDraft.shadows}
              userData={{ gpGround: true }}
            >
              <planeGeometry args={[40, 40]} />
              <meshStandardMaterial color={canvasTheme.ground} />
            </mesh>
          ) : null}
          {/* S3-D #90 — no inertial damping when motion is reduced */}
          {/* S3-E #87 — touch: 1 finger rotates, 2 fingers pinch-zoom + pan (canvas only) */}
          <OrbitControls
            makeDefault
            ref={controlsRef}
            enableDamping={!reducedMotion}
            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
          />
          {isScene && multiCentroid ? <MultiGizmo at={multiCentroid} onCommit={moveSelection} /> : null}
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
                  const childPf = childUrl ? preflight[childUrl] : undefined;
                  if (childUrl && child?.formats?.glb && !childPf) return null; // preflight pending
                  if (!child || !child.formats?.glb || (childPf && !childPf.ok)) {
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
                      clipName={reducedMotion ? undefined : clipForNode}
                      transform={n.transform}
                      highlighted={sceneNodeId === n.id || multiSel.includes(n.id)}
                      selected={multiLive.length < 2 && sceneNodeId === n.id}
                      visible={(n as SceneNodeDraft).visible !== false}
                      gizmoMode={gizmoMode}
                      snapEnabled={snapEnabled}
                      snapStep={snapStep}
                      wireframe={wireframe}
                      bones={showBones}
                      shadows={viewDraft.shadows}
                      onTransformCommit={(next) => {
                        commitDraft(
                          `${gizmoMode === "translate" ? "Move" : gizmoMode === "rotate" ? "Rotate" : "Scale"} node`,
                          sceneDraft.map((node) =>
                            node.id === n.id
                              ? {
                                  ...node,
                                  transform: {
                                    position: next.position,
                                    rotation: next.rotation,
                                    scale: next.scale,
                                  },
                                }
                              : node,
                          ),
                        );
                      }}
                    />
                  );
                })
              : glbUrl && !loadError && singlePreflight?.ok ? (
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
                    blendMs={effectiveBlendMs(blendMs, reducedMotion)}
                    timeScale={timeScale}
                    wireframe={wireframe}
                    bones={showBones && bonesAvailable}
                    shadows={viewDraft.shadows}
                  />
                ) : loadError ? (
                  <LoadError message={loadError} />
                ) : null}
          </Suspense>
        </Canvas>
        </div>
        )}
        </ErrorBoundary>
        {selected && (
          <div className="import-meta-panel" aria-label="Import metadata">
            <div className="import-meta-title">
              Import / actionMap{" "}
              {actionMapDirty ? (
                <span className="badge off"> Unsaved</span>
              ) : (
                <span className="badge on"> Saved</span>
              )}
            </div>
            {selected.importMeta ? (
              <>
                <div className="import-meta-row">
                  <span className="muted">source</span>
                  <select
                    value={actionMapSource}
                    onChange={(e) => {
                      setActionMapSource(e.target.value);
                      setActionMapDirty(true);
                    }}
                    aria-label="importMeta.source"
                  >
                    {["mixamo", "fbx", "png_pipeline", "unknown"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                {selected.importMeta.originalFilename && (
                  <div className="import-meta-row">
                    <span className="muted">originalFilename</span>
                    <code>{selected.importMeta.originalFilename}</code>
                  </div>
                )}
                {selected.importMeta.sourceKra && (
                  <div className="import-meta-row" data-testid="kra-source">
                    <span className="muted">Source:</span>
                    <code>{selected.importMeta.sourceKra}</code>
                  </div>
                )}
                {selected.importMeta.boneMapStub && (
                  <div className="import-meta-row">
                    <span className="muted">boneMapStub</span>
                    <code>{selected.importMeta.boneMapStub}</code>
                  </div>
                )}
              </>
            ) : (
              <p className="muted">
                No import metadata — add a mapping row to create a draft.
              </p>
            )}
            <div className="import-meta-actions">
              <span className="muted">actionMap editor</span>
              {Object.entries(actionMapDraft).map(([src, dest]) => (
                <div key={src} className="scene-edit-row">
                  <input
                    type="text"
                    value={src}
                    aria-label={`actionMap src ${src}`}
                    onChange={(e) => {
                      const nextSrc = e.target.value;
                      setActionMapDraft((prev) => {
                        const copy = { ...prev };
                        delete copy[src];
                        if (nextSrc.trim()) copy[nextSrc.trim()] = dest;
                        return copy;
                      });
                      setActionMapDirty(true);
                    }}
                  />
                  <span>→</span>
                  <select
                    value={dest}
                    aria-label={`actionMap dest for ${src}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setActionMapDraft((prev) => ({ ...prev, [src]: v }));
                      setActionMapDirty(true);
                    }}
                  >
                    {CONTRACT_CLIP_DESTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="tiny danger"
                    onClick={() => {
                      setActionMapDraft((prev) => {
                        const copy = { ...prev };
                        delete copy[src];
                        return copy;
                      });
                      setActionMapDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="scene-author-actions">
                <button
                  type="button"
                  className="tiny"
                  onClick={() => {
                    let i = 1;
                    let key = `Action_${i}`;
                    while (actionMapDraft[key]) {
                      i += 1;
                      key = `Action_${i}`;
                    }
                    setActionMapDraft((prev) => ({ ...prev, [key]: "idle" }));
                    if (!selected.importMeta) setActionMapSource("unknown");
                    setActionMapDirty(true);
                  }}
                >
                  + Add mapping
                </button>
                <button
                  type="button"
                  className="tiny primary"
                  disabled={actionMapSaving || !actionMapDirty || rlLeft > 0}
                  onClick={() => void persistActionMap()}
                >
                  {actionMapSaving ? "Saving…" : "Save actionMap"}
                </button>
              </div>
              {actionMapError && <p className="err">{actionMapError}</p>}
              {rateLimitNote("actionMap")}
            </div>
            {selected.license && (
              <div className="import-meta-row">
                <span className="muted">license</span>
                <code>{selected.license}</code>
              </div>
            )}
            {(() => {
              const st = altTextState(altDraft);
              const dirty = st.trimmed !== (selected.altText ?? "");
              return (
                <div className="import-meta-actions alt-text-edit" data-testid="alt-text-edit">
                  <label htmlFor="alt-text-input" className="muted">
                    Alt text (optional)
                  </label>
                  <textarea
                    id="alt-text-input"
                    rows={3}
                    value={altDraft}
                    aria-describedby="alt-text-counter"
                    onChange={(e) => setAltDraft(e.target.value)}
                  />
                  <div className="scene-author-actions">
                    <span
                      id="alt-text-counter"
                      className={st.over ? "alt-text-counter over" : "alt-text-counter"}
                      data-testid="alt-text-counter"
                      aria-live="polite"
                    >
                      {st.counter}
                    </span>
                    <button
                      type="button"
                      className="tiny primary"
                      data-testid="alt-text-save"
                      disabled={altSaving || st.over || !dirty || rlLeft > 0}
                      title={st.over ? `Max ${ALT_TEXT_MAX} characters` : "PATCH altText (empty clears)"}
                      onClick={() => void saveAltText()}
                    >
                      {altSaving ? "Saving…" : "Save alt text"}
                    </button>
                  </div>
                  {altError && <p className="err">{altError}</p>}
                  {rateLimitNote("alt")}
                </div>
              );
            })()}
            {/* S3-E #41 — Delete asset: inline confirm; 409 ASSET_IN_USE explains tombstoned refs */}
            <div className="import-meta-row asset-delete-row">
              {assetDelConfirm ? (
                <span className="purge-confirm" role="alert">
                  <span>
                    Delete <code>{selected.slug}</code>? Files on disk are kept.
                  </span>
                  <button type="button" className="tiny danger" data-testid="asset-delete-confirm" disabled={rlLeft > 0} onClick={() => void deleteSelectedAsset()}>
                    Delete
                  </button>
                  <button type="button" className="tiny" onClick={() => setAssetDelConfirm(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="tiny danger" data-testid="asset-delete" onClick={() => { setAssetDelConfirm(true); setAssetDelMsg(null); }}>
                  Delete asset…
                </button>
              )}
              {assetDelMsg && (
                <p className="err" role="alert" data-testid="asset-delete-msg">
                  {assetDelMsg}
                </p>
              )}
              {rateLimitNote("assetDelete")}
            </div>
            {selected.clipDurations &&
              Object.keys(selected.clipDurations).length > 0 && (
                <div className="import-meta-actions">
                  <span className="muted">clipDurations (ms)</span>
                  <div className="action-chips">
                    {Object.entries(selected.clipDurations).map(([n, ms]) => (
                      <span key={n} className="action-chip">
                        {n}: {ms}ms
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
        {isScene && (
          <div className="scene-stub-panel scene-author-panel" aria-label="Scene author">
            <div className="import-meta-title">
              Scene author · v{selected?.scene?.version ?? 1} ·{" "}
              <span
                className={`node-count node-count-${capTone(liveCount, sceneMaxNodes)}`}
                data-testid="node-count"
                title={capReached ? capTitle(sceneMaxNodes) : "Live nodes / cap (deleted nodes don't count)"}
              >
                {capLabel(liveCount, sceneMaxNodes)}
              </span>
              {sceneRootId ? ` · root ${sceneRootId}` : ""}
              {sceneDirty ? (
                <span className="badge off" title="Draft differs from last saved scene.nodes">
                  {" "}
                  Unsaved
                </span>
              ) : (
                <span className="badge on" title="Draft matches last saved">
                  {" "}
                  Saved
                </span>
              )}
            </div>
            <div className="scene-author-actions">
              <button
                type="button"
                className="tiny"
                data-testid="node-add"
                disabled={capReached}
                title={capReached ? capTitle(sceneMaxNodes) : "Add a node"}
                onClick={addSceneNode}
              >
                + Add node
              </button>
              <button
                type="button"
                className="tiny"
                data-testid="node-duplicate"
                disabled={!sceneNodeId || capReached}
                onClick={duplicateSelectedNode}
                title={capReached ? capTitle(sceneMaxNodes) : "Duplicate selected node (+0.5 X, or +snap step)"}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="tiny"
                data-testid="undo"
                aria-label="Undo"
                title={undoTitle(hist)}
                disabled={!canUndo(hist)}
                onClick={doUndo}
              >
                <span aria-hidden="true">↶</span> Undo
              </button>
              <button
                type="button"
                className="tiny"
                data-testid="redo"
                aria-label="Redo"
                title={redoTitle(hist)}
                disabled={!canRedo(hist)}
                onClick={doRedo}
              >
                <span aria-hidden="true">↷</span> Redo
              </button>
              <button
                type="button"
                className="tiny primary"
                data-testid="scene-save"
                disabled={sceneSaving || liveCount < 1 || !sceneDirty || rlLeft > 0}
                onClick={() => void persistScene()}
              >
                {sceneSaving ? "Saving…" : sceneDirty ? "Save" : "Saved"}
              </button>
              {sceneDirty ? (
                <span className="dirty-indicator" data-testid="dirty-indicator" role="status">
                  <span aria-hidden="true">•</span> Unsaved
                </span>
              ) : null}
              <span className="muted">gizmo</span>
              {(["translate", "rotate", "scale"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={gizmoMode === m ? "tiny primary" : "tiny"}
                  onClick={() => setGizmoMode(m)}
                >
                  {m}
                </button>
              ))}
              <label className="tiny" style={{ display: "inline-flex", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={snapEnabled}
                  onChange={(e) => setSnapEnabled(e.target.checked)}
                />
                snap
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={snapStep}
                aria-label="snap step"
                style={{ width: "4rem" }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSnapStep(Number.isFinite(v) && v > 0 ? v : 0.25);
                }}
              />
            </div>
            <div className="scene-author-actions" aria-label="Orbit bookmarks">
              <span className="muted">
                Cameras ({camerasDraft.length}/{CAMERAS_MAX})
              </span>
              <select
                value={cameraSel}
                aria-label="Camera bookmark"
                onChange={(e) => e.target.value && jumpToCamera(e.target.value)}
              >
                <option value="">— select view —</option>
                {camerasDraft.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tiny"
                disabled={camerasDraft.length >= CAMERAS_MAX}
                onClick={saveCameraView}
              >
                + Save view
              </button>
              <button
                type="button"
                className="tiny"
                disabled={!cameraSel}
                onClick={() => {
                  const cur = camerasDraft.find((c) => c.id === cameraSel);
                  const name = window.prompt("Rename view", cur?.name ?? "");
                  if (name !== null && cameraSel) renameCamera(cameraSel, name);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="tiny"
                disabled={!cameraSel}
                onClick={() => cameraSel && deleteCamera(cameraSel)}
              >
                Delete
              </button>
            </div>
            {cameraErr && <p className="err">{cameraErr}</p>}
            {sceneSaveError && <p className="err">{sceneSaveError}</p>}
            {rateLimitNote("scene")}
            {(() => {
              // S3-D #127 / R1 §6 — V4a ambiguity links to the conflicting assets
              const amb = ambiguousSlugOf(sceneSaveError);
              if (!amb) return null;
              const hits = assets.filter((a) => a.slug === amb);
              return hits.length ? (
                <div className="scene-author-actions" aria-label="Conflicting assets">
                  {hits.map((a) => (
                    <button key={a.id} type="button" className="tiny" onClick={() => setSelected(a)}>
                      {a.slug} · {a.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
            {deletedCount > 0 && (
              <div className="scene-author-actions" aria-label="Deleted nodes">
                <label className="tiny" style={{ display: "inline-flex", gap: 4 }}>
                  <input
                    type="checkbox"
                    data-testid="nodes-show-deleted"
                    checked={showDeleted}
                    onChange={(e) => setShowDeleted(e.target.checked)}
                  />
                  Show deleted ({deletedCount})
                </label>
                {purgeConfirm ? (
                  <span className="purge-confirm" role="alert">
                    <span>{purgeConfirmText(deletedCount)}</span>
                    <button type="button" className="tiny danger" data-testid="nodes-purge-confirm" onClick={purgeDeleted}>
                      Purge
                    </button>
                    <button type="button" className="tiny" onClick={() => setPurgeConfirm(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="tiny danger" data-testid="nodes-purge" onClick={() => setPurgeConfirm(true)}>
                    Purge deleted ({deletedCount})
                  </button>
                )}
              </div>
            )}
            {replaceUndo && (
              <div className="scene-author-actions">
                <span className="replace-chip" role="status">
                  Replaced <code>{resolveChild(replaceUndo.prevAssetId)?.slug ?? replaceUndo.from}</code> → <code>{replaceUndo.to}</code> ·{" "}
                  <button
                    type="button"
                    className="tiny"
                    data-testid="node-replace-undo"
                    onClick={() => {
                      commitDraft("Undo replace", undoReplace(sceneDraft, replaceUndo));
                      setReplaceUndo(null);
                    }}
                  >
                    Undo
                  </button>
                </span>
              </div>
            )}
            {multiSel.length > 0 && (
              <div className="batch-actions" data-testid="batch-actions" role="toolbar" aria-label="Batch actions">
                <strong data-testid="selection-count">{selectionLabel(multiSel.length)}</strong>
                {(["hide", "show", "delete", "restore"] as const).map((op) => (
                  <button key={op} type="button" className={op === "delete" ? "tiny danger" : "tiny"} data-testid={`batch-${op}`} onClick={() => runBatch(op)}>
                    {OP_LABEL[op]}
                  </button>
                ))}
                <button type="button" className="tiny" data-testid="batch-clear" onClick={() => { setMultiSel([]); setBatchToast(null); }}>
                  Clear
                </button>
                {batchToast ? (
                  <span className="batch-toast" role="status" aria-live="polite" data-testid="batch-toast">
                    {batchToast}
                  </span>
                ) : null}
              </div>
            )}
            <p className="muted canvas-help" data-testid="canvas-help">
              Drag to orbit · Shift+drag to box-select · Shift-click rows to multi-select · Ctrl/Cmd+Z undo
            </p>
            <ul className="scene-node-list">
              {sceneDraft.map((n) => {
                if (isTombstone(n)) {
                  // S3-E #41 — struck-through tombstone row: not selectable, Restore only.
                  if (!showDeleted) return null;
                  const tc = resolveChild(n.assetId);
                  return (
                    <li key={n.id} className="scene-node-deleted" data-testid={`node-row-deleted-${n.id}`}>
                      <span
                        className={multiSel.includes(n.id) ? "scene-node tombstone multi" : "scene-node tombstone"}
                        aria-disabled="true"
                        data-testid={`node-row-${n.id}`}
                        title="Shift-click to select for a batch Restore"
                        onClick={(e) => {
                          if (e.shiftKey) setMultiSel((s) => toggleSel(s, n.id));
                        }}
                      >
                        {multiSel.includes(n.id) ? <span className="sel-check" aria-label="selected">✓</span> : null}
                        <code>{n.id.slice(0, 8)}</code>
                        <span className="muted"> → </span>
                        <code>{tc?.slug ?? n.assetId}</code>
                        <span className="badge off pill-deleted">deleted</span>
                      </span>
                      <button
                        type="button"
                        className="tiny"
                        data-testid={`node-restore-${n.id}`}
                        disabled={capReached}
                        title={capReached ? capTitle(sceneMaxNodes) : "Restore this node"}
                        onClick={() => restoreSceneNode(n.id)}
                      >
                        Restore
                      </button>
                    </li>
                  );
                }
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
                      className={`scene-node${sceneNodeId === n.id ? " active" : ""}${multiSel.includes(n.id) ? " multi" : ""}`}
                      data-testid={`node-row-${n.id}`}
                      aria-pressed={multiSel.includes(n.id)}
                      onClick={(e) => {
                        // S3-G #29 — Shift-click toggles membership; plain click = single selection
                        if (e.shiftKey) {
                          setMultiSel((s) => toggleSel(s.length === 0 && sceneNodeId && sceneNodeId !== n.id ? [sceneNodeId] : s, n.id));
                          return;
                        }
                        setMultiSel([]);
                        setBatchToast(null);
                        setSceneNodeId(n.id);
                      }}
                    >
                      {multiSel.includes(n.id) ? <span className="sel-check" aria-label="selected">✓</span> : null}
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
                        <label className="scene-edit-row">
                          <span>visible</span>
                          <input
                            type="checkbox"
                            checked={n.visible !== false}
                            onChange={(e) =>
                              patchSceneNode(n.id, {
                                visible: e.target.checked,
                              })
                            }
                            aria-label={`visible for ${n.id}`}
                          />
                        </label>
                        <div className="scene-author-actions">
                          <button
                            type="button"
                            className="tiny"
                            onClick={() => commitDraft("Set root", sceneDraft, n.id)}
                            disabled={isRoot}
                          >
                            Set root
                          </button>
                          {(() => {
                            const blk = deleteBlock(sceneDraft, n.id, sceneRootId ?? sceneDraft[0]?.id);
                            return (
                              <button
                                type="button"
                                className="tiny danger"
                                data-testid={`node-delete-${n.id}`}
                                disabled={!!blk}
                                title={blk ? blk.title : "Delete (soft — Restore or Purge later)"}
                                onClick={() => removeSceneNode(n.id)}
                              >
                                Delete
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            className="tiny"
                            data-testid={`node-replace-${n.id}`}
                            aria-expanded={replaceOpen}
                            onClick={() => {
                              setReplaceOpen((v) => !v);
                              setReplaceErr(null);
                            }}
                          >
                            Replace asset…
                          </button>
                        </div>
                        {replaceOpen && (
                          <div className="replace-picker" aria-label="Replace asset picker">
                            <input
                              type="search"
                              placeholder="Search assets"
                              aria-label="Search replacement asset"
                              value={replaceQuery}
                              onChange={(e) => setReplaceQuery(e.target.value)}
                            />
                            <ul className="replace-results">
                              {/* NIT-G-2 — newest first (ties: most recently stored first) so the cap of 30
                                  never hides a just-registered asset on a populated store */}
                              {sortNewestFirst([...assets].reverse())
                                .filter((a) => a.id !== n.assetId && a.slug !== n.assetId)
                                .filter((a) => {
                                  const q = replaceQuery.trim().toLowerCase();
                                  return !q || a.slug.toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q) || (a.tags ?? []).some((t) => t.toLowerCase().includes(q));
                                })
                                .slice(0, 30)
                                .map((a) => (
                                  <li key={a.id}>
                                    <button
                                      type="button"
                                      className="tiny"
                                      data-testid={`replace-pick-${a.slug}`}
                                      onClick={() => replaceSelectedAsset(a)}
                                    >
                                      {a.slug} <span className="muted">({a.stage ?? "—"})</span>
                                    </button>
                                  </li>
                                ))}
                            </ul>
                            {replaceErr && <p className="err" role="alert">{replaceErr}</p>}
                          </div>
                        )}
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
        <div className="viewer-dock" aria-label="Viewer dock">
        {selected && authorPool.length > 0 && (
          <div className="clip-author" aria-label="Clip authoring">
            <span className="muted">Author:</span>
            {authorPool.map((c) => {
              const disabled = (clipUx.disabled ?? []).includes(c);
              return (
                <span key={c} className={reqIssue?.clips.includes(c) ? "author-row req-bad" : "author-row"}>
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
                  {/* S3-F #11 — "Requires" multi-select (1–8, never itself) edits this clip's map entry */}
                  <span className="req-wrap" data-testid="clip-requires">
                    <button
                      type="button"
                      aria-expanded={reqOpen === c}
                      title="Clips this clip requires"
                      onClick={() => setReqOpen((o) => (o === c ? null : c))}
                    >
                      Requires{selected?.clipRequires?.[c]?.length ? ` (${selected.clipRequires[c].length})` : ""}
                    </button>
                    {requiresCaption(selected?.clipRequires, c) && (
                      <span className="muted req-caption">{requiresCaption(selected?.clipRequires, c)}</span>
                    )}
                    {reqOpen === c && (
                      <span className="req-pop" role="group" aria-label={`${c} requires`}>
                        {authorPool
                          .filter((o) => o !== c)
                          .map((o) => {
                            const on = (selected?.clipRequires?.[c] ?? []).includes(o);
                            const full = (selected?.clipRequires?.[c]?.length ?? 0) >= 8;
                            return (
                              <label key={o} className="req-opt">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={!on && full}
                                  onChange={() => void saveClipRequires(toggleRequire(selected?.clipRequires, c, o))}
                                />
                                {o}
                              </label>
                            );
                          })}
                      </span>
                    )}
                  </span>
                </span>
              );
            })}
            <span className="muted persist-note">
              Persist: asset <code>clipUx</code> (API) + localStorage fallback
            </span>
            {reqIssue && (
              <p className="err req-issue" role="alert" data-testid="clip-requires-error">
                {reqIssue.message}
              </p>
            )}
          </div>
        )}
        <div className="clip-bar clip-bar-s3c" aria-label="Playback + overlay">
          <div className="dock-row dock-row-clipux" aria-label="Blend and speed">
          <label
            className="blend"
            title={
              blendControlEnabled(clipsForUi)
                ? "Crossfade between clips (0 = hard cut)"
                : "Blend needs ≥ 2 clips"
            }
          >
            Blend
            <input
              type="number"
              min={0}
              max={BLEND_MS_MAX}
              step={50}
              value={blendMs}
              disabled={!canPlay || !blendControlEnabled(clipsForUi)}
              aria-label="Clip blend ms (0–1000)"
              onChange={(e) => setPlaybackPref({ blendMs: clampBlendMs(e.target.value) })}
            />
            ms
          </label>
          <label className="speed" title="Playback speed; clipDurations stay raw">
            Speed
            <input
              type="range"
              min={TIMESCALE_MIN}
              max={TIMESCALE_MAX}
              step={TIMESCALE_STEP}
              value={timeScale}
              disabled={!canPlay}
              aria-label="Clip timescale 0.5–2.0"
              onChange={(e) => setPlaybackPref({ timeScale: clampTimeScale(e.target.value) })}
            />
            <span className="muted">{timeScale.toFixed(1)}×</span>
            <button
              type="button"
              className="tiny"
              disabled={!canPlay || timeScale === TIMESCALE_DEFAULT}
              onClick={() => setPlaybackPref({ timeScale: TIMESCALE_DEFAULT })}
            >
              Reset
            </button>
          </label>
          {canPlay && clip && selected?.clipDurations?.[clip] !== undefined ? (
            <span className="muted" title="Effective length = raw clipDurations / speed">
              effective {effectiveDurationMs(selected.clipDurations[clip], timeScale)} ms
            </span>
          ) : null}
          <span className="muted" title="Keys 1–9 select the n-th clip (ignored while typing)">
            Keys 1–9 = clips
          </span>
          </div>
          <div className="dock-row dock-row-view" aria-label="View">
            <div className="dock-group" role="group" aria-label="Overlay (session)">
              <span className="dock-group-title muted">Overlay (session)</span>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(e) => setWireframe(e.target.checked)}
            />
            Wireframe
          </label>
          <label
            className="overlay-toggle"
            title={bonesAvailable ? "Show skeleton" : "No armature / bones on this asset"}
          >
            <input
              type="checkbox"
              checked={showBones && bonesAvailable}
              disabled={!bonesAvailable}
              onChange={(e) => setShowBones(e.target.checked)}
            />
            Bones
          </label>
          <label title="Session only — follows prefers-color-scheme on “system”">
            Theme
            <select
              className="session-pref"
              aria-label="Theme (session)"
              data-testid="theme-select"
              value={themePref}
              onChange={(e) => setThemePref(e.target.value as ThemePref)}
            >
              {THEME_PREFS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label title="Session only — follows prefers-reduced-motion on “system”">
            Motion
            <select
              className="session-pref"
              aria-label="Motion (session)"
              data-testid="motion-select"
              value={motionPref}
              onChange={(e) => setMotionPref(e.target.value as MotionPref)}
            >
              {MOTION_PREFS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
            </div>
            <span className="dock-divider" aria-hidden="true" />
            <div className="dock-group" role="group" aria-label="Scene view">
              <span className="dock-group-title muted">Scene view</span>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={viewDraft.ground}
              onChange={(e) => setViewDraft((v) => ({ ...v, ground: e.target.checked }))}
            />
            Ground
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={viewDraft.shadows}
              onChange={(e) => setViewDraft((v) => ({ ...v, shadows: e.target.checked }))}
            />
            Shadows
          </label>
                    </div>
          </div>
        </div>
        {/* S3-F #140 — Featured row (Author, Blend/Speed, View, Featured, Transport); hidden when empty */}
        {(featN > 0 || featEditOpen) && (
          <div
            className="dock-row featured-strip"
            data-testid="featured-strip"
            aria-label="Featured scenes"
            tabIndex={0}
            onMouseEnter={() => setFeatPaused(true)}
            onMouseLeave={() => setFeatPaused(false)}
            onFocus={() => setFeatPaused(true)}
            onBlur={() => setFeatPaused(false)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                goFeatured(-1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                goFeatured(1);
              }
            }}
          >
            <span className="dock-group-title muted">Featured</span>
            <button type="button" className="tiny" aria-label="Previous featured" disabled={featN < 2} onClick={() => goFeatured(-1)}>
              ‹
            </button>
            <span className="featured-title">{featCur ? featCur.title ?? featCur.slug : "—"}</span>
            <span className="muted">
              {featN ? Math.min(featIdx, featN - 1) + 1 : 0} / {featN}
            </span>
            <button type="button" className="tiny" aria-label="Next featured" disabled={featN < 2} onClick={() => goFeatured(1)}>
              ›
            </button>
            <button
              type="button"
              className="tiny"
              onClick={() => {
                setFeatDraft(featured?.scenes.map((x) => x.id) ?? []);
                setFeatErr(null);
                setFeatEditOpen(true);
              }}
            >
              Edit featured
            </button>
          </div>
        )}
        {featN === 0 && !featEditOpen && assets.some((a) => a.stage === "scene") && (
          <div className="dock-row featured-empty">
            <button
              type="button"
              className="tiny"
              onClick={() => {
                setFeatDraft([]);
                setFeatErr(null);
                setFeatEditOpen(true);
              }}
            >
              Feature scenes…
            </button>
          </div>
        )}
        {featEditOpen && (
          <div className="featured-edit" role="dialog" aria-label="Edit featured" data-testid="featured-edit">
            <ol>
              {featDraft.map((id, i) => {
                const a = assets.find((x) => x.id === id);
                return (
                  <li key={id}>
                    <span>{a?.name ?? a?.slug ?? id}</span>
                    <button type="button" className="tiny" aria-label="Move up" disabled={i === 0} onClick={() => setFeatDraft((d) => moveItem(d, i, -1))}>
                      ↑
                    </button>
                    <button type="button" className="tiny" aria-label="Move down" disabled={i === featDraft.length - 1} onClick={() => setFeatDraft((d) => moveItem(d, i, 1))}>
                      ↓
                    </button>
                    <button type="button" className="tiny" onClick={() => setFeatDraft((d) => d.filter((x) => x !== id))}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ol>
            <label>
              Add scene{" "}
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setFeatDraft((d) => (d.includes(v) ? d : [...d, v]));
                }}
              >
                <option value="">—</option>
                {assets
                  .filter((a) => a.stage === "scene" && !featDraft.includes(a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.slug}
                    </option>
                  ))}
              </select>
            </label>
            <button type="button" className="tiny" onClick={() => void saveFeatured()}>
              Save
            </button>
            <button type="button" className="tiny" onClick={() => setFeatEditOpen(false)}>
              Cancel
            </button>
            {featErr && (
              <p className="err" role="alert">
                {featErr}
              </p>
            )}
          </div>
        )}
        <div className="clip-bar">
          <div className="clip-list" role="listbox" aria-label="Clips">
            {canPlay ? (
              clipsForUi.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={clip === c}
                  className={clip === c ? "clip active" : "clip"}
                  onClick={() => selectClip(c)}
                  title={
                    (clipUx.defaultClip === c ? "Default clip" : "Click to play") +
                    (hotkeyLabel(i) ? ` · hotkey ${hotkeyLabel(i)}` : "")
                  }
                >
                  {hotkeyLabel(i) ? (
                    <span className="hotkey" data-testid="clip-hotkey">
                      {hotkeyLabel(i)}
                    </span>
                  ) : null}
                  {c}
                  {clipUx.defaultClip === c ? " ★" : ""}
                  {requiresCaption(selected?.clipRequires, c) && (
                    <small className="req-caption muted"> {requiresCaption(selected?.clipRequires, c)}</small>
                  )}
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
        </div>
      </div>
    </div>
  );
}
