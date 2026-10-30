import { z } from "zod";

/** kebab-case slug used in inbox paths */
export const AssetSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be kebab-case");

export const CharacterTypeSchema = z.enum([
  "billboard",
  "prop",
  "humanoid",
  "unknown",
]);

export const AssetStageSchema = z.enum([
  "mvp-billboard",
  "rigged",
  "scene",
]);

/**
 * Relative paths under data/.
 * Animated assets MUST use glb or fbx; obj is static-only.
 */
export const AssetFormatsSchema = z
  .object({
    glb: z.string().optional(),
    fbx: z.string().optional(),
    obj: z.string().optional(),
    preview: z.string().min(1),
    sourcePng: z.string().optional(),
  })
  .superRefine((formats, ctx) => {
    if (!formats.glb && !formats.fbx && !formats.obj) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "at least one of formats.glb, formats.fbx, or formats.obj is required",
      });
    }
  });

export const AssetRigSchema = z.object({
  hasArmature: z.boolean(),
  hasWeights: z.boolean(),
  /** Unique joint-name count from GLB skins (S3-A #13) — not duplicate skin refs. */
  boneCount: z.number().int().nonnegative().optional(),
  /** Distinct armature (skin root) count from GLB probe (S3-C #19) — must be ≤ 1. */
  armatureCount: z.number().int().nonnegative().optional(),
  blenderVersionTested: z.string().optional(),
});

/** Viewer clip authoring prefs (S2-D) — durable on asset JSON. */
/** S3-C #1 / #2 — viewer playback prefs (D1 §2–§3). */
export const CLIP_BLEND_MS_MIN = 0;
export const CLIP_BLEND_MS_MAX = 1000;
export const CLIP_BLEND_MS_DEFAULT = 250;
export const CLIP_TIMESCALE_MIN = 0.5;
export const CLIP_TIMESCALE_MAX = 2;
export const CLIP_TIMESCALE_DEFAULT = 1;

export const ClipUxSchema = z
  .object({
    defaultClip: z.string().optional(),
    order: z.array(z.string()).optional(),
    disabled: z.array(z.string()).optional(),
    /** S3-C #1 crossfade ms, 0 = hard cut. */
    blendMs: z
      .number()
      .finite()
      .min(CLIP_BLEND_MS_MIN, "clipUx.blendMs must be 0–1000")
      .max(CLIP_BLEND_MS_MAX, "clipUx.blendMs must be 0–1000")
      .optional(),
    /** S3-C #2 mixer timeScale; never alters clipDurations. */
    timeScale: z
      .number()
      .finite()
      .min(CLIP_TIMESCALE_MIN, "clipUx.timeScale must be 0.5–2.0")
      .max(CLIP_TIMESCALE_MAX, "clipUx.timeScale must be 0.5–2.0")
      .optional(),
  })
  .optional();


/** S3-A #5 — clip taxonomy tags (fail-closed enum). */
export const CLIP_TAG_VALUES = ["locomotion", "emote", "combat"] as const;
export type ClipTagValue = (typeof CLIP_TAG_VALUES)[number];
export const ClipTagValueSchema = z.enum(CLIP_TAG_VALUES);

/**
 * Map clip name → tags. Keys must exist in asset.clips[] (enforced in AssetSchema).
 * Unknown tag strings reject at parse time.
 */
export const ClipTagsSchema = z
  .record(z.string(), z.array(ClipTagValueSchema).min(1))
  .optional();

/** S3-B #137 — SPDX allowlist (+ LicenseRef-*). Empty string rejects. */
export const SPDX_LICENSE_IDS = [
  "MIT",
  "Apache-2.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "GPL-3.0-only",
  "LicenseRef-Mixamo",
  "UNLICENSED",
] as const;

export function isValidSpdxLicense(id: string): boolean {
  if (!id || !id.trim()) return false;
  if ((SPDX_LICENSE_IDS as readonly string[]).includes(id)) return true;
  if (id.startsWith("LicenseRef-") && id.length > "LicenseRef-".length) return true;
  return false;
}

export const LicenseSpdxSchema = z
  .string()
  .min(1)
  .refine(isValidSpdxLicense, {
    message: "license must be a known SPDX id or LicenseRef-* (empty rejected)",
  });

/** S3-B #8 — clip name → duration_ms (probe-only write). */
export const ClipDurationsSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .optional();

/** S3-A/B ships assetSchemaVersion = 3 (prefer stay on 3). */
export const ASSET_SCHEMA_VERSION = 3 as const;

