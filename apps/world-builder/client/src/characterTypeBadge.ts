/**
 * S3-C #21 — CharacterType badge for the register list (D2 §5).
 * Value comes from the stored asset (post-gate) — never importMeta.characterTypeHint.
 * Text label always present (not color-only).
 */
export type CharacterTypeBadge = {
  label: string;
  /** CSS modifier: accent | neutral | muted | scene */
  tone: "accent" | "neutral" | "muted" | "scene";
};

export function characterTypeBadge(asset: {
  stage?: string;
  characterType?: string;
}): CharacterTypeBadge {
  if (asset.stage === "scene") return { label: "Scene", tone: "scene" };
  switch (asset.characterType) {
    case "humanoid":
      return { label: "Humanoid", tone: "accent" };
    case "prop":
      return { label: "Prop", tone: "neutral" };
    case "billboard":
      return { label: "Billboard", tone: "neutral" };
    default:
      return { label: "Unknown", tone: "muted" };
  }
}
