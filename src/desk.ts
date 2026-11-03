import { lstat, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { withLock } from "./lock.js";
import { findSecret, localIso, nextId, noteFileName, noteId, parseNote, renderNote, safeTitle, type Item, type NoteType } from "./note.js";
import { commitAndPush, git, pullRebase, PushFailedError, pushPending, type SyncHandle } from "./sync.js";

/**
 * `deskDir`: where notes live. `rootDir`: the folder holding handoff.md, Desk/ and Inbox/ (default: deskDir's parent).
 * `sync`: set when the desk is a git work tree with an upstream, so a cloud agent can reach it. `prepare` runs before
 * each synced operation, e.g. to clone the desk repo on first use in a cloud session.
 */
export type DeskConfig = { deskDir: string; rootDir?: string; now?: () => Date; sync?: SyncHandle; prepare?: () => Promise<void> };
export type SendInput = { type: NoteType; title: string; request: string; replyBy?: string; from?: string };
export const REQUEST_LIMIT = 4000;

export type Desk = ReturnType<typeof createDesk>;
type Listed = Array<Pick<Item, "id" | "type" | "title" | "status" | "created">>;

export function createDesk(config: DeskConfig) {
  const now = config.now ?? (() => new Date());
  const folder = path.basename(config.deskDir);
  const rootDir = config.rootDir ?? path.dirname(config.deskDir);
  const sync = config.sync;

  // With git: one operation at a time, queued in this process and locked across processes (every Claude Code or
  // Cursor session runs its own server). Each operation first pulls, then delivers any commit an earlier failed push
  // left. Reads (`offlineOk`) still answer when the pull fails, from this clone, with a `stale` reason.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: (stale?: string) => Promise<T>, options: { offlineOk?: boolean } = {}): Promise<T> => {
    if (!sync) return task();
    const locked = async () => (await config.prepare?.(), withLock(sync.gitDir, async () => {
      const stale = (error: unknown) => `Couldn't update the desk from the remote, so this is this computer's last copy and may be out of date: ${error instanceof Error ? error.message : String(error)}`;
      try {
        await pullRebase(sync.root, sync.identity);
      } catch (error) {
        if (!options.offlineOk) throw error;
        return task(stale(error));
      }
      try {
        await pushPending(sync.root);
      } catch (error) {
        if (!options.offlineOk) throw error;
        return task(stale(error));
      }
      return task();
    }));
    const result = queue.then(locked, locked);
    queue = result.catch(() => undefined);
    return result;
  };

  /** A note whose commit never landed is unstaged and removed, so it can't block later pulls or take a number. */
  async function discardNote(file: string) {
    if (!sync) return;
    await git(sync.root, ["reset", "-q", "--", file]).catch(() => undefined);
    await unlink(file).catch(() => undefined);
  }

  /** Puts paths back as the last commit has them: unstaged, tracked files checked out, new files removed. */
  async function restore(paths: string[]) {
    if (!sync || !paths.length) return;
    await git(sync.root, ["reset", "-q", "--", ...paths]).catch(() => undefined);
    for (const file of paths) {
      const tracked = await git(sync.root, ["ls-files", "--", file]).catch(() => "");
      if (tracked) await git(sync.root, ["checkout", "-q", "--", file]).catch(() => undefined);
      else await unlink(file).catch(() => undefined);
    }
  }

  /**
   * After a push that failed twice: if the remote moved on and our one new commit couldn't be rebased onto it (the agent
   * and Claude edited the same lines), our commit is dropped so the clone isn't stuck failing every later pull. A push
   * that failed for another reason (offline) keeps its commit for the next call.
   */
  async function dropConflictedCommit(message: string): Promise<false | { editsInStash: boolean }> {
    if (!sync) return false;
    const rebased = await git(sync.root, ["merge-base", "--is-ancestor", "@{u}", "HEAD"]).then(() => true, () => false);
    const ahead = Number(await git(sync.root, ["rev-list", "--count", "@{u}..HEAD"]).catch(() => "0"));
    const ours = (await git(sync.root, ["log", "-1", "--format=%s"]).catch(() => "")) === message.split("\n")[0];
    if (rebased || ahead !== 1 || !ours) return false;
    let editsInStash = false;
    // The user's own uncommitted edits to other tracked files (say, handoff.md) ride out the reset in a stash.
    const dirty = Boolean(await git(sync.root, ["status", "--porcelain", "--untracked-files=no"]).catch(() => ""));
    const who = sync.identity ? ["-c", `user.name=${sync.identity.name}`, "-c", `user.email=${sync.identity.email}`] : ["-c", "user.name=handoff-desk", "-c", "user.email=handoff-desk@localhost"];
    if (dirty) await git(sync.root, [...who, "stash", "push", "--quiet", "--message", "handoff-desk: your uncommitted edits"]);
    await git(sync.root, ["reset", "-q", "--hard", "@{u}"]);
    // A conflict here leaves the edits in `git stash`, where nothing is lost; the caller says so, because the file then looks reverted.
    if (dirty) {
      const back = await git(sync.root, ["stash", "pop", "--quiet"]).then(() => true, () => false);
      if (!back) {
        editsInStash = true;
        await git(sync.root, ["reset", "--hard", "--quiet", "HEAD"]).catch(() => undefined);
      }
    }
    return { editsInStash };
  }

  async function readAll(): Promise<Item[]> {
    let names: string[];
    try {
      names = await readdir(config.deskDir);
    } catch {
      return [];
    }
    // Only regular files: the agent can push a link or a folder named x.md, and one odd entry must not hide the other items.
    const read = async (name: string): Promise<Item | null> => {
      try {
        const full = path.join(config.deskDir, name);
        return (await lstat(full)).isFile() ? parseNote(await readFile(full, "utf8"), name) : null;
      } catch {
        return null;
      }
    };
    const items = await Promise.all(names.filter(name => name.endsWith(".md")).map(read));
    return items.filter((item): item is Item => item !== null).sort((a, b) => a.id - b.id);
  }

  /** Moves our just-pushed note to the next free number, rewrites its `id:` line, and pushes the rename. */
  async function renumber(input: SendInput, oldId: number, created: string, oldFull: string): Promise<{ id: number; path: string }> {
    const id = nextId(await readdir(config.deskDir));
    const file = noteFileName(created, id, input.title);
    const full = path.join(config.deskDir, file);
    const text = (await readFile(oldFull, "utf8")).replace(new RegExp(`^id: ${oldId}\\r?$`, "m"), `id: ${id}`);
    await writeFile(full, text, { encoding: "utf8", flag: "wx" });
    await unlink(oldFull);
    await commitAndPush(sync!.root, [oldFull, full], `Handoff: ${input.type} ${id} - ${safeTitle(input.title)} (renumbered from ${oldId}: that number was taken)`, sync!.identity);
    return { id, path: `${folder}/${file}` };
  }

  async function writeNote(input: SendInput): Promise<{ id: number; path: string }> {
    await mkdir(config.deskDir, { recursive: true });
    const id = nextId(await readdir(config.deskDir));
    const created = localIso(now());
    const file = noteFileName(created, id, input.title);
    const full = path.join(config.deskDir, file);
    await writeFile(full, renderNote({ id, type: input.type, created, title: input.title, request: input.request, replyBy: input.replyBy, from: input.from }), { encoding: "utf8", flag: "wx" });
    if (sync) {
      try {
        await commitAndPush(sync.root, [full], `Handoff: ${input.type} ${id} - ${safeTitle(input.title)}`, sync.identity);
      } catch (error) {
        if (!(error instanceof PushFailedError)) await discardNote(full);
        throw error;
      }
      // Another sender (a second tool, or an agent) may have filed the same number between our pull and our push. Whoever
      // pushes second takes the next free number; our note had not reached the remote yet, so no one has seen the old one.
      const taken = (await readdir(config.deskDir)).some(name => name !== file && noteId(name) === id);
      if (taken) return renumber(input, id, created, full);
    }
    return { id, path: `${folder}/${file}` };
  }

  async function send(input: SendInput): Promise<{ id: number; path: string }> {
    if (input.request.length > REQUEST_LIMIT) throw new Error(`A request can be at most ${REQUEST_LIMIT} characters (this one has ${input.request.length}).`);
    const secret = findSecret([input.title, input.request, input.replyBy ?? ""].join("\n"));
    if (secret) throw new Error(`Refused: this item looks like it contains ${secret}. Desk notes never hold passwords, codes or keys.`);
    if (!sync) return withLock(config.deskDir, () => writeNote(input));
    try {
      return await serial(() => writeNote(input));
    } catch (error) {
      // The pull comes first, so when it fails nothing has been written: say so, so the caller knows to retry.
      if (error instanceof Error && error.message.startsWith("Couldn't update the desk")) throw new Error(`Nothing was sent or saved. ${error.message}`);
      throw error;
    }
  }

  const read = (id: number): Promise<Item & { path: string; stale?: string; warning?: string }> => serial(async stale => {
    // Two senders can briefly file the same number (the second renames its note when it notices); the older note is shown.
    const matches = (await readAll()).filter(candidate => candidate.id === id).sort((a, b) => a.created.localeCompare(b.created) || a.file.localeCompare(b.file));
    const item = matches[0];
    if (!item) throw new Error(stale ? `No desk item #${id} in this computer's copy. ${stale}` : `No desk item #${id}.`);
    const warning = matches.length > 1 ? `Another note also has the number #${id} (${matches[1].file}); this is the older one. The newer one is renumbered when its sender next syncs.` : undefined;
    return { ...item, path: `${folder}/${item.file}`, ...(stale ? { stale } : {}), ...(warning ? { warning } : {}) };
  }, { offlineOk: true });

  /** Re-reads an item until it is no longer waiting, for at most `maxMs`. */
  async function wait(id: number, options: { maxMs: number; everyMs: number; sleep?: (ms: number) => Promise<void>; clock?: () => number }): Promise<{ item: Item & { path: string; stale?: string; warning?: string }; answered: boolean; waitedMs: number }> {
    const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const clock = options.clock ?? Date.now;
    const started = clock();
    let item = await read(id);
    let slept = 0;
    // Reads can be slow (a git pull each), so the limit is wall-clock time, not the sum of the sleeps.
    const elapsed = () => Math.max(slept, clock() - started);
    while (item.status === "waiting" && elapsed() < options.maxMs) {
      const step = Math.min(options.everyMs, options.maxMs - elapsed());
      await sleep(step);
      slept += step;
      item = await read(id);
    }
    return { item, answered: item.status !== "waiting", waitedMs: elapsed() };
  }

  return {
    send,
    statusUpdate: (input: { title: string; line: string }) => send({ type: "status", title: input.title, request: input.line }),
    read,
    wait,
    list: (status?: string) => serial(async (stale): Promise<Listed | { stale: string; items: Listed }> => {
      const items = (await readAll())
        .filter(item => !status || item.status === status.toLowerCase())
        .map(({ id, type, title, status: itemStatus, created }) => ({ id, type, title, status: itemStatus, created }));
      return stale ? { stale, items } : items;
    }, { offlineOk: true }),
    /** Runs a read-only look at the desk folder after pulling it (offline: this computer's copy, with a `stale` note). */
    inRoot: <T extends object>(task: (root: string) => Promise<T>) => serial(async (stale): Promise<T & { stale?: string }> => {
      const result = await task(rootDir);
      return stale ? { ...result, stale } : result;
    }, { offlineOk: true }),
    /**
     * Writes files after a pull, then commits and pushes exactly the files the task names (never anything else in the
     * clone). Nothing changed: no commit. A task that fails part-way has `touches` (or the files it named) put back as
     * they were, so a half-written note can't block later pulls. Without git it just runs the task under the lock.
     * `files` are absolute paths.
     */
    writeFiles: <T extends object>(task: (root: string) => Promise<{ files: string[]; message: string; result: T }>, touches: string[] = []): Promise<T & { committed: boolean }> => {
      if (!sync) return withLock(rootDir, async () => ({ ...(await task(rootDir)).result, committed: false }));
      return serial(async () => {
        let files = touches;
        try {
          const done = await task(rootDir);
          files = [...new Set([...touches, ...done.files])];
          // Judged after staging: a rewrite that only differs in line endings (Windows checkouts) isn't a change.
          if (done.files.length) await git(sync.root, ["add", "--", ...done.files]);
          const changed = done.files.length ? await git(sync.root, ["diff", "--cached", "--name-only", "--", ...done.files]) : "";
          if (!changed) {
            await restore(done.files);
            return { ...done.result, committed: false };
          }
          try {
            await commitAndPush(sync.root, done.files, done.message, sync.identity);
          } catch (error) {
            const dropped = error instanceof PushFailedError ? await dropConflictedCommit(done.message) : false;
            if (dropped) {
              const stashNote = dropped.editsInStash ? " Your own unsaved edits in the desk folder clashed with the new changes, so they are kept in git stash (run git stash list, then git stash pop there)." : "";
              throw new Error(`The desk changed meanwhile: the agent edited the same note at the same time, so nothing was saved. Read the note again and redo the change.${stashNote}`);
            }
            throw error;
          }
          return { ...done.result, committed: true };
        } catch (error) {
          if (!(error instanceof PushFailedError)) await restore(files);
          throw error;
        }
      });
    },
  };
}
