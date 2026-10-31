/**
 * S3-E E3 — resolve an external CLI (gitleaks / actionlint / shellcheck) without a shell.
 * `override` (e.g. GITLEAKS_BIN) wins; otherwise search PATH. Returns null when missing so the
 * caller can print a SKIP_PLATFORM line (D2: a missing tool is a platform skip, never a 7th code).
 */
import fs from "node:fs";
import path from "node:path";

export function resolveTool(name, override) {
  const isExe = (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (override) return isExe(override) ? override : null;
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isExe(p)) return p;
    }
  }
  return null;
}

/**
 * S3-F CO-2 — an explicitly set tool override (GITLEAKS_BIN / ACTIONLINT_BIN / SHELLCHECK_BIN) must be an
 * executable file. Returns null when unset/empty or OK, else a reason ("does not exist", "is not a file",
 * "is not executable") — callers print the variable name with the reason, never the path.
 */
export function overrideProblem(value) {
  if (!value) return null;
  let st;
  try {
    st = fs.statSync(value);
  } catch {
    return "does not exist";
  }
  if (!st.isFile()) return "is not a file";
  try {
    fs.accessSync(value, fs.constants.X_OK);
  } catch {
    return "is not executable";
  }
  return null;
}
