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
  });

export type AssetSlug = z.infer<typeof AssetSlugSchema>;
export type CharacterType = z.infer<typeof CharacterTypeSchema>;
export type AssetStage = z.infer<typeof AssetStageSchema>;
export type AssetFormats = z.infer<typeof AssetFormatsSchema>;
export type AssetRig = z.infer<typeof AssetRigSchema>;
export type ClipUx = z.infer<typeof ClipUxSchema>;
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
