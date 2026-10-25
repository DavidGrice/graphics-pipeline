# S2-E Mixamo / FBX import — LIMITS (alias v2)

**Lane:** S2-E-E2 · Pack `enhancement/s2e-scene-importmeta`  
**Extends:** `docs/s2d-mixamo-LIMITS.md` · Companion: `docs/sprint2e-d2-mixamo-alias-v2.md` · R1 §3

## Alias table delta (v2)

Kept from S2-D: `Idle`/`Idle_A`→`idle`, `Walking`/`Walk`→`walk`, `Running`/`Run`→`run`, `Jump`→`jump`, `Wave`→`wave`.

**New / expanded (Engineer `ACTION_REMAP`):**

| Source examples | → Contract |
|-----------------|------------|
| `Idle01`, `Idle_Neutral`, `Standing Idle` | `idle` |
| `Walk_Forward`, `WalkForward`, `walk_fwd` | `walk` |
| `Jogging`, `Jog` | `run` |
| `Jumping` | `jump` |
| `Waving` | `wave` |
| `Attack`, `Punch`, `Slash` | `attack` |
| `Death`, `Dying` | `death` |
| `Sit`, `Sitting` | `sit` |
| `Emote_*` / `Gesture_*` | `emote_*` (normalized) |
| `Tpose`, `T-Pose`, `bind` | **unmapped** — do **not** invent `idle` |

Lookup is exact, then Blender `.001` base, then case-insensitive. Unmapped Actions stay raw (probe keep / UX strip).

**No licensed Mixamo media under `data/**` or any tracked path.**

## Second synth / fixture path (beyond Idle/Walk/Run trio)

Proves Jogging→run + Jumping→jump under `/tmp` (never git):

```bash
export BLENDER_BIN=/home/box/tools/blender   # or your install

# 1) Synth armature+weights with Actions Idle / Walk_Forward / Jogging / Jumping
$BLENDER_BIN --background --python /tmp/synth_mixamo_alias_v2.py -- /tmp/mixamo_v2_in.glb

# 2) Remap via alias v2
apps/blender-pipeline/import_fbx.sh /tmp/mixamo_v2_in.glb /tmp/mixamo_v2_out.glb \
  --source mixamo --meta-out /tmp/mixamo_v2_meta.json

# 3) Assert extras remapped
node -e '
const fs=require("fs"); const b=fs.readFileSync("/tmp/mixamo_v2_out.glb");
let o=12; let j; const n=b.readUInt32LE(8);
while(o+8<=n){const l=b.readUInt32LE(o),t=b.toString("utf8",o+4,o+8);o+=8;
  if(t==="JSON"){j=JSON.parse(b.subarray(o,o+l).toString());break;} o+=l;}
const clips=(j.animations||[]).map(a=>a.name);
for (const c of ["idle","walk","run","jump"]) if(!clips.includes(c)) process.exit(1);
const m=JSON.parse(fs.readFileSync("/tmp/mixamo_v2_meta.json","utf8"));
const vals=Object.values(m.actionMap||{});
if(!vals.includes("run")||!vals.includes("jump")) process.exit(2);
console.log("PASS v2", clips, m.actionMap);
'
```

### `/tmp/synth_mixamo_alias_v2.py` (box-only; do not commit)

Generate once on the Engineer/Tester box — Actions named `Idle`, `Walk_Forward`, `Jogging`, `Jumping` (plus a `Tpose` that must remain unmapped). Same armature+weights pattern as S2-D `/tmp/synth_mixamo_like.py`.

## Fail-closed (unchanged)

Missing armature / weights / remapped `idle`+`walk` → non-zero. `BLENDER_BIN` missing → wrapper 127. Unknown names left as-is.

## Out of scope

Full Mixamo marketplace matrix, Rigify retarget (Sprint 3+).
