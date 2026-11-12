# Perf budgets (S3-I #105)

`perf-budgets.json` at the repo root holds the CI budgets that `scripts/perf-budget.mjs` checks in the Node 24 `perf-budgets` job: fixture GLB bytes and the median frame time of a 256-node in-view scene. The frame budget is a SwiftShader number on the Linux runner and box (`--use-gl=swiftshader`), not a native GPU budget. An over-budget line prints the budget, the actual and the `HEAD=` run header.
