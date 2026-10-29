import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Test helper: runs git synchronously and returns trimmed stdout. */
export function sh(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
}

function configure(dir: string, name: string) {
  sh(dir, ["config", "user.name", name]);
  sh(dir, ["config", "user.email", `${name.replace(/\s+/g, "-")}@example.com`]);
  sh(dir, ["config", "commit.gpgsign", "false"]);
  sh(dir, ["config", "core.autocrlf", "false"]);
}

/** A bare "remote" with one commit on main, and two clones of it: the user's PC (A) and a cloud agent (B). */
export async function makeRemote(): Promise<{ root: string; bare: string; cloneA: string; cloneB: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "handoff-git-"));
  const bare = path.join(root, "remote.git");
  sh(root, ["init", "--bare", "-b", "main", bare]);
  const seed = path.join(root, "seed");
  sh(root, ["clone", "-q", "-c", "core.autocrlf=false", bare, seed]);
  configure(seed, "seed user");
  sh(seed, ["checkout", "-q", "-B", "main"]);
  await writeFile(path.join(seed, "README.md"), "desk repo\n");
  sh(seed, ["add", "README.md"]);
  sh(seed, ["commit", "-q", "-m", "initial"]);
  sh(seed, ["push", "-q", "-u", "origin", "main"]);
  const cloneA = path.join(root, "clone a");
  const cloneB = path.join(root, "clone b");
  for (const [dir, who] of [[cloneA, "user pc"], [cloneB, "cloud agent"]] as const) {
    sh(root, ["clone", "-q", "-c", "core.autocrlf=false", bare, dir]);
    configure(dir, who);
  }
  return { root, bare, cloneA, cloneB };
}
