import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { localIso, parseNote } from "./note.js";
import { commitAndPush, pullRebase, type SyncHandle } from "./sync.js";

/**
 * A stand-in for a real agent, for testing: answers every waiting note with a fixed line, sets status to done
 * and stamps `answered`. Notes that aren't waiting, or can't be parsed, are left untouched. Returns how many it answered.
 * With `sync` it behaves like a cloud agent: pulls first, then commits and pushes exactly the notes it answered.
 */
export async function runStandIn(deskDir: string, options: { now?: () => Date; sync?: SyncHandle } = {}): Promise<number> {
  const now = options.now ?? (() => new Date());
  if (options.sync) await pullRebase(options.sync.root, options.sync.identity);
  const answeredFiles: string[] = [];
  let names: string[];
  try {
    names = await readdir(deskDir);
  } catch {
    return 0;
  }
  let answered = 0;
  for (const name of names.filter(candidate => candidate.endsWith(".md")).sort()) {
    const file = path.join(deskDir, name);
    const text = await readFile(file, "utf8");
    const item = parseNote(text, name);
    if (!item || item.status !== "waiting") continue;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const close = lines.findIndex((line, index) => index > 0 && line === "---");
    for (let index = 1; index < close; index++) {
      if (/^status:/i.test(lines[index])) lines[index] = "status: done";
      else if (/^answered:/i.test(lines[index])) lines[index] = `answered: ${localIso(now())}`;
    }
    let body = lines.join(eol).replace(/\s+$/, "");
    if (!lines.some(line => line.trim().toLowerCase() === "## reply")) body += `${eol}${eol}## Reply`;
    await writeFile(file, `${body}${eol}${eol}Stand-in agent received: ${item.title}${eol}`, "utf8");
    answeredFiles.push(file);
    answered++;
  }
  if (options.sync && answeredFiles.length) await commitAndPush(options.sync.root, answeredFiles, `Handoff: stand-in answered ${answered}`, options.sync.identity);
  return answered;
}
