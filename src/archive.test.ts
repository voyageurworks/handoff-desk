import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveEmail, mailFileName } from "./archive.js";

const record = { direction: "sent" as const, to: "agent@example.com", subject: "[Handoff errand #9] Book dentist", body: "Friday at 3", date: new Date("2026-01-15T12:34:00Z"), id: 9, delivered: "smtp" as const };

describe("archive", () => {
  it("names files sortably and without colons", () => {
    expect(mailFileName(record, "UTC")).toBe("2026-01-15 1234 sent #9 Book dentist.md");
  });
  it("writes under the year-month folder and never overwrites", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-mail-"));
    const first = await archiveEmail(root, record, "UTC");
    const second = await archiveEmail(root, record, "UTC");
    expect(first).toContain(path.join(root, "2026-01"));
    expect(second).toMatch(/\(2\)\.md$/);
    const text = await readFile(first, "utf8");
    expect(text).toContain("direction: sent");
    expect(text).toContain("delivered: smtp");
    expect(text).not.toContain("gmail_label");
  });
});
