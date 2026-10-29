import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { findSecret } from "./note.js";

/** Where the agent leaves things for Claude: questions, ideas, requests. Claude answers under the note. */
export const INBOX_DIR = "Inbox";
const REPLY_HEADING = /^##\s+Claude's reply\b/i;

export type InboxNote = { file: string; title: string; status: string; created: string; body: string; replied: boolean };

const same = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function split(text: string): { meta: Record<string, string>; lines: string[] } {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  if (match) for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (pair) meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, lines: (match ? match[2] : normalized).split("\n") };
}

/** The agent may write free-form: no front matter means "new" (or "answered" once Claude's reply is under it). */
export function parseInboxNote(text: string, file: string): InboxNote {
  const { meta, lines } = split(text);
  const replyAt = lines.findIndex(line => REPLY_HEADING.test(line));
  const titleAt = lines.findIndex(line => line.startsWith("# "));
  const request = (replyAt >= 0 ? lines.slice(0, replyAt) : lines).filter((_line, index) => index !== titleAt);
  return {
    file,
    title: titleAt >= 0 ? lines[titleAt].slice(2).trim() : file.replace(/\.md$/i, ""),
    status: (meta.status || (replyAt >= 0 ? "answered" : "new")).toLowerCase(),
    created: meta.created ?? "",
    body: request.join("\n").trim(),
    replied: replyAt >= 0,
  };
}

/** The replies already under a note, as plain text. */
function repliesIn(lines: string[]): string[] {
  const replies: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!REPLY_HEADING.test(lines[index])) continue;
    // Up to the next reply of Claude's: a reply may hold headings of its own, and the agent may add a section after it
    // (see `replyToInbox`, which compares by the start of each span).
    const end = lines.findIndex((line, at) => at > index && REPLY_HEADING.test(line));
    replies.push(lines.slice(index + 1, end < 0 ? undefined : end).join("\n"));
  }
  return replies;
}

/**
 * Appends Claude's dated reply and marks the note answered (in its front matter, when it has one). A reply that's
 * already there (a retried run) leaves the note unchanged. Line endings stay as the note has them.
 */
export function replyToInbox(text: string, reply: string, at: string): string {
  const secret = findSecret(reply);
  if (secret) throw new Error(`Refused: this reply looks like it contains ${secret}. Notes never hold passwords, codes or keys.`);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  // The same reply, possibly followed by a section of the agent's own (a heading), but not merely a longer, different reply.
  const already = (existing: string) => same(existing).startsWith(same(reply)) && (same(existing).slice(same(reply).length).trimStart() === "" || same(existing).slice(same(reply).length).trimStart().startsWith("#"));
  if (repliesIn(lines).some(already)) return text;
  // A byte-order mark before the front matter (some editors save one) is kept, and the front matter still found.
  if (lines[0].replace(/^﻿/, "") === "---") {
    const close = lines.findIndex((line, index) => index > 0 && line === "---");
    if (close > 0) {
      const statusAt = lines.findIndex((line, index) => index > 0 && index < close && /^status:/i.test(line));
      if (statusAt > 0) lines[statusAt] = "status: answered";
      else lines.splice(close, 0, "status: answered");
    }
  }
  const base = lines.join(eol).replace(/\s+$/, "");
  return [base, "", `## Claude's reply (${at})`, "", reply.trim().replace(/\r?\n/g, eol), ""].join(eol);
}

/** Only a plain markdown file name inside the inbox folder: no folders, no `..`, not the readme. */
export function assertNoteFileName(file: string): void {
  // A colon would address an NTFS alternate data stream on Windows; control characters have no place in a name.
  if (/[\\/:\u0000-\u001F]|\.\./.test(file) || !file.toLowerCase().endsWith(".md") || file.toLowerCase() === "readme.md") {
    throw new Error(`Refused: ${file} is not a note file name in the Inbox folder.`);
  }
}

/** Every note in the Inbox folder, oldest file name first; a README there is how-to, not a message. */
export async function listInbox(root: string, status?: string, inboxDir: string = INBOX_DIR): Promise<InboxNote[]> {
  const dir = path.join(root, inboxDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  // The agent can push anything into this folder, so only regular files are read: a link could point at any file on this
  // computer, and one odd entry (a folder named x.md) must not hide the other notes.
  const read = async (name: string): Promise<InboxNote | null> => {
    try {
      const full = path.join(dir, name);
      return (await lstat(full)).isFile() ? parseInboxNote(await readFile(full, "utf8"), name) : null;
    } catch {
      return null;
    }
  };
  const notes = (await Promise.all(names.filter(name => name.toLowerCase().endsWith(".md") && name.toLowerCase() !== "readme.md").sort().map(read))).filter((note): note is InboxNote => note !== null);
  return status ? notes.filter(note => note.status === status.toLowerCase()) : notes;
}
