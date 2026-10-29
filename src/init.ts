import { appendFile, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = fileURLToPath(new URL("../templates/handoff.md", import.meta.url));
/** Never committed: mail copies, and the lock file a synced desk uses. */
const IGNORED = ["mail/", ".handoff.lock"];

const exists = (file: string) => stat(file).then(() => true, () => false);

/** Adds the lines in IGNORED that `.gitignore` doesn't have yet, leaving every other line alone. */
async function ensureIgnored(dir: string): Promise<void> {
  const file = path.join(dir, ".gitignore");
  const current = await readFile(file, "utf8").catch(() => "");
  const have = new Set(current.split(/\r?\n/).map(line => line.trim()));
  const missing = IGNORED.filter(line => !have.has(line));
  if (!missing.length) return;
  const lead = current && !current.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${lead}${missing.join("\n")}\n`, "utf8");
}

/**
 * Sets up a desk folder: Desk/, an inbox folder, mail/ and a handoff.md for the user to edit (step one).
 * Safe to run again: an existing folder or handoff.md is kept exactly as it is.
 */
export async function initDesk(dir: string, options: { inboxDir?: string } = {}): Promise<{ created: string[]; kept: string[] }> {
  const created: string[] = [];
  const kept: string[] = [];
  await mkdir(dir, { recursive: true });
  for (const name of ["Desk", options.inboxDir ?? "Inbox", "mail"]) {
    const target = path.join(dir, name);
    (await exists(target) ? kept : created).push(name);
    await mkdir(target, { recursive: true });
  }
  const rules = path.join(dir, "handoff.md");
  if (await exists(rules)) kept.push("handoff.md");
  else {
    await copyFile(TEMPLATE, rules);
    created.push("handoff.md");
  }
  await ensureIgnored(dir);
  return { created, kept };
}
