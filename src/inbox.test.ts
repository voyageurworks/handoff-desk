import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoteFileName, INBOX_DIR, listInbox, parseInboxNote, replyToInbox } from "./inbox.js";

describe("inbox notes", () => {
  it("a free-form note without front matter is new, then answered after a reply", () => {
    const text = "# Idea\n\nTry the cheaper plan.\n";
    expect(parseInboxNote(text, "idea.md").status).toBe("new");
    const replied = replyToInbox(text, "Thanks, will do.", "2026-01-15T12:00:00+00:00");
    expect(parseInboxNote(replied, "idea.md").status).toBe("answered");
    expect(replied).toContain("## Claude's reply (2026-01-15T12:00:00+00:00)");
  });
  it("a repeated identical reply leaves the text unchanged", () => {
    const once = replyToInbox("# A\n\nbody\n", "same", "t1");
    expect(replyToInbox(once, "same", "t2")).toBe(once);
  });
  it("a retried reply that contains its own headings is not added twice", () => {
    const reply = ["Plan:", "", "## Steps", "", "1. one", "", "# Notes", "", "done"].join(String.fromCharCode(10));
    const once = replyToInbox("# A body", reply, "t1");
    expect(replyToInbox(once, reply, "t2")).toBe(once);
  });
  it("a short new reply is not mistaken for the start of an earlier, longer one", () => {
    const first = replyToInbox("# A body", "okay, thanks for the update", "t1");
    expect(replyToInbox(first, "okay", "t2")).not.toBe(first);
  });
  it("marks front matter status answered and keeps CRLF", () => {
    const text = "---\r\nstatus: new\r\n---\r\n# A\r\n\r\nbody\r\n";
    const replied = replyToInbox(text, "ok", "t");
    expect(replied).toContain("status: answered");
    expect(replied.replace(/\r\n/g, "")).not.toContain("\n");
  });
  it("refuses a reply that contains a secret", () => {
    expect(() => replyToInbox("# A\n", "api_key=sk-abcdefghijklmnopqrstuv", "t")).toThrow(/Refused/);
  });
});

describe("listInbox", () => {
  it("lists notes oldest name first, skipping the readme, and is empty when the folder is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-inbox-"));
    expect(await listInbox(root)).toEqual([]);
    await mkdir(path.join(root, INBOX_DIR));
    await writeFile(path.join(root, INBOX_DIR, "b.md"), "# B\n");
    await writeFile(path.join(root, INBOX_DIR, "a.md"), "# A\n");
    await writeFile(path.join(root, INBOX_DIR, "README.md"), "how to\n");
    expect((await listInbox(root)).map(n => n.file)).toEqual(["a.md", "b.md"]);
    expect(await listInbox(root, "answered")).toEqual([]);
  });
  it("reads a differently named inbox folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-inbox-"));
    await mkdir(path.join(root, "For Claude"));
    await writeFile(path.join(root, "For Claude", "idea.md"), "# Idea\n");
    expect((await listInbox(root, undefined, "For Claude")).map(n => n.file)).toEqual(["idea.md"]);
    expect(await listInbox(root)).toEqual([]);
  });
  it("skips a folder named like a note, so one odd entry never hides the rest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-inbox-"));
    await mkdir(path.join(root, INBOX_DIR, "odd.md"), { recursive: true });
    await writeFile(path.join(root, INBOX_DIR, "a.md"), "# A");
    expect((await listInbox(root)).map(n => n.file)).toEqual(["a.md"]);
  });
  it("does not follow a link out of the inbox", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-inbox-"));
    await mkdir(path.join(root, INBOX_DIR));
    await writeFile(path.join(root, "outside.md"), "# Private");
    await writeFile(path.join(root, INBOX_DIR, "a.md"), "# A");
    try {
      await symlink(path.join(root, "outside.md"), path.join(root, INBOX_DIR, "link.md"));
    } catch {
      return; // creating links needs a privilege some Windows accounts lack
    }
    expect((await listInbox(root)).map(n => n.file)).toEqual(["a.md"]);
  });
});

describe("assertNoteFileName", () => {
  it.each(["../x.md", "a/b.md", "a\\b.md", "x.txt", "README.md", "readme.MD", "C:foo.md", "a:b.md", "x\u0000.md", "x\n.md"])("rejects %j", name => {
    expect(() => assertNoteFileName(name)).toThrow(/not a note file name/);
  });
  it("accepts a plain markdown name", () => {
    expect(() => assertNoteFileName("idea.md")).not.toThrow();
  });
});
