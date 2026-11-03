/** What kind of handoff a note is. */
export type NoteType = "errand" | "question" | "status";
export type Item = { id: number; type: string; from: string; status: string; created: string; answered: string; title: string; request: string; reply: string; file: string };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Obsidian breaks [[links]] on # ^ [ ] |, and Windows forbids * " \ / < > : ? in file names. */
export function safeTitle(title: string): string {
  // Control characters go too, and the cut counts characters, not UTF-16 units, so an emoji is never split.
  const clean = oneLine(title.replace(/[\u0000-\u001F\u007F*"\\/<>:|?#^[\]]/g, " "));
  return Array.from(clean).slice(0, 60).join("").trim() || "Untitled";
}

export function noteFileName(created: string, id: number, title: string): string {
  return `${created.slice(0, 10)} Item ${String(id).padStart(2, "0")} - ${safeTitle(title)}.md`;
}

const NOTE_NAME = /^\d{4}-\d{2}-\d{2} Item (\d+) - .+\.md$/;

/** The item number in a note's file name, or null for any other file. */
export function noteId(fileName: string): number | null {
  const match = fileName.match(NOTE_NAME);
  return match ? Number(match[1]) : null;
}

export function nextId(fileNames: string[]): number {
  return fileNames.reduce((max, name) => {
    const match = name.match(NOTE_NAME);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

/** ISO time with its offset in `tz` (HANDOFF_TZ, else the system zone), e.g. 2026-10-08T14:05:00-04:00. */
export function localIso(date: Date, tz: string = process.env.HANDOFF_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const abs = Math.abs(offset);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Request text stays text: a heading or rule line in it ("## Reply", "---") can't open a section of the note. */
const asPlainLines = (text: string) => text.split("\n").map(line => line.replace(/^(\s{0,3})(#{1,6}(?:\s|$)|---\s*$)/, "$1\\$2")).join("\n");

/**
 * The `from:` value of a note: the MCP client's own name (claude-code, cursor, codex, or whatever else connected), cut down to a few
 * safe characters because it is written into the note's front matter. Unknown or empty names keep the old default, claude-code.
 */
export function senderFrom(clientName?: string): string {
  const name = (clientName ?? "").toLowerCase();
  if (name.includes("codex")) return "codex";
  if (name.includes("cursor")) return "cursor";
  if (name.includes("claude") && !name.includes("desktop")) return "claude-code";
  return name.replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 40) || "claude-code";
}

export function renderNote(item: { id: number; type: NoteType; created: string; title: string; request: string; replyBy?: string; from?: string }): string {
  return [
    "---", `id: ${item.id}`, `type: ${item.type}`, `from: ${senderFrom(item.from)}`, "status: waiting", `created: ${item.created}`, "answered:", "tags: [handoff]", "---",
    "", `# ${oneLine(item.title)}`, "", "## Request", "", asPlainLines(item.request.trim()),
    ...(item.replyBy ? ["", `Reply by: ${oneLine(item.replyBy)}`] : []),
    "", "## Reply", "",
  ].join("\n");
}

export function parseNote(text: string, file: string): Item | null {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (pair) meta[pair[1]] = pair[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  const id = Number(meta.id);
  if (!Number.isInteger(id) || id < 1) return null;
  const lines = match[2].split("\n");
  const at = (heading: string) => lines.findIndex(line => line.trim().toLowerCase() === heading);
  const requestAt = at("## request");
  const replyAt = at("## reply");
  const titleLine = lines.find(line => line.startsWith("# "));
  return {
    // An agent may write "Done" or "Errand": compared lower case everywhere.
    id, type: (meta.type ?? "").toLowerCase(), from: meta.from ?? "", status: (meta.status ?? "").toLowerCase(), created: meta.created ?? "", answered: meta.answered ?? "",
    title: titleLine ? titleLine.slice(2).trim() : file.replace(/\.md$/, ""),
    request: requestAt >= 0 ? lines.slice(requestAt + 1, replyAt > requestAt ? replyAt : undefined).join("\n").trim() : "",
    reply: replyAt >= 0 ? lines.slice(replyAt + 1).join("\n").trim() : "",
    file,
  };
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an app password", /\bapp[- ]?password\b[^a-z]*(?:is\s+)?[a-z]{4}\s?[a-z]{4}\s?[a-z]{4}\s?[a-z]{4}\b/i],
  // A bare "pass" is left out: "tests pass: 42/42" is a status line, not a password.
  ["a password", /\b(?:password|passwd|pwd|passcode|pw)\b\s*(?:is\b|[:=])\s*\S+/i],
  // "exit code: 12345" and "status code is 404404" are program output, not one-time codes.
  ["a code", /(?<!\b(?:exit|error|status|return|http|response)\s)\b(?:code|otp|2fa|totp|pin)\s*(?:is|:|=)\s*\d{4,8}\b/i],
  ["an API key", /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/],
  ["an API key", /\b(?:ghp|gho|ghs|github_pat|xox[abprs]|nvapi|AIza)[-_A-Za-z0-9]{12,}/],
  ["an API key", /\bAKIA[0-9A-Z]{16}\b/],
  // Generated secrets mix upper case, lower case and digits; file names, commit ids and UUIDs don't.
  ["a token", /\b(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/],
];

/** What secret a text seems to contain, or null. Notes never hold passwords, codes or keys. */
export function findSecret(text: string): string | null {
  for (const [label, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return label;
  return null;
}
