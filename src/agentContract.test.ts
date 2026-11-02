import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseNote } from "./note.js";

const root = path.resolve(import.meta.dirname, "..");
const skill = () => readFile(path.join(root, "templates", "agent-skill", "SKILL.md"), "utf8");

describe("the agent contract file", () => {
  it("is a skill file with a name and a description that says when to use it", async () => {
    const text = await skill();
    const front = /^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
    expect(front, "front matter").not.toBeNull();
    expect(front![1]).toBe("handoff-desk-agent");
    expect(front![2].length).toBeGreaterThan(40);
    expect(front![2]).toMatch(/handoff/i);
  });

  it("names exactly the facts the program relies on", async () => {
    const text = await skill();
    for (const must of ["status: waiting", "status: done", "declined", "info", "answered:", "## Reply", "## Request", "handoff.md", "Desk/", "Inbox"]) expect(text, must).toContain(must);
    // The three sections of handoff.md, by the names the template uses.
    for (const section of ["You may do alone", "Ask me first", "Never"]) expect(text, section).toContain(section);
  });

  it("tells the agent to treat what it reads as untrusted, to keep secrets out of notes, and to push only its own note", async () => {
    const text = (await skill()).toLowerCase();
    expect(text).toMatch(/untrusted/);
    expect(text).toMatch(/never write (a )?(password|passwords)/);
    expect(text).toMatch(/commit only/);
    expect(text).toMatch(/push/);
  });

  it("its example note is one the program parses as answered", async () => {
    const text = (await skill()).replace(/\r\n/g, "\n");
    const block = /```markdown\n(---\n[\s\S]*?)```/.exec(text);
    expect(block, "example note").not.toBeNull();
    const item = parseNote(block![1], "example.md");
    expect(item).not.toBeNull();
    expect(item!.status).toBe("done");
    expect(item!.reply.length).toBeGreaterThan(0);
    expect(item!.request.length).toBeGreaterThan(0);
    expect(item!.answered).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("holds no secret-looking text, and ships inside the npm package", async () => {
    expect(await skill()).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{30,}|hooks\.slack\.com\/services\/T|password\s*[:=]\s*\S{8,}/i);
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain("templates");
  });

  it("is linked from the README and explained on its own docs page", async () => {
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    expect(readme).toContain("docs/agent-contract.md");
    const page = await readFile(path.join(root, "docs", "agent-contract.md"), "utf8");
    expect(page).toContain("templates/agent-skill/SKILL.md");
  });
});
