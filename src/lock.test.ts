import { mkdir, mkdtemp, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withLock } from "./lock.js";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe("withLock", () => {
  it("a long task is not mistaken for a crashed one (its lock is kept fresh)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-lock-"));
    const events: string[] = [];
    const first = withLock(dir, async () => {
      events.push("a-start");
      await sleep(1500);
      events.push("a-end");
    }, { staleMs: 300, beatMs: 50 });
    await sleep(100);
    const second = withLock(dir, async () => {
      events.push("b-start");
      events.push("b-end");
    }, { staleMs: 300, beatMs: 50, waitMs: 8000 });
    await Promise.all([first, second]);
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("a lock left behind by a crashed process goes stale and is taken over", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-lock-"));
    await mkdir(dir, { recursive: true });
    const lockFile = path.join(dir, ".handoff.lock");
    await writeFile(lockFile, "999999 long ago\n");
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(lockFile, old, old);
    await expect(withLock(dir, async () => "got it", { staleMs: 1000, waitMs: 3000 })).resolves.toBe("got it");
  });

  it("gives up with a clear message when the lock stays held", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-lock-"));
    const holder = withLock(dir, async () => sleep(1500), { beatMs: 50 });
    await sleep(100);
    await expect(withLock(dir, async () => "no", { waitMs: 300 })).rejects.toThrow(/busy in another session/);
    await holder;
  });

  it("never lets two waiters hold a stale lock at once", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-lock-"));
    const lockFile = path.join(dir, ".handoff.lock");
    await writeFile(lockFile, "999999 long ago");
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(lockFile, old, old);
    let active = 0;
    let most = 0;
    await Promise.all(Array.from({ length: 6 }, () => withLock(dir, async () => {
      active++;
      most = Math.max(most, active);
      await sleep(40);
      active--;
    }, { staleMs: 1000, waitMs: 10_000, beatMs: 20 })));
    expect(most).toBe(1);
  });

  it("an owner whose lock was taken over does not delete the new owner's lock", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-lock-"));
    const lockFile = path.join(dir, ".handoff.lock");
    let second: Promise<void> = Promise.resolve();
    await withLock(dir, async () => {
      await unlink(lockFile); // as if this owner had been judged dead and its lock broken
      second = withLock(dir, async () => sleep(400), { beatMs: 50 });
      await sleep(150);
    }, { beatMs: 50 });
    const stillThere = await stat(lockFile).then(() => true, () => false);
    await second;
    expect(stillThere).toBe(true);
  });
});
