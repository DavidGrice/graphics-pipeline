# S2-D Mixamo / FBX import — LIMITS

**Lane:** S2-D-E2 · Pack branch `enhancement/s2d-rigged-clips`  
**Companion:** `docs/sprint2d-d2-mixamo-import-schematic.md` · `docs/sprint2d-brief.md` §3

## What is in-repo

| Artifact | Path |
|----------|------|
| Headless remap | `apps/blender-pipeline/import_fbx_to_glb.py` |
| Wrapper | `apps/blender-pipeline/import_fbx.sh` (`BLENDER_BIN` fail-closed) |
| Register | `register_asset.mjs --import-meta path.json` (probe still wins) |

**No licensed Mixamo FBX/GLB is committed.** Mixamo characters are Adobe-licensed; do **not** put them under `data/**` or any tracked path.

## Synthetic proof path (CI / box)

Build a throwaway Mixamo-*named* Actions GLB under `/tmp` (not git):

```bash
export BLENDER_BIN=/home/box/tools/blender   # or your install

# 1) Synthesize armature+weights with Actions Idle / Walking / Running
$BLENDER_BIN --background --python /tmp/synth_mixamo_like.py -- /tmp/mixamo_like_in.glb

# 2) Remap → contract idle/walk/run + importMeta
apps/blender-pipeline/import_fbx.sh /tmp/mixamo_like_in.glb /tmp/mixamo_out.glb \
  --source mixamo --meta-out /tmp/mixamo_meta.json

# 3) Assert
node -e '
const fs=require("fs"); const b=fs.readFileSync("/tmp/mixamo_out.glb");
let o=12; let j; const n=b.readUInt32LE(8);
while(o+8<=n){const l=b.readUInt32LE(o),t=b.toString("utf8",o+4,o+8);o+=8;
  if(t==="JSON"){j=JSON.parse(b.subarray(o,o+l).toString());break;} o+=l;}
const clips=(j.animations||[]).map(a=>a.name);
if(!clips.includes("idle")||!clips.includes("walk")||!clips.includes("run")) process.exit(1);
const m=JSON.parse(fs.readFileSync("/tmp/mixamo_meta.json","utf8"));
if(m.source!=="mixamo"||!m.actionMap) process.exit(2);
console.log("PASS", clips, m.actionMap);
'
```

The synth helper used on the Engineer box lives only under `/tmp` (never committed).

## Real Mixamo file (local only)

1. Download a character+animation FBX from Mixamo (your Adobe account).  
2. Keep it outside the repo (e.g. `~/Downloads/Y Bot.fbx`) or a **gitignored** inbox.  
3. Run:

```bash
export BLENDER_BIN=/path/to/blender
apps/blender-pipeline/import_fbx.sh \
  "~/Downloads/Y Bot.fbx" /tmp/ybot_out.glb \
  --source mixamo --meta-out /tmp/ybot_meta.json

# Optional register (API must be up; still no data/** commit of media):
node apps/blender-pipeline/register_asset.mjs \
  --glb /tmp/ybot_out.glb --slug ybot-mixamo \
  --import-meta /tmp/ybot_meta.json --mode rigged
```

`characterType` becomes `humanoid` when probe gates pass and `importMeta.source` is `mixamo`|`fbx`. PNG pipeline remains `prop` unless `humanoidPngApproved`.

## Fail-closed

| Condition | Result |
|-----------|--------|
| No armature after import | exit ≠ 0 |
| No vertex weights | exit ≠ 0 |
| Missing remapped `idle`/`walk` | exit ≠ 0 |
| Unknown Action names | left as-is; **not** invented into required names |
| `BLENDER_BIN` missing | wrapper exit 127 |

## Out of scope (Sprint 3+)

Full Mixamo library matrix, Rigify humanoid retarget, auto bone-map beyond `boneMapStub`.

## S2-E follow-up

Alias table v2 + second fixture path: see **`docs/s2e-mixamo-LIMITS.md`**.
