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
  blenderVersionTested: z.string().optional(),
});

/** Viewer clip authoring prefs (S2-D) — durable on asset JSON. */
export const ClipUxSchema = z
  .object({
    defaultClip: z.string().optional(),
    order: z.array(z.string()).optional(),
    disabled: z.array(z.string()).optional(),
  })
  .optional();

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
export const ImportMetaSchema = z.object({
  source: z.enum(["mixamo", "fbx", "png_pipeline", "unknown"]),
  originalFilename: z.string().optional(),
  actionMap: z.record(z.string(), z.string()).optional(),
  boneMapStub: z.string().optional(),
  characterTypeHint: z.enum(["humanoid", "prop", "unknown"]).optional(),
  humanoidPngApproved: z.boolean().optional(),
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
  .optional();

export const SceneNodeSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  transform: SceneNodeTransformSchema,
  defaultClip: z.string().optional(),
});

export const SceneGraphSchema = z
  .object({
    version: z.literal(1).default(1),
    nodes: z.array(SceneNodeSchema).min(1),
    rootId: z.string().optional(),
  })
  .superRefine((scene, ctx) => {
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
      if (
        !asset.clips.includes("idle") ||
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

  });

export type AssetSlug = z.infer<typeof AssetSlugSchema>;
export type CharacterType = z.infer<typeof CharacterTypeSchema>;
export type AssetStage = z.infer<typeof AssetStageSchema>;
export type AssetFormats = z.infer<typeof AssetFormatsSchema>;
export type AssetRig = z.infer<typeof AssetRigSchema>;
export type ClipUx = z.infer<typeof ClipUxSchema>;
export type ImportMeta = z.infer<typeof ImportMetaSchema>;
export type SceneNode = z.infer<typeof SceneNodeSchema>;
export type SceneGraph = z.infer<typeof SceneGraphSchema>;
export type Asset = z.infer<typeof AssetSchema>;

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
