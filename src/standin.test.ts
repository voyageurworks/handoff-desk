import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesk } from "./desk.js";
import { runStandIn } from "./standin.js";

const make = async () => {
  const deskDir = path.join(await mkdtemp(path.join(tmpdir(), "handoff-standin-")), "Desk");
  return { deskDir, desk: createDesk({ deskDir }) };
};
const fileOf = (deskDir: string, relative: string) => path.join(deskDir, path.basename(relative));

describe("runStandIn", () => {
  it("answers a waiting note and marks it done", async () => {
    const { desk, deskDir } = await make();
    const { id } = await desk.send({ type: "errand", title: "Book dentist", request: "Friday" });
    expect(await runStandIn(deskDir)).toBe(1);
    const item = await desk.read(id);
    expect(item.status).toBe("done");
    expect(item.reply).toBe("Stand-in agent received: Book dentist");
    expect(item.answered).not.toBe("");
    expect(await runStandIn(deskDir)).toBe(0);
  });

  it("leaves a note that is not waiting byte-identical", async () => {
    const { desk, deskDir } = await make();
    const { path: relative } = await desk.send({ type: "errand", title: "T", request: "r" });
    const file = fileOf(deskDir, relative);
    const done = (await readFile(file, "utf8")).replace("status: waiting", "status: done");
    await writeFile(file, done);
    expect(await runStandIn(deskDir)).toBe(0);
    expect(await readFile(file, "utf8")).toBe(done);
  });

  it("keeps CRLF line endings", async () => {
    const { desk, deskDir } = await make();
    const { path: relative } = await desk.send({ type: "errand", title: "T", request: "r" });
    const file = fileOf(deskDir, relative);
    await writeFile(file, (await readFile(file, "utf8")).replace(/\n/g, "\r\n"));
    expect(await runStandIn(deskDir)).toBe(1);
    const after = await readFile(file, "utf8");
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    expect(after).toContain("status: done");
  });

  it("ignores files it cannot parse and a missing folder", async () => {
    const { deskDir } = await make();
    expect(await runStandIn(deskDir)).toBe(0); // the folder does not exist yet
    await mkdir(deskDir, { recursive: true });
    await writeFile(path.join(deskDir, "junk.md"), "no front matter");
    expect(await runStandIn(deskDir)).toBe(0);
    expect(await readFile(path.join(deskDir, "junk.md"), "utf8")).toBe("no front matter");
  });
});