/** Contract clip names (required ∪ allowlist ∪ billboard spin). */
export const CONTRACT_CLIP_NAMES = [
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

export type ContractClipName = (typeof CONTRACT_CLIP_NAMES)[number];

/** True for allowlisted names or emote_* prefix. */
export function isContractClipName(name: string): boolean {
  if ((CONTRACT_CLIP_NAMES as readonly string[]).includes(name)) return true;
  if (name.startsWith("emote_") && name.length > "emote_".length) return true;
  return false;
}

/**
 * Mixamo/FBX/PNG import provenance (S2-D-E2/E3).
 * Probe still wins for clips/rig/stage; this only records source honesty.
 */
/**
 * S3-D #49/#97 — warn-only import findings (never block register).
 * Additive + optional: assetSchemaVersion stays 3.
 */
export const IMPORT_WARNING_CODES = ["PNG_ALPHA_PREMULT_SUSPECT", "IDLE_TPOSE_SUSPECT"] as const;
export const ImportWarningSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/, "warning code must be UPPER_SNAKE"),
  message: z.string().max(500).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
  clip: z.string().optional(),
});
export type ImportWarning = z.infer<typeof ImportWarningSchema>;

/** S3-D #88 — alt text cap (chars). */
export const ALT_TEXT_MAX = 280;

/** S3-D #127 — first free `<slug>-2`, `-3`, … (kebab-valid; trailing -N of the input is kept). */
export function suggestSlug(slug: string, isTaken: (s: string) => boolean): string {
  for (let n = 2; n < 10000; n++) {
    const cand = `${slug}-${n}`;
    if (!isTaken(cand)) return cand;
  }
  return `${slug}-${Date.now()}`;
}

/** S3-D #76 — GLB size cap (MB). Default 100; integer ≥ 1; invalid → throw (fail-closed). */
export const MAX_GLB_MB_DEFAULT = 100;
export function parseMaxGlbMb(raw: string | undefined | null): number {
  if (raw == null || String(raw).trim() === "") return MAX_GLB_MB_DEFAULT;
  const t = String(raw).trim();
  if (!/^[0-9]+$/.test(t) || Number(t) < 1 || !Number.isSafeInteger(Number(t) * 1024 * 1024)) {
    throw new Error(`MAX_GLB_MB must be an integer >= 1 (got: ${JSON.stringify(raw)})`);
  }
  return Number(t);
}
export function maxGlbBytes(mb: number): number {
  return mb * 1024 * 1024;
}

const timingMs = z.number().int().min(0).max(86_400_000);
/**
 * S3-E #66 — fixed key set; `total` = export + probe + copy (register is in timings.json only,
 * it is not known until the POST returns). `probeCache` feeds the #94 history-row tooltip.
 */
export const ImportTimingsSchema = z
  .object({
    export: timingMs.optional(),
    probe: timingMs,
    copy: timingMs,
    total: timingMs,
    probeCache: z.enum(["hit", "miss", "off"]),
  })
  .strict();

export const ImportMetaSchema = z.object({
  source: z.enum(["mixamo", "fbx", "png_pipeline", "unknown"]),
  warnings: z.array(ImportWarningSchema).max(50).optional(),
  originalFilename: z.string().optional(),
  actionMap: z.record(z.string(), z.string()).optional(),
  boneMapStub: z.string().optional(),
  characterTypeHint: z.enum(["humanoid", "prop", "unknown"]).optional(),
  humanoidPngApproved: z.boolean().optional(),
  // S3-E #66 — optional mirror of timings.json (integer ms; additive, schema version stays 3).
  // Written by register_asset.mjs only when importMeta already exists; never in goldens.
  timingsMs: ImportTimingsSchema.optional(),
});

/**
 * S2-E-E3 / S2-F-E1 — minimal multi-asset scene graph stub (not a world editor).
 * V4 child assetId resolve is HARD at register (API validateSceneChildren); Zod covers V1–V3/V7.
 */
export const SceneNodeTransformSchema = z
  .object({
    position: z.tuple([z.number(), z.number(), z.number()]).optional(),
    rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
    scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
  })
  .superRefine((t, ctx) => {
    // S3-B #25 HARDEN: scale ≤ 0 on any axis → reject
    if (t.scale) {
      for (let i = 0; i < 3; i++) {
        if (!(t.scale[i] > 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scale", i],
            message: "transform.scale axes must be > 0",
          });
        }
      }
    }
  })
  .optional();

