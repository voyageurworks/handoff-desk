import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesk } from "./desk.js";
import { parseNote, renderNote } from "./note.js";

/** What a cloud agent may do to a note and still be read correctly. These pin the contract in docs/cloud-agents.md. */
const base = () => renderNote({ id: 7, type: "errand", created: "2026-01-15T12:00:00+00:00", title: "Book dentist", request: "Friday at 3" });
const answered = (text: string, status = "done", reply = "Booked for Friday at 3.") =>
  `${text.replace("status: waiting", `status: ${status}`).replace("answered:", "answered: 2026-01-15T12:05:00+00:00").trimEnd()}\n\n${reply}\n`;

describe("agent-written notes are read correctly", () => {
  it("a note the agent has not touched stays waiting", () => {
    const item = parseNote(base(), "f.md");
    expect(item?.status).toBe("waiting");
    expect(item?.reply).toBe("");
  });

  it.each(["done", "Done", "DONE", "declined", "Declined", "info"])("status %s is read lower case", status => {
    expect(parseNote(answered(base(), status), "f.md")?.status).toBe(status.toLowerCase());
  });

  it("reads the reply and the request separately", () => {
    const item = parseNote(answered(base()), "f.md");
    expect(item?.request).toBe("Friday at 3");
    expect(item?.reply).toBe("Booked for Friday at 3.");
    expect(item?.answered).toBe("2026-01-15T12:05:00+00:00");
  });

  it("accepts CRLF, a byte-order mark, and trailing spaces after the status", () => {
    const text = `﻿${answered(base()).replace("status: done", "status: done   ").replace(/\n/g, "\r\n")}`;
    const item = parseNote(text, "f.md");
    expect(item?.status).toBe("done");
    expect(item?.reply).toBe("Booked for Friday at 3.");
  });

  it("accepts a lower-case or padded Reply heading", () => {
    expect(parseNote(answered(base()).replace("## Reply", "## reply"), "f.md")?.reply).toBe("Booked for Friday at 3.");
    expect(parseNote(answered(base()).replace("## Reply", "## Reply  "), "f.md")?.reply).toBe("Booked for Friday at 3.");
  });

  it("keeps sub-headings, rules and lists inside the reply", () => {
    const reply = "### What I did\n\n- Called the clinic\n\n---\n\nConfirmation: ABC";
    expect(parseNote(answered(base(), "done", reply), "f.md")?.reply).toBe(reply);
  });

  it("an empty answered field is fine while waiting", () => {
    expect(parseNote(base(), "f.md")?.answered).toBe("");
  });
});

describe("a desk with agent edits", () => {
  it("lists answered and waiting notes, and skips a note the agent damaged", async () => {
    const deskDir = path.join(await mkdtemp(path.join(tmpdir(), "handoff-contract-")), "Desk");
    await mkdir(deskDir, { recursive: true });
    await writeFile(path.join(deskDir, "2026-01-15 Item 07 - Book dentist.md"), answered(base()));
    await writeFile(path.join(deskDir, "2026-01-15 Item 08 - Second.md"), renderNote({ id: 8, type: "question", created: "2026-01-15T12:00:00+00:00", title: "Second", request: "why" }));
    await writeFile(path.join(deskDir, "2026-01-15 Item 09 - Damaged.md"), "---\nstatus: done\n---\n# Damaged\n");
    await writeFile(path.join(deskDir, "notes.txt"), "not a note");
    const desk = createDesk({ deskDir });
    const items = (await desk.list()) as Array<{ id: number; status: string }>;
    expect(items.map(item => [item.id, item.status])).toEqual([[7, "done"], [8, "waiting"]]);
    expect((await desk.read(7)).reply).toBe("Booked for Friday at 3.");
  });
});
