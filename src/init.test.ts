import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initDesk } from "./init.js";

const exists = (file: string) => stat(file).then(() => true, () => false);

describe("initDesk", () => {
  it("creates the folders and the handoff.md template", async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff-init-")), "my desk");
    const result = await initDesk(dir);
    for (const name of ["Desk", "Inbox", "mail"]) expect(await exists(path.join(dir, name))).toBe(true);
    expect(await readFile(path.join(dir, "handoff.md"), "utf8")).toContain("## You may do alone");
    expect(result.created).toContain("handoff.md");
    expect(result.kept).toEqual([]);
  });
  it("keeps mail copies and the lock out of git, once, without touching other lines", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-init-"));
    await writeFile(path.join(dir, ".gitignore"), "node_modules/\n");
    await initDesk(dir);
    await initDesk(dir);
    const lines = (await readFile(path.join(dir, ".gitignore"), "utf8")).split("\n").filter(Boolean);
    expect(lines).toEqual(["node_modules/", "mail/", ".handoff.lock"]);
  });
  it("uses a custom inbox folder name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-init-"));
    await initDesk(dir, { inboxDir: "For Claude" });
    expect(await exists(path.join(dir, "For Claude"))).toBe(true);
    expect(await exists(path.join(dir, "Inbox"))).toBe(false);
  });
  it("never overwrites an edited handoff.md", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-init-"));
    await initDesk(dir);
    await writeFile(path.join(dir, "handoff.md"), "my own rules\n");
    const again = await initDesk(dir);
    expect(await readFile(path.join(dir, "handoff.md"), "utf8")).toBe("my own rules\n");
    expect(again.kept).toContain("handoff.md");
    expect(again.created).not.toContain("handoff.md");
  });
});
