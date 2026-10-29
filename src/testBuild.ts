import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { withLock } from "./lock.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const newest = (dir: string): number =>
  readdirSync(dir).reduce((latest, name) => {
    const full = path.join(dir, name);
    return Math.max(latest, statSync(full).isDirectory() ? newest(full) : statSync(full).mtimeMs);
  }, 0);

/**
 * Test helper: builds `dist/` unless it is already newer than every source file. Test files run in parallel, so the
 * build is serialized with the same lock the desk uses.
 */
export async function ensureBuilt(): Promise<string> {
  const entry = path.join(ROOT, "dist", "main.js");
  await withLock(path.join(ROOT, ".build-lock"), async () => {
    const built = statSync(entry, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (built > newest(path.join(ROOT, "src"))) return;
    execFileSync("pnpm", ["build"], { cwd: ROOT, shell: true, stdio: "pipe" });
  }, { waitMs: 180_000 });
  return entry;
}
