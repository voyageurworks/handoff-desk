import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACKOFF_MS, MAX_AGE_MS, MAX_ATTEMPTS, enqueue, flushOutbox, outboxDir, type Attempt, type OutboxEntry } from "./outbox.js";

const t0 = new Date("2026-11-03T10:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const fresh = async () => path.join(await mkdtemp(path.join(tmpdir(), "handoff outbox-")), "state");
const entries = async (dir: string) => JSON.parse(await readFile(path.join(dir, "outbox.json"), "utf8")) as OutboxEntry[];
const never = async (): Promise<Attempt> => { throw new Error("must not be attempted"); };

describe("the outbox file", () => {
  it("holds a pointer to the note and no text from it", async () => {
    const dir = await fresh();
    await enqueue(dir, 7, ["telegram"], t0);
    const raw = await readFile(path.join(dir, "outbox.json"), "utf8");
    expect(JSON.parse(raw)).toEqual([{ id: 7, channels: ["telegram"], attempts: 1, firstFailedAt: t0.toISOString(), nextAttemptAt: later(BACKOFF_MS[0]).toISOString() }]);
  });
  it("merges a second failure of the same item instead of adding a duplicate", async () => {
    const dir = await fresh();
    await enqueue(dir, 7, ["telegram"], t0);
    await enqueue(dir, 7, ["slack", "telegram"], t0);
    expect((await entries(dir)).map(entry => [entry.id, entry.channels.slice().sort()])).toEqual([[7, ["slack", "telegram"]]]);
  });
  it("lives outside the desk folder, keyed by it, and can be moved with HANDOFF_STATE_DIR", () => {
    const a = outboxDir("/home/me/handoff", {}, "/home/me");
    const b = outboxDir("/home/me/other", {}, "/home/me");
    expect(a).not.toBe(b);
    expect(a.startsWith(path.join("/home/me", ".handoff-desk"))).toBe(true);
    expect(path.relative("/home/me/handoff", a).startsWith("..")).toBe(true);
    expect(outboxDir("/home/me/handoff", { HANDOFF_STATE_DIR: "/var/state" }, "/home/me").startsWith(path.resolve("/var/state"))).toBe(true);
  });
});

describe("flushOutbox", () => {
  it("does nothing before an entry is due", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack"], t0);
    expect(await flushOutbox(dir, never, later(BACKOFF_MS[0] - 1))).toEqual({ resent: [] });
  });
  it("re-sends a due entry, reports what rang and removes it", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack", "telegram"], t0);
    const seen: OutboxEntry[] = [];
    const result = await flushOutbox(dir, async entry => (seen.push(entry), { rung: ["slack", "telegram"], retry: [] }), later(BACKOFF_MS[0]));
    expect(result).toEqual({ resent: [{ id: 1, channels: ["slack", "telegram"] }] });
    expect(seen).toHaveLength(1);
    expect(await entries(dir)).toEqual([]);
  });
  it("keeps only the channel that still failed, counts the attempt and waits longer", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack", "telegram"], t0);
    const now = later(BACKOFF_MS[0]);
    const result = await flushOutbox(dir, async () => ({ rung: ["slack"], retry: ["telegram"] }), now);
    expect(result.resent).toEqual([{ id: 1, channels: ["slack"] }]);
    expect(await entries(dir)).toEqual([{ id: 1, channels: ["telegram"], attempts: 2, firstFailedAt: t0.toISOString(), nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[1]).toISOString() }]);
  });
  it("drops an entry whose note is gone or answered", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack"], t0);
    await flushOutbox(dir, async () => ({ gone: true }), later(BACKOFF_MS[0]));
    expect(await entries(dir)).toEqual([]);
  });
  it("drops a channel that failed for good (not queued as retry) without keeping it", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["telegram"], t0);
    const result = await flushOutbox(dir, async () => ({ rung: [], retry: [] }), later(BACKOFF_MS[0]));
    expect(result.resent).toEqual([]);
    expect(await entries(dir)).toEqual([]);
  });
  it(`gives up after ${MAX_ATTEMPTS} attempts`, async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["telegram"], t0);
    let now = t0;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      now = new Date((await entries(dir))[0].nextAttemptAt);
      await flushOutbox(dir, async () => ({ rung: [], retry: ["telegram"] }), now);
    }
    expect(await entries(dir)).toEqual([]);
  });
  it("gives up after three days even with attempts left", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["telegram"], t0);
    await flushOutbox(dir, async () => ({ rung: [], retry: ["telegram"] }), later(MAX_AGE_MS + 1));
    expect(await entries(dir)).toEqual([]);
  });
  it("one failing entry never blocks another or throws", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack"], t0);
    await enqueue(dir, 2, ["slack"], t0);
    const result = await flushOutbox(dir, async entry => { if (entry.id === 1) throw new Error("boom"); return { rung: ["slack"], retry: [] }; }, later(BACKOFF_MS[0]));
    expect(result.resent).toEqual([{ id: 2, channels: ["slack"] }]);
    expect((await entries(dir)).map(entry => entry.id)).toEqual([1]);
  });
  it("two flushes at once attempt an entry only once", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack"], t0);
    let calls = 0;
    const slow = async (): Promise<Attempt> => { calls++; await new Promise(resolve => setTimeout(resolve, 80)); return { rung: ["slack"], retry: [] }; };
    await Promise.all([flushOutbox(dir, slow, later(BACKOFF_MS[0])), flushOutbox(dir, slow, later(BACKOFF_MS[0]))]);
    expect(calls).toBe(1);
  });
  it("treats a damaged file as empty, and never throws", async () => {
    const dir = await fresh();
    await enqueue(dir, 1, ["slack"], t0);
    await writeFile(path.join(dir, "outbox.json"), "{not json", "utf8");
    expect(await flushOutbox(dir, never, later(BACKOFF_MS[0]))).toEqual({ resent: [] });
    await enqueue(dir, 2, ["slack"], t0);
    expect((await entries(dir)).map(entry => entry.id)).toEqual([2]);
  });
});
