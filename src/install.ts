import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CLIENTS, type ClientOptions } from "./clientConfig.js";

/**
 * `handoff-desk install --client <name>`: adds the handoff server to a client's own settings file.
 *
 * It changes a file outside this project, so it is deliberately cautious. It only knows clients whose user file is strict
 * JSON in a documented place; it shows a dry run unless told to write; it adds one entry and leaves everything else in the
 * file as it was (other servers, other keys, indent, line endings); it makes a backup first, never over an earlier one; it
 * refuses what it cannot read exactly (comments, a link, a folder in the way); it writes through a temporary file; and it
 * stops if the file changed while it was working. An entry that already exists and differs is only updated with --force,
 * and then its other settings, including secrets in its env, are kept. It never prints the file or another server's settings.
 */
export const INSTALLABLE = CLIENTS.filter(client => client.install).map(client => client.id);

export type InstallOptions = ClientOptions & {
  /** The user's home folder; every supported file sits under it. */
  home: string;
  write: boolean;
  force: boolean;
  now?: () => Date;
  /** Test hook: runs after the file was read and just before it is replaced. */
  beforeWrite?: () => Promise<void>;
};
export type InstallResult = { code: number; message: string };

const refuse = (message: string): InstallResult => ({ code: 1, message });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  return value;
}
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

export async function installClient(id: string, options: InstallOptions): Promise<InstallResult> {
  const client = CLIENTS.find(candidate => candidate.id === id);
  if (!client) return refuse(`Unknown client "${id}". handoff-desk can edit the settings of: ${INSTALLABLE.join(", ")}.`);
  if (!client.install) return refuse(`handoff-desk does not edit ${client.name}'s settings itself (${client.where.split(". ")[0].replace(/\.$/, "")}).\nRun: handoff-desk config --client ${id}\nand put the result where ${client.name} reads it. It can edit the settings of: ${INSTALLABLE.join(", ")}.`);

  const { file, key } = client.install;
  const target = path.join(options.home, ...file);
  const entry = (JSON.parse(client.render(options)) as Record<string, { handoff: Record<string, unknown> }>)[key].handoff;

  const info = await lstat(target).catch(() => null);
  if (info?.isSymbolicLink()) return refuse(`${target} is a symbolic link; it was not changed. Edit the file it points to yourself, or run: handoff-desk config --client ${id}`);
  if (info && !info.isFile()) return refuse(`${target} is not a file (it is a folder or something else); nothing was changed.`);

  const raw = info ? await readFile(target, "utf8") : "";
  const text = raw.replace(/^﻿/, "");
  let root: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) return refuse(`${target} does not hold a JSON object at the top, so nothing was changed.`);
      root = parsed;
    } catch {
      return refuse(`${target} is not plain JSON (comments or a trailing comma?), so nothing was changed. Run: handoff-desk config --client ${id}  and add the entry by hand.`);
    }
  }
  if (root[key] !== undefined && !isObject(root[key])) return refuse(`"${key}" in ${target} is not an object, so nothing was changed.`);
  const servers = (root[key] ?? {}) as Record<string, unknown>;
  const existing = servers.handoff;
  if (existing !== undefined && !isObject(existing)) return refuse(`The "handoff" entry in ${target} is not an object, so nothing was changed.`);

  // What would be written for this entry.
  let next: Record<string, unknown> = entry;
  if (existing) {
    if (same(existing, entry)) return { code: 0, message: `${client.name}: handoff is already set up in ${target}; nothing to do.` };
    if (!options.force) {
      const differs = ["command", "args", "env"].filter(part => !same(existing[part], entry[part]));
      return refuse(`${client.name}: ${target} already has a "handoff" entry that differs from what this version writes (${differs.join(", ")}). Nothing was changed.\nRun again with --force to update the command and arguments; every other setting in that entry, including the values in its env, is kept.`);
    }
    next = { ...existing, ...entry, env: { ...(isObject(existing.env) ? existing.env : {}), ...(entry.env as Record<string, unknown>) } };
  }

  const shown = JSON.stringify({ [key]: { handoff: existing ? { ...next, env: Object.fromEntries(Object.keys(next.env as object).map(name => [name, name in (entry.env as object) ? (entry.env as Record<string, unknown>)[name] : "(kept)"])) } : next } }, null, 2);
  if (!options.write) {
    return { code: 0, message: `Dry run: nothing was changed.\n${client.name} reads ${target}${info ? "" : " (it does not exist yet and would be created)"}.\nThis entry would be ${existing ? "updated" : "added"} (the rest of the file stays as it is):\n${shown}\nCheck that this is the file ${client.name} reads, then run again with --write.` };
  }

  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const updated = { ...root, [key]: { ...servers, handoff: next } };
  const output = `${JSON.stringify(updated, null, indent).replace(/\n/g, eol)}${eol}`;

  await mkdir(path.dirname(target), { recursive: true });
  if (options.beforeWrite) await options.beforeWrite();
  const now = await lstat(target).catch(() => null);
  if (Boolean(now) !== Boolean(info) || (now && info && (now.size !== info.size || now.mtimeMs !== info.mtimeMs))) {
    return refuse(`${target} changed while handoff-desk was working, so nothing was written. Run the command again.`);
  }

  let backup: string | undefined;
  if (info) {
    const date = stamp((options.now ?? (() => new Date()))());
    for (let n = 0; ; n++) {
      const candidate = `${target}.handoff-desk-backup-${date}${n ? `-${n}` : ""}`;
      try {
        await copyFile(target, candidate, constants.COPYFILE_EXCL);
        backup = candidate;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse(`Could not make a backup of ${target} (${(error as Error).message}), so nothing was changed.`);
      }
    }
  }
  const temporary = `${target}.handoff-desk-${process.pid}.tmp`;
  try {
    await writeFile(temporary, output, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    return refuse(`Could not write ${target} (${(error as NodeJS.ErrnoException).code ?? "error"}; is it read-only or open in another program?). ${backup ? `A backup was made at ${backup}, but the file itself was not changed.` : "Nothing was changed."}`);
  }
  return { code: 0, message: `${client.name}: ${existing ? "updated" : "added"} the handoff entry in ${target}.${backup ? `\nBackup of the old file: ${backup}` : ""}\nBefore you restart ${client.name}, run this once so the first start is quick (a cold download can take 15 seconds, and clients report "Disconnected" or a timeout if they give up first):\n  npx -y @voyageurworks/handoff-desk --version\nThen restart ${client.name} to load it.` };
}

