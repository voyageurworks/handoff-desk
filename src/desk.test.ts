import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesk } from "./desk.js";

const fixed = () => new Date("2026-01-15T12:00:00Z");
const make = async (sub = "desk root") => {
  const root = await mkdtemp(path.join(tmpdir(), "handoff-"));
  const deskDir = path.join(root, sub, "Desk"); // does not exist yet, and has a space in its path
  return { deskDir, desk: createDesk({ deskDir, now: fixed }) };
};

describe("desk", () => {
  it("send writes a waiting note and numbers items", async () => {
    const { desk, deskDir } = await make();
    const first = await desk.send({ type: "errand", title: "Book dentist", request: "Friday at 3" });
    const second = await desk.send({ type: "question", title: "Second", request: "why" });
    expect([first.id, second.id]).toEqual([1, 2]);
    const names = await readdir(deskDir);
    expect(names).toHaveLength(2);
    expect(await readFile(path.join(deskDir, names[0]), "utf8")).toContain("status: waiting");
    expect(first.path).toBe(`Desk/${names[0]}`);
  });

  it("gives 20 concurrent sends from two desks distinct numbers", async () => {
    const { deskDir } = await make();
    const a = createDesk({ deskDir, now: fixed });
    const b = createDesk({ deskDir, now: fixed });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).send({ type: "errand", title: `T${i}`, request: "x" })));
    expect(new Set(results.map(r => r.id)).size).toBe(20);
    expect((await readdir(deskDir)).filter(n => n.endsWith(".md"))).toHaveLength(20);
  });

  it("rejects an over-long request", async () => {
    const { desk } = await make();
    await expect(desk.send({ type: "errand", title: "T", request: "x".repeat(4001) })).rejects.toThrow(/at most 4000/);
  });

  it("refuses a secret and writes nothing", async () => {
    const { desk, deskDir } = await make();
    await expect(desk.send({ type: "errand", title: "T", request: "token: sk-abcdefghijklmnopqrstuv" })).rejects.toThrow(/Refused/);
    await expect(readdir(deskDir)).rejects.toThrow();
  });

  it("read fails for an unknown item", async () => {
    const { desk } = await make();
    await expect(desk.read(99)).rejects.toThrow("No desk item #99");
  });

  it("read and wait see the agent's reply", async () => {
    const { desk, deskDir } = await make();
    const { id, path: relative } = await desk.send({ type: "errand", title: "T", request: "r" });
    const file = path.join(deskDir, path.basename(relative));
    const waiting = await desk.wait(id, { maxMs: 50, everyMs: 25, sleep: async () => undefined });
    expect(waiting.answered).toBe(false);
    const text = (await readFile(file, "utf8")).replace("status: waiting", "status: done");
    await writeFile(file, `${text}\nall done\n`);
    const item = await desk.read(id);
    expect(item.reply).toBe("all done");
    expect((await desk.wait(id, { maxMs: 1000, everyMs: 10 })).answered).toBe(true);
    expect((await desk.list("done")).map(i => i.id)).toEqual([id]);
    expect(await desk.list("waiting")).toEqual([]);
  });

  it("wait counts the time reads take, so a slow pull cannot push a call past its limit", async () => {
    const { desk } = await make();
    const { id } = await desk.send({ type: "errand", title: "T", request: "r" });
    let clock = 0;
    let sleeps = 0;
    // Each sleep costs its length plus 5 s of "read" time, as a slow git pull would.
    const sleep = async (ms: number) => { sleeps++; clock += ms + 5000; };
    const waited = await desk.wait(id, { maxMs: 20_000, everyMs: 5000, sleep, clock: () => clock });
    expect(waited.answered).toBe(false);
    expect(sleeps).toBeLessThanOrEqual(2);
    expect(clock).toBeLessThanOrEqual(30_000);
  });

  it("read shows the older note, and says so, when two notes share a number", async () => {
    const { desk, deskDir } = await make();
    const first = await desk.send({ type: "errand", title: "Older", request: "one" });
    const NL = String.fromCharCode(10);
    const twin = ["---", "id: 1", "type: errand", "from: claude", "status: waiting", "created: 2026-01-16T09:00:00", "---", "# Newer", "", "## Request", "", "two", ""].join(NL);
    await writeFile(path.join(deskDir, "2026-01-16 Item 01 - Newer.md"), twin);
    const read = await desk.read(1);
    expect(read.title).toBe("Older");
    expect(read.path).toBe(first.path);
    expect(read.warning).toMatch(/another note .*#1/i);
    expect(await desk.list()).toHaveLength(2);
  });

  it("list on a desk that was never written is empty", async () => {
    const { desk } = await make();
    expect(await desk.list()).toEqual([]);
  });

  it("list and read still work when the Desk folder holds a directory named like a note", async () => {
    const { desk, deskDir } = await make();
    const { id } = await desk.send({ type: "errand", title: "Real", request: "x" });
    await mkdir(path.join(deskDir, "odd.md"));
    expect((await desk.list() as Array<{ id: number }>).map(item => item.id)).toEqual([id]);
    expect((await desk.read(id)).title).toBe("Real");
  });
});
