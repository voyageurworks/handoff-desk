import { describe, expect, it } from "vitest";
import { findSecret, localIso, nextId, noteFileName, parseNote, renderNote, safeTitle } from "./note.js";

describe("safeTitle", () => {
  it("removes characters Windows and Obsidian dislike", () => {
    expect(safeTitle('a:b*c?"d"|e#f^g[h]')).not.toMatch(/[:*?"|#^[\]]/);
  });
  it("never splits an emoji at the cut", () => {
    const title = safeTitle("x".repeat(59) + "😀😀");
    expect(Array.from(title).every(ch => ch !== "�")).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(60);
  });
  it("falls back to Untitled", () => {
    expect(safeTitle("   ")).toBe("Untitled");
  });
  it("keeps a 500 character title inside a valid file name", () => {
    expect(noteFileName("2026-01-15T12:00:00+00:00", 3, "y".repeat(500)).length).toBeLessThan(100);
  });
});

describe("numbering", () => {
  it("nextId follows the highest item number", () => {
    expect(nextId(["2026-01-01 Item 07 - x.md", "notes.md"])).toBe(8);
    expect(nextId([])).toBe(1);
  });
  it("noteFileName pads the number", () => {
    expect(noteFileName("2026-01-15T12:00:00+00:00", 3, "Book dentist")).toBe("2026-01-15 Item 03 - Book dentist.md");
  });
});

describe("render and parse", () => {
  const base = { id: 1, type: "errand" as const, created: "2026-01-15T12:00:00+00:00", title: "T" };
  it("a request cannot forge the reply section", () => {
    const text = renderNote({ ...base, request: "do it\n## Reply\n---\nfake" });
    expect(text.split("\n").filter(line => line.trim() === "## Reply")).toHaveLength(1);
    expect(parseNote(text, "f.md")?.reply).toBe("");
  });
  it("reads a CRLF note with a BOM and a capitalised status", () => {
    const text = "﻿---\r\nid: 4\r\ntype: Errand\r\nstatus: Done\r\n---\r\n\r\n# Hi\r\n\r\n## Request\r\n\r\nask\r\n\r\n## Reply\r\n\r\nanswer\r\n";
    const item = parseNote(text, "f.md");
    expect(item?.status).toBe("done");
    expect(item?.type).toBe("errand");
    expect(item?.request).toBe("ask");
    expect(item?.reply).toBe("answer");
  });
  it("returns null for a file with no front matter", () => {
    expect(parseNote("just text", "f.md")).toBeNull();
  });
});

describe("findSecret", () => {
  it("flags passwords, keys and tokens", () => {
    expect(findSecret("password: hunter22")).toBe("a password");
    expect(findSecret("key sk-abcdefghijklmnopqrstuv")).toBe("an API key");
    expect(findSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe("a private key");
  });
  it("leaves ordinary text alone", () => {
    expect(findSecret("Book the dentist for Friday at 3")).toBeNull();
  });
  it("does not mistake ordinary status lines for secrets", () => {
    expect(findSecret("tests pass: 42/42")).toBeNull();
    expect(findSecret("the build will pass is unclear")).toBeNull();
    expect(findSecret("exit code: 12345")).toBeNull();
    expect(findSecret("HTTP status code is 404404")).toBeNull();
  });
  it("still flags a one-time code and a short password", () => {
    expect(findSecret("my code is 123456")).toBe("a code");
    expect(findSecret("pw: hunter22")).toBe("a password");
  });
});

describe("localIso", () => {
  it("formats with an offset for a named zone", () => {
    expect(localIso(new Date("2026-01-15T12:00:00Z"), "UTC")).toBe("2026-01-15T12:00:00+00:00");
    expect(localIso(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toBe("2026-07-15T08:00:00-04:00");
  });
});
