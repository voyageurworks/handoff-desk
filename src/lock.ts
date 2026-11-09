import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";

const LOCK_STALE_MS = 2 * 60 * 1000;
/** Shorter than the roughly 60 seconds an MCP client waits for a tool call, so the "busy" message arrives instead of a client timeout. */
const LOCK_WAIT_MS = 45 * 1000;

/**
 * Breaks a dead lock. Only one caller at a time may break (it holds `<lock>.break`), and it checks the age again once it
 * does: a waiter that saw the old lock as dead but arrives after someone else already replaced it finds a fresh lock
 * and leaves it alone. Nothing here ever moves a live lock, so no window opens in which a third caller could take it.
 */
async function breakStale(lockFile: string, staleMs: number): Promise<void> {
  const gate = `${lockFile}.break`;
  try {
    await (await open(gate, "wx")).close();
  } catch {
    // Another caller is breaking. A gate left by a crashed breaker would block everyone, so an old one is removed.
    const age = await stat(gate).then(info => Date.now() - info.mtimeMs).catch(() => 0);
    if (age > staleMs) await unlink(gate).catch(() => undefined);
    return;
  }
  try {
    const age = await stat(lockFile).then(info => Date.now() - info.mtimeMs).catch(() => 0);
    if (age > staleMs) await unlink(lockFile).catch(() => undefined);
  } finally {
    await unlink(gate).catch(() => undefined);
  }
}

/**
 * One desk operation at a time across processes: every Claude Code or Cursor session runs its own server
 * against the same folder. The lock is a file in `dir` created exclusively; one left behind by a crash goes stale.
 */
export async function withLock<T>(dir: string, task: () => Promise<T>, options: { waitMs?: number; staleMs?: number; beatMs?: number } = {}): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lockFile = path.join(dir, ".handoff.lock");
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  // Written into the lock file, so only its owner removes it: an owner whose lock was judged dead and taken over must
  // not delete the new owner's lock when it finishes.
  const token = `${process.pid} ${new Date().toISOString()} ${randomBytes(6).toString("hex")}\n`;
  for (;;) {
    try {
      const handle = await open(lockFile, "wx");
      await handle.writeFile(token);
      await handle.close();
      break;
    } catch (error) {
      // Windows reports EPERM/EBUSY, not EEXIST, while another process is still deleting the lock file.
      if (!["EEXIST", "EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const age = await stat(lockFile).then(info => Date.now() - info.mtimeMs).catch(() => 0);
      if (age > staleMs) {
        await breakStale(lockFile, staleMs);
        continue;
      }
      if (Date.now() > deadline) throw new Error("The desk is busy in another session. Try again in a minute.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  // While the task runs the lock's timestamp is refreshed, so a slow task (a sluggish git remote) is never mistaken
  // for a crashed process and its lock taken over; only a lock nobody is refreshing goes stale.
  const beat = setInterval(() => {
    const now = new Date();
    void utimes(lockFile, now, now).catch(() => undefined);
  }, options.beatMs ?? 10_000);
  beat.unref();
  try {
    return await task();
  } finally {
    clearInterval(beat);
    if (await readFile(lockFile, "utf8").then(text => text === token, () => false)) await unlink(lockFile).catch(() => undefined);
  }
}