/**
 * The env of the handoff entry in a client's settings file, for `doctor --client`: what the server would be started with.
 * Read only, and never printed. `reason` says what is wrong when there is none.
 */
export async function clientEnv(id: string, home: string): Promise<{ env: Record<string, string>; reason?: undefined } | { env?: undefined; reason: string }> {
  const client = CLIENTS.find(candidate => candidate.id === id);
  if (!client?.install) return { reason: `doctor can read the settings of: ${INSTALLABLE.join(", ")}. For ${client?.name ?? id}, run it with the settings in your environment instead (they are not in this terminal unless you set them).` };
  const target = path.join(home, ...client.install.file);
  const text = await readFile(target, "utf8").catch(() => null);
  if (text === null) return { reason: `${target} does not exist, so ${client.name} has no handoff entry yet (handoff-desk install --client ${id}).` };
  try {
    const servers = (JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>)[client.install.key];
    const entry = isObject(servers) ? servers.handoff : undefined;
    if (!isObject(entry)) return { reason: `${target} has no handoff entry (handoff-desk install --client ${id}).` };
    const env = isObject(entry.env) ? Object.fromEntries(Object.entries(entry.env).filter((pair): pair is [string, string] => typeof pair[1] === "string")) : {};
    return { env };
  } catch {
    return { reason: `${target} is not plain JSON, so it could not be read.` };
  }
}
