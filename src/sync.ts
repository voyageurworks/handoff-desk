import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Identity = { name: string; email: string };
/** `root`: the work tree; `gitDir`: where the cross-process lock lives (never committed). */
export type SyncHandle = { root: string; gitDir: string; identity?: Identity };

/** The note's commit exists in the desk's clone, but the push didn't go through. */
export class PushFailedError extends Error {
  constructor(detail: string) {
    super(`The push failed twice; the change is committed in the desk's clone but not pushed yet. Don't send it again: it goes up with the next call. ${detail}`.trim());
    this.name = "PushFailedError";
  }
}

/** git never stops to ask for a password: there is no one at an MCP server's terminal. */
export const NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
/** A pull or push to a network that swallows packets fails here, well before the 2-minute lock goes stale. */
const GIT_TIMEOUT_MS = 60_000;

/** A remote URL may carry a token (https://user:token@host/...), and git echoes it in its command line and errors. */
const scrub = (text: string) => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[redacted]@");

/** Only transports a desk should ever use: `ext::` runs a command, and the old `git://` is unencrypted. */
const ALLOWED_PROTOCOLS = "file:https:ssh";

/** A read (list, read, wait) gives up on the remote sooner and answers from this computer's copy, so it never outlasts an MCP client's own limit. */
export const READ_GIT_TIMEOUT_MS = 15_000;

export async function git(cwd: string, args: string[], timeoutMs: number = GIT_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, ...NO_PROMPT_ENV, GIT_ALLOW_PROTOCOL: ALLOWED_PROTOCOLS } });
    return stdout.trim();
  } catch (error) {
    // Whatever is thrown on, the secret must not travel with it.
    const failure = error as { message?: string; stderr?: string; cmd?: string };
    for (const key of ["message", "stderr", "cmd"] as const) if (typeof failure[key] === "string") failure[key] = scrub(failure[key]);
    throw error;
  }
}

const gitMessage = (error: unknown) => {
  const stderr = (error as { stderr?: string }).stderr?.trim();
  return (stderr || (error instanceof Error ? error.message : String(error))).split("\n").slice(-3).join(" ").slice(0, 300);
};

/**
 * Pulls with rebase; a conflict is aborted so the clone never stays mid-rebase. The user's own uncommitted edits to
 * tracked files (say, handoff.md) are stashed around the pull so they never block a call, then put back. If they
 * conflict with what was pulled, they stay in `git stash`, the clone is left clean and current, and the error says so:
 * nothing is lost, and the next call works.
 */
export async function pullRebase(cwd: string, identity?: Identity, timeoutMs?: number): Promise<void> {
  const dirty = Boolean(await git(cwd, ["status", "--porcelain", "--untracked-files=no"]).catch(() => ""));
  // A stash is a commit, so it needs an identity even when the repository has none configured.
  const who = identityArgs(identity ?? { name: "handoff-desk", email: "handoff-desk@localhost" });
  if (dirty) await git(cwd, [...who, "stash", "push", "--quiet", "--message", "handoff-desk: your uncommitted edits"]);
  try {
    await git(cwd, [...identityArgs(identity), "pull", "--rebase", "--quiet"], timeoutMs);
  } catch (error) {
    await git(cwd, ["rebase", "--abort"]).catch(() => undefined);
    if (dirty) await git(cwd, ["stash", "pop", "--quiet"]).catch(() => undefined);
    // Where the clone stands, so a failure in a cloud run (where nobody can look) explains itself.
    const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "unknown");
    const upstream = await git(cwd, ["rev-parse", "--abbrev-ref", "@{u}"]).catch(() => "");
    const remotes = (await git(cwd, ["remote"]).catch(() => "")).split("\n").filter(Boolean).join(", ") || "none";
    throw new Error(`Couldn't update the desk (git pull --rebase): ${gitMessage(error)} [branch ${branch}, ${upstream ? `upstream ${upstream}` : "no upstream"}, remotes: ${remotes}]`);
  }
  if (!dirty) return;
  try {
    await git(cwd, ["stash", "pop", "--quiet"]);
  } catch {
    // The edits conflict with what was just pulled. `stash pop` keeps the stash on conflict, so nothing is lost:
    // drop the half-applied merge and leave the clone clean and current.
    await git(cwd, ["reset", "--hard", "--quiet", "HEAD"]);
    throw new Error("Your uncommitted edits to tracked files conflict with changes just pulled from the remote, so they were left in `git stash` (see `git stash list`; `git stash pop` brings them back). The desk itself is up to date and nothing was lost; the next call will work.");
  }
}

