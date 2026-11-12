/**
 * S3-I #59 — every GLTF load decodes Draco with the vendored decoder in public/draco/
 * (pinned + checksummed, see draco-vendor.mjs). Passed to useGLTF explicitly so drei never
 * falls back to its remote default decoder URL. Decoder config is left at the loader default (ruling).
 */
export const DRACO_PATH = "/draco/";
