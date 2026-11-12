/**
 * S3-I E2 #34 — scene templates for the New scene dialog (R1 §9, D1 §7).
 * Templates hold slots, never assets: every slot is filled from the user's own library,
 * so no media is bundled. The graph each one builds is checked against SceneGraphSchema in tests.
 */
export type SlotAccepts = "any" | "billboard" | "rigged";
export type TemplateSlot = { key: string; label: string; accepts: SlotAccepts };
type Vec3 = [number, number, number];
export type TemplateNode = { id: string; slot: string; position: Vec3; scale?: Vec3 };
export type SceneTemplate = { id: string; label: string; slots: TemplateSlot[]; nodes: TemplateNode[] };

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    slots: [{ key: "base", label: "Starting asset", accepts: "any" }],
    nodes: [{ id: "base", slot: "base", position: [0, 0, 0] }],
  },
  {
    id: "duo-billboard",
    label: "Duo billboard",
    slots: [
      { key: "left", label: "Left billboard", accepts: "billboard" },
      { key: "right", label: "Right billboard", accepts: "billboard" },
    ],
    nodes: [
      { id: "left", slot: "left", position: [-1, 0, 0] },
      { id: "right", slot: "right", position: [1, 0, 0] },
    ],
  },
  {
    id: "rigged-prop",
    label: "Rigged + prop",
    slots: [
      { key: "actor", label: "Rigged character", accepts: "rigged" },
      { key: "prop", label: "Prop", accepts: "any" },
    ],
    nodes: [
      { id: "actor", slot: "actor", position: [0, 0, 0] },
      { id: "prop", slot: "prop", position: [1.2, 0, 0], scale: [0.5, 0.5, 0.5] },
    ],
  },
];

export type PickableAsset = {
  id: string;
  name?: string;
  slug?: string;
  stage?: string;
  characterType?: string;
  rig?: { hasArmature?: boolean };
  formats?: { glb?: string; preview?: string };
};

export function slotAccepts(a: PickableAsset, accepts: SlotAccepts): boolean {
  if (!a || a.stage === "scene") return false;
  if (accepts === "billboard") return a.stage === "mvp-billboard" || a.characterType === "billboard";
  if (accepts === "rigged") return a.stage === "rigged" || Boolean(a.rig?.hasArmature);
  return true;
}

export const slotCandidates = <T extends PickableAsset>(assets: readonly T[], slot: TemplateSlot): T[] =>
  assets.filter((a) => slotAccepts(a, slot.accepts));

export type Picks = Record<string, string | undefined>;

export const missingSlots = (tpl: SceneTemplate, picks: Picks): string[] => tpl.slots.filter((s) => !picks[s.key]).map((s) => s.key);

/** Scene graph for a fully-picked template, or null while any slot is empty. */
export function templateGraph(tpl: SceneTemplate, picks: Picks) {
  if (missingSlots(tpl, picks).length) return null;
  return {
    version: 1 as const,
    rootId: tpl.nodes[0].id,
    nodes: tpl.nodes.map((n) => ({
      id: n.id,
      assetId: picks[n.slot] as string,
      transform: { position: n.position, rotation: [0, 0, 0] as Vec3, scale: n.scale ?? ([1, 1, 1] as Vec3) },
    })),
  };
}

export function templateSlug(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const s = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "0";
  return `${base || "scene"}-${s}`;
}

/** Full POST /api/assets body for a new stage=scene asset, or null while slots are empty. */
export function templateSceneBody(
  tpl: SceneTemplate,
  picks: Picks,
  assets: readonly PickableAsset[],
  o: { id: string; name: string; now: string },
) {
  const scene = templateGraph(tpl, picks);
  if (!scene) return null;
  const first = assets.find((a) => a.id === scene.nodes[0].assetId);
  // the schema wants a format on every asset; scenes carry their first child's, like hand-authored scenes do
  const glb = first?.formats?.glb || `assets/${scene.nodes[0].assetId}/model.glb`;
  const preview = first?.formats?.preview || glb;
  const name = o.name.trim() || `${tpl.label} scene`;
  return {
    id: o.id,
    slug: templateSlug(name, o.id.replace(/-/g, "")),
    name,
    characterType: "unknown",
    stage: "scene",
    tags: [],
    clips: [],
    formats: { glb, preview },
    rig: { hasArmature: false, hasWeights: false },
    scene,
    createdAt: o.now,
    updatedAt: o.now,
  };
}
