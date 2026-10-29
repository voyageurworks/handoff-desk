import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { localIso, safeTitle } from "./note.js";

export type MailDirection = "sent" | "received";
/** `delivered` (sent mail only): "smtp" when this server sent it, "pending" when the caller must send it another way. */
export type MailRecord = { direction: MailDirection; to: string; subject: string; body: string; date: Date; from?: string; id?: number; delivered?: "smtp" | "pending" };

/** "2026-01-15 1324 sent #9 Test.md": sortable, and safe on Windows (no colons). */
export function mailFileName(record: MailRecord, tz?: string): string {
  const stamp = localIso(record.date, tz).slice(0, 16).replace("T", " ").replace(":", "");
  const ref = record.id !== undefined ? ` #${record.id}` : "";
  const title = safeTitle(record.subject.replace(/^\[[^\]]*\]\s*/, ""));
  return `${stamp} ${record.direction}${ref} ${title}.md`;
}

function render(record: MailRecord, tz?: string): string {
  const lines = ["---", `direction: ${record.direction}`];
  if (record.id !== undefined) lines.push(`id: ${record.id}`);
  if (record.from) lines.push(`from: ${record.from}`);
  lines.push(`to: ${record.to}`, `date: ${localIso(record.date, tz)}`, `subject: ${JSON.stringify(record.subject)}`);
  if (record.delivered) lines.push(`delivered: ${record.delivered}`);
  lines.push("---", "", record.body.replace(/\r\n/g, "\n").trimEnd(), "");
  return lines.join("\n");
}

/**
 * Saves one email as a markdown file under `<root>/<YYYY-MM>/`. Never overwrites: two emails with the same minute
 * and subject get " (2)", " (3)". Returns the file's path.
 */
export async function archiveEmail(root: string, record: MailRecord, tz?: string): Promise<string> {
  const dir = path.join(root, localIso(record.date, tz).slice(0, 7));
  await mkdir(dir, { recursive: true });
  const base = mailFileName(record, tz).replace(/\.md$/, "");
  for (let n = 1; n < 100; n++) {
    const file = path.join(dir, `${base}${n === 1 ? "" : ` (${n})`}.md`);
    try {
      await writeFile(file, render(record, tz), { encoding: "utf8", flag: "wx" });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Too many saved emails with the same minute and subject.");
}