export const SceneNodeSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  transform: SceneNodeTransformSchema,
  defaultClip: z.string().optional(),
  /** S3-A #33 — default true when omitted; false hides in compose, keeps in graph. */
  visible: z.boolean().optional(),
});

/** S3-C #31 — scene-level view prefs (default ground on, shadows off). */
export const SceneViewSchema = z
  .object({
    ground: z.boolean().optional(),
    shadows: z.boolean().optional(),
  })
  .strict();

/** S3-C #32 — orbit bookmark cameras. */
export const SCENE_CAMERAS_MAX = 16;
const FiniteVec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const SceneCameraSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1, "camera name 1–40 chars").max(40, "camera name 1–40 chars"),
    position: FiniteVec3,
    target: FiniteVec3,
    fov: z.number().finite().min(10, "camera fov 10–120").max(120, "camera fov 10–120").optional(),
  })
  .strict();

export const SceneGraphSchema = z
  .object({
    version: z.literal(1).default(1),
    nodes: z.array(SceneNodeSchema).min(1),
    rootId: z.string().optional(),
    view: SceneViewSchema.optional(),
    cameras: z
      .array(SceneCameraSchema)
      .max(SCENE_CAMERAS_MAX, `SCENE_CAMERAS_MAX: at most ${SCENE_CAMERAS_MAX} cameras per scene`)
      .optional(),
  })
  .superRefine((scene, ctx) => {
    if (scene.cameras) {
      const camIds = new Set<string>();
      const camNames = new Set<string>();
      scene.cameras.forEach((c, i) => {
        if (camIds.has(c.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cameras", i, "id"], message: `duplicate camera id "${c.id}"` });
        }
        camIds.add(c.id);
        const key = c.name.trim().toLowerCase();
        if (camNames.has(key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cameras", i, "name"], message: `duplicate camera name "${c.name}"` });
        }
        camNames.add(key);
      });
    }
    const ids = scene.nodes.map((n) => n.id);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes"],
          message: `duplicate scene node id "${id}"`,
        });
      }
      seen.add(id);
    }
    if (scene.rootId && !seen.has(scene.rootId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rootId"],
        message: `rootId "${scene.rootId}" not in nodes[].id`,
      });
    }
  });

/**
 * Mongo `assets` document — matches Designer Sprint 1 asset contract.
 * Also exposes a simplified `paths` + `format` view for early blueprint consumers.
 */
