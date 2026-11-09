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

/**
 * What to do after `init`, with the real folder filled in: the exact command to add the server to Claude Code (the Windows
 * form quotes the double dash and runs npx through cmd, as PowerShell 5.1 needs), the check, and the other clients.
 */
export function nextSteps(dir: string, windows: boolean): string {
  const shown = windows ? dir.split(path.sep).join("/") : dir;
  const add = windows
    ? `claude mcp add handoff -e HANDOFF_DIR="${shown}" '--' cmd /c npx -y '@voyageurworks/handoff-desk'`
    : `claude mcp add handoff -e HANDOFF_DIR="${shown}" -- npx -y @voyageurworks/handoff-desk`;
  return [
    "Next steps:",
    `  1. Edit ${shown}/handoff.md: what your agent may do alone, must ask first, and must never do.`,
    "  2. Add the server to Claude Code (other clients, including OpenClaw: npx -y @voyageurworks/handoff-desk config --list):",
    `       ${add}`,
    "  3. Check the setup (doctor reads this terminal's settings, so it needs the folder too):",
    windows
      ? `       $env:HANDOFF_DIR = "${shown}"; npx -y @voyageurworks/handoff-desk doctor`
      : `       HANDOFF_DIR="${shown}" npx -y @voyageurworks/handoff-desk doctor`,
    "  4. Start a new Claude Code session and say: Hand this to my agent as a question: reply with pong.",
    "Tip: run `npx -y @voyageurworks/handoff-desk --version` once before step 2, so the first start is quick (a cold download takes about 15 seconds and clients give up sooner).",
  ].join("\n");
}