/** Pushes commits an earlier failed push left in the clone. Returns how many went up. */
export async function pushPending(cwd: string, timeoutMs?: number): Promise<number> {
  const ahead = Number(await git(cwd, ["rev-list", "--count", "@{u}..HEAD"]).catch(() => "0"));
  if (!ahead) return 0;
  await git(cwd, ["push", "--quiet"], timeoutMs);
  return ahead;
}

const identityArgs = (identity?: Identity) => (identity ? ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`] : []);

/** Stages only `paths`, commits them, and pushes; a rejected push gets one pull --rebase and retry. */
export async function commitAndPush(cwd: string, paths: string[], message: string, identity?: Identity): Promise<void> {
  await git(cwd, ["add", "--", ...paths]);
  await git(cwd, [...identityArgs(identity), "commit", "--quiet", "-m", message, "--", ...paths]);
  try {
    await git(cwd, ["push", "--quiet"]);
    return;
  } catch {
    // Usually the agent pushed a reply meanwhile: rebase onto it and try once more.
  }
  try {
    await pullRebase(cwd, identity);
    await git(cwd, ["push", "--quiet"]);
  } catch (error) {
    throw new PushFailedError(gitMessage(error));
  }
}

/**
 * Whether the desk syncs through git. `HANDOFF_SYNC` off: never. auto (default): only when `dir` is inside a work tree
 * whose branch has an upstream. git: required, and an error when that isn't true.
 */
export async function detectSync(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncHandle | null> {
  const mode = (env.HANDOFF_SYNC || "auto").toLowerCase();
  if (mode === "off") return null;
  try {
    const root = await git(dir, ["rev-parse", "--show-toplevel"]);
    const gitDir = await git(dir, ["rev-parse", "--absolute-git-dir"]);
    await git(dir, ["rev-parse", "--abbrev-ref", "@{u}"]);
    // Without any identity git refuses to commit ("Please tell me who you are"), which in a fresh cloud session would fail
    // every send. So when neither the settings nor git itself know who we are, a neutral one is used.
    const configured = env.HANDOFF_GIT_NAME && env.HANDOFF_GIT_EMAIL ? { name: env.HANDOFF_GIT_NAME, email: env.HANDOFF_GIT_EMAIL } : undefined;
    const gitKnows = Boolean(await git(dir, ["config", "user.name"]).catch(() => "")) && Boolean(await git(dir, ["config", "user.email"]).catch(() => ""));
    const identity = configured ?? (gitKnows ? undefined : { name: "handoff-desk", email: "handoff-desk@localhost" });
    return { root: path.normalize(root), gitDir: path.normalize(gitDir), ...(identity ? { identity } : {}) };
  } catch {
    if (mode === "git") throw new Error(`HANDOFF_SYNC=git but ${dir} is not inside a git repository with an upstream`);
    return null;
  }
}

/** Clones `remote` into `dir` when `dir` is missing or empty (first use in a cloud session); otherwise leaves it alone. */
export async function ensureClone(dir: string, remote: string): Promise<void> {
  const names = await readdir(dir).catch(() => null);
  if (names && names.length) return;
  await mkdir(path.dirname(dir), { recursive: true });
  // `--` so a value that starts with a dash can never be read as a git option.
  await git(path.dirname(dir), ["clone", "--quiet", "--", remote, dir]);
}