export const AssetSchema = z
  .object({
    id: z.string().uuid(),
    slug: AssetSlugSchema,
    name: z.string().min(1),
    characterType: CharacterTypeSchema,
    stage: AssetStageSchema.default("mvp-billboard"),
    tags: z.array(z.string()).default([]),
    clips: z.array(z.string()).default([]),
    clipUx: ClipUxSchema,
    clipTags: ClipTagsSchema,
    /** S3-B #8 probe-only durations (ms). */
    clipDurations: ClipDurationsSchema,
    /** S3-B #137 SPDX license. */
    license: LicenseSpdxSchema.optional(),
    /** S3-D #88 — optional caption / alt text (trimmed, 1–280); additive, schema stays 3. */
    altText: z.string().min(1).max(ALT_TEXT_MAX, `ALT_TEXT_TOO_LONG: altText must be at most ${ALT_TEXT_MAX} characters`).optional(),
    /** Schema document version; S3-A/B = 3. Missing on older assets → treat as 1|2 in readers. */
    assetSchemaVersion: z.number().int().positive().optional(),
    importMeta: ImportMetaSchema.optional(),
    scene: SceneGraphSchema.optional(),
    formats: AssetFormatsSchema,
    rig: AssetRigSchema.default({
      hasArmature: false,
      hasWeights: false,
    }),
    createdAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
    updatedAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  })
  .superRefine((asset, ctx) => {
    if (asset.clips.length > 0) {
      if (!asset.formats.glb && !asset.formats.fbx) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["formats"],
          message:
            "formats.glb or formats.fbx is required when clips are present",
        });
      }
      if (asset.formats.obj) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["formats", "obj"],
          message:
            "formats.obj must be absent for animated assets (OBJ has no bones/anim)",
        });
      }
    }

    if (asset.stage === "rigged") {
      if (
        !asset.clips.includes("idle") ||
        !asset.clips.includes("walk") ||
        !asset.clips.includes("run")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clips"],
          message: 'stage "rigged" requires clips idle, walk, and run',
        });
      }
      if (!asset.rig.hasArmature || !asset.rig.hasWeights) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rig"],
          message: 'stage "rigged" requires hasArmature and hasWeights true',
        });
      }
      if (!asset.formats.glb) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["formats", "glb"],
          message: 'stage "rigged" requires formats.glb',
        });
      }
    }
    if (asset.stage === "mvp-billboard") {
      if (asset.rig.hasArmature || asset.rig.hasWeights) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rig"],
          message: 'stage "mvp-billboard" must not claim armature/weights',
        });
      }
    }

    // --- S2-G-E3: billboard must not claim jump (spin-only honesty) ---
    if (
      (asset.stage === "mvp-billboard" || asset.characterType === "billboard") &&
      asset.clips.includes("jump")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clips"],
        message:
          'billboard / stage "mvp-billboard" must not claim clip "jump" (spin only)',
      });
    }

    // --- S2-G-E3: clipUx.defaultClip must exist in clips[] when set ---
    if (asset.clipUx?.defaultClip) {
      if (!asset.clips.includes(asset.clipUx.defaultClip)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clipUx", "defaultClip"],
          message: `clipUx.defaultClip "${asset.clipUx.defaultClip}" not in clips[]`,
        });
      }
    }

    if (asset.formats.obj && !asset.formats.glb && !asset.formats.fbx) {
      if (asset.clips.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clips"],
          message: "static OBJ assets must have clips: []",
        });
      }
      if (asset.rig.hasArmature || asset.rig.hasWeights) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rig"],
          message: "static OBJ assets cannot claim armature/weights",
        });
      }
    }

    // --- S2-D-E3: importMeta.actionMap values must be contract clip names ---
    const actionMap = asset.importMeta?.actionMap;
    if (actionMap) {
      for (const [src, dest] of Object.entries(actionMap)) {
        if (!isContractClipName(dest)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["importMeta", "actionMap", src],
            message: `actionMap value "${dest}" is not a contract clip name`,
          });
        }
      }
    }

    // --- S2-D-E3: reject characterType billboard + stage rigged ---
    if (asset.characterType === "billboard" && asset.stage === "rigged") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["characterType"],
        message: 'characterType "billboard" is incompatible with stage "rigged"',
      });
    }

    // --- S2-D-E3: humanoid honesty gates ---
    if (asset.characterType === "humanoid") {
      if (asset.stage !== "rigged") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["characterType"],
          message: 'characterType "humanoid" requires stage "rigged"',
        });
      }
      if (!asset.rig.hasArmature || !asset.rig.hasWeights) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rig"],
          message:
            'characterType "humanoid" requires hasArmature and hasWeights true',
        });
      }
      // S3-D #97 (R1 §5): a clip flagged IDLE_TPOSE_SUSPECT does not fill the idle slot,
      // so a humanoid whose only idle is a T-pose fails this existing gate.
      const tposeIdle = (asset.importMeta?.warnings ?? []).some(
        (w) => w.code === "IDLE_TPOSE_SUSPECT" && (w.clip ?? "idle") === "idle",
      );
      if (
        !asset.clips.includes("idle") ||
        tposeIdle ||
        !asset.clips.includes("walk")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clips"],
          message: 'characterType "humanoid" requires clips idle and walk',
        });
      }

      const meta = asset.importMeta;
      if (!meta) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["importMeta"],
          message:
            'characterType "humanoid" requires importMeta provenance',
        });
      } else {
        // png_pipeline alone is dishonest unless Designer flag is set.
        const provenanceOk =
          meta.source === "mixamo" ||
          meta.source === "fbx" ||
          Boolean(meta.boneMapStub) ||
          meta.humanoidPngApproved === true;
        if (meta.source === "png_pipeline" && meta.humanoidPngApproved !== true) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["importMeta", "source"],
            message:
              'characterType "humanoid" rejected for source "png_pipeline" without humanoidPngApproved',
          });
        } else if (!provenanceOk) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["importMeta"],
            message:
              'characterType "humanoid" requires provenance: source mixamo|fbx, boneMapStub, or humanoidPngApproved',
          });
        }
      }
    }

    // --- S2-E-E3: stage=scene stub honesty ---
    if (asset.stage === "scene") {
      if (!asset.scene || !asset.scene.nodes || asset.scene.nodes.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scene"],
          message:
            'stage "scene" requires scene.nodes with at least one node',
        });
      }
      if (asset.characterType === "humanoid") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["characterType"],
          message:
            'stage "scene" root must not claim characterType "humanoid"',
        });
      }
      if (asset.rig.hasArmature || asset.rig.hasWeights) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rig"],
          message:
            'stage "scene" root must not claim armature/weights (aggregate out of scope)',
        });
      }
      if (asset.clips.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clips"],
          message:
            'stage "scene" root clips must be [] (playback is per-node)',
        });
      }
    } else if (asset.scene) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scene"],
        message: 'scene graph is only valid when stage is "scene"',
      });
    }

    // --- S3-A #5: clipTags keys ∈ clips[]; values ∈ enum (enum already Zod-gated) ---
    if (asset.clipTags) {
      for (const clipName of Object.keys(asset.clipTags)) {
        if (!asset.clips.includes(clipName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["clipTags", clipName],
            message: `clipTags key "${clipName}" is not in clips[]`,
          });
        }
      }
    }

    // --- S3-B #8: clipDurations keys ∈ clips[]; values ≥ 0 int (zod) ---
    if (asset.clipDurations) {
      for (const clipName of Object.keys(asset.clipDurations)) {
        if (!asset.clips.includes(clipName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["clipDurations", clipName],
            message: `clipDurations key "${clipName}" is not in clips[]`,
          });
        }
      }
    }

    // --- S3-A #13: humanoid bone-count gate (≥ 8 distinct bones) ---
    if (asset.characterType === "humanoid") {
      const bc = asset.rig.boneCount;
      if (bc === undefined || bc < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rig", "boneCount"],
          message:
            "HUMANOID_BONE_COUNT: characterType \"humanoid\" requires rig.boneCount ≥ 8",
        });
      }
    }

    // --- S3-C #19: one armature per GLB (armatureCount must be 1 when hasArmature) ---
    const ac = asset.rig.armatureCount;
    if (ac !== undefined && ac > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rig", "armatureCount"],
        message: `MULTI_ARMATURE: one armature per GLB (got ${ac})`,
      });
    } else if (ac !== undefined && asset.rig.hasArmature && ac !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rig", "armatureCount"],
        message: `ARMATURE_COUNT: rig.armatureCount must be 1 when hasArmature (got ${ac})`,
      });
    } else if (ac !== undefined && !asset.rig.hasArmature && ac !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rig", "armatureCount"],
        message: `ARMATURE_COUNT: rig.armatureCount must be 0 when hasArmature is false (got ${ac})`,
      });
    }

  });

