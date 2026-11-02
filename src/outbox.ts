import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withLock } from "./lock.js";

/**
 * A small list of chat doorbells that did not go through for a reason that can pass (the network, a busy service), so they
 * are tried again later. An entry is only a pointer to the note (id and channels); the text is read from the note when it is
 * re-sent, so nothing is stored twice and a note that was answered or deleted in the meantime is not announced.
 * The list lives on this computer, outside the desk folder, so git sync never carries it to another machine.
 */
export type Channel = "telegram" | "slack";
export type OutboxEntry = { id: number; channels: Channel[]; attempts: number; firstFailedAt: string; nextAttemptAt: string };
/** What re-sending one entry achieved: the note is gone, or which channels rang and which should be tried again. */
export type Attempt = { gone: true } | { gone?: false; rung: Channel[]; retry: Channel[] };

export const MAX_ATTEMPTS = 5;
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Wait before the second, third, ... attempt. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
/** Entries handled per flush, so a long list never makes one tool call slow. */
const BATCH = 5;
/** While one process is re-sending an entry, others leave it alone for this long. */
const CLAIM_MS = 2 * 60_000;
const FILE = "outbox.json";

const CHANNELS: Channel[] = ["telegram", "slack"];

/** Where this desk's outbox lives: a per-desk folder under HANDOFF_STATE_DIR or ~/.handoff-desk/state. */
export function outboxDir(deskRoot: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const base = env.HANDOFF_STATE_DIR ? path.resolve(env.HANDOFF_STATE_DIR) : path.join(home, ".handoff-desk", "state");
  return path.join(base, createHash("sha256").update(path.resolve(deskRoot)).digest("hex").slice(0, 16));
}

const valid = (value: unknown): value is OutboxEntry => {
  const entry = value as Partial<OutboxEntry> | null;
  return Boolean(entry) && Number.isInteger(entry!.id) && Array.isArray(entry!.channels) && entry!.channels.every(channel => CHANNELS.includes(channel))
    && Number.isInteger(entry!.attempts) && !Number.isNaN(Date.parse(String(entry!.firstFailedAt))) && !Number.isNaN(Date.parse(String(entry!.nextAttemptAt)));
};

/** A damaged or missing file counts as an empty list: a lost reminder is better than a stuck tool. */
async function read(dir: string): Promise<OutboxEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, FILE), "utf8"));
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

async function write(dir: string, entries: OutboxEntry[]): Promise<void> {
  const target = path.join(dir, FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

const locked = async <T>(dir: string, task: () => Promise<T>): Promise<T> => withLock(dir, task, { waitMs: 5_000 });

/** Remembers that these channels did not ring for this item. Merges with an entry that is already there. */
export async function enqueue(dir: string, id: number, channels: Channel[], now: Date = new Date()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await locked(dir, async () => {
    const entries = await read(dir);
    const existing = entries.find(entry => entry.id === id);
    if (existing) {
      existing.channels = [...new Set([...existing.channels, ...channels])];
    } else {
      entries.push({ id, channels: [...new Set(channels)], attempts: 1, firstFailedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[0]).toISOString() });
    }
    await write(dir, entries);
  });
}

/**
 * Re-sends what is due. `attempt` does the sending for one entry and may take a while, so the list is not locked meanwhile:
 * due entries are first claimed (pushed a little into the future), then attempted, then updated. Never throws.
 */
export async function flushOutbox(dir: string, attempt: (entry: OutboxEntry) => Promise<Attempt>, now: Date = new Date()): Promise<{ resent: Array<{ id: number; channels: Channel[] }> }> {
  const resent: Array<{ id: number; channels: Channel[] }> = [];
  try {
    await mkdir(dir, { recursive: true });
    const claimed = await locked(dir, async () => {
      const entries = await read(dir);
      const due = entries.filter(entry => Date.parse(entry.nextAttemptAt) <= now.getTime()).slice(0, BATCH);
      if (!due.length) return [];
      const copies = due.map(entry => ({ ...entry, channels: [...entry.channels] }));
      for (const entry of due) entry.nextAttemptAt = new Date(now.getTime() + CLAIM_MS).toISOString();
      await write(dir, entries);
      return copies;
    });
    if (!claimed.length) return { resent };
    const outcomes = new Map<number, Attempt>();
    for (const entry of claimed) {
      // A failure of the attempt itself leaves the entry to try again later.
      outcomes.set(entry.id, await attempt(entry).catch((): Attempt => ({ rung: [], retry: entry.channels })));
    }
    await locked(dir, async () => {
      const kept: OutboxEntry[] = [];
      for (const entry of await read(dir)) {
        const outcome = outcomes.get(entry.id);
        const before = claimed.find(copy => copy.id === entry.id);
        if (!outcome || !before) { kept.push(entry); continue; }
        if (outcome.gone) continue;
        if (outcome.rung.length) resent.push({ id: entry.id, channels: outcome.rung });
        const retry = outcome.retry.filter(channel => before.channels.includes(channel));
        const attempts = before.attempts + 1;
        const tooOld = now.getTime() - Date.parse(before.firstFailedAt) > MAX_AGE_MS;
        if (!retry.length || attempts >= MAX_ATTEMPTS || tooOld) continue;
        kept.push({ id: entry.id, channels: retry, attempts, firstFailedAt: before.firstFailedAt, nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]).toISOString() });
      }
      await write(dir, kept);
    });
  } catch {
    // A list that cannot be read or written must never break a tool call.
  }
  return { resent };
}