export type AssetSlug = z.infer<typeof AssetSlugSchema>;
export type CharacterType = z.infer<typeof CharacterTypeSchema>;
export type AssetStage = z.infer<typeof AssetStageSchema>;
export type AssetFormats = z.infer<typeof AssetFormatsSchema>;
export type AssetRig = z.infer<typeof AssetRigSchema>;
export type ClipUx = z.infer<typeof ClipUxSchema>;
export type SceneView = z.infer<typeof SceneViewSchema>;
export type SceneCamera = z.infer<typeof SceneCameraSchema>;
export type ClipTags = z.infer<typeof ClipTagsSchema>;
export type ClipDurations = z.infer<typeof ClipDurationsSchema>;
export type ImportMeta = z.infer<typeof ImportMetaSchema>;
export type SceneNode = z.infer<typeof SceneNodeSchema>;
export type SceneGraph = z.infer<typeof SceneGraphSchema>;
export type Asset = z.infer<typeof AssetSchema>;

/** Coerce missing assetSchemaVersion for readers (pre-S3-A → 1). */
export function coerceAssetSchemaVersion(asset: { assetSchemaVersion?: number }): number {
  return asset.assetSchemaVersion ?? 1;
}

/** Blueprint-compatible flattened paths view (derived). */
export type AssetPathsView = {
  glb?: string;
  fbx?: string;
  preview: string;
  sourcePng?: string;
  obj?: string;
};

export function toPathsView(asset: Asset): AssetPathsView {
  return {
    glb: asset.formats.glb,
    fbx: asset.formats.fbx,
    preview: asset.formats.preview,
    sourcePng: asset.formats.sourcePng,
    obj: asset.formats.obj,
  };
}

/** Canonical relative GLB path for an asset id */
export function glbPathFor(id: string): string {
  return `assets/${id}/model.glb`;
}

export function fbxPathFor(id: string): string {
  return `assets/${id}/model.fbx`;
}

export function previewPathFor(id: string): string {
  return `assets/${id}/preview.png`;
}

export function inboxPngPattern(slug: string, ts: string): string {
  return `inbox/${slug}/${ts}.png`;
}

export function parseAsset(input: unknown): Asset {
  return AssetSchema.parse(input);
}

export function safeParseAsset(input: unknown) {
  return AssetSchema.safeParse(input);
}
