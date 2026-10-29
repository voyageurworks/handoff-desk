import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesk } from "./desk.js";
import { localIso, noteFileName, renderNote } from "./note.js";
import { detectSync } from "./sync.js";
import { makeRemote, sh } from "./testRepos.js";

const fixed = new Date("2026-01-15T12:00:00Z");
const ENV = { HANDOFF_GIT_NAME: "Desk User", HANDOFF_GIT_EMAIL: "user@example.com" };
const remoteLog = (bare: string) => sh(bare, ["log", "--format=%s", "main"]).split("\n");

/** Another clone of an existing bare remote: "another sender's" computer. */
async function makeRemoteFor(bare: string): Promise<{ cloneB: string }> {
  const cloneB = path.join(path.dirname(bare), "clone other sender");
  sh(path.dirname(bare), ["clone", "-q", "-c", "core.autocrlf=false", bare, cloneB]);
  sh(cloneB, ["config", "user.name", "other sender"]);
  sh(cloneB, ["config", "user.email", "other@example.com"]);
  sh(cloneB, ["config", "commit.gpgsign", "false"]);
  return { cloneB };
}

async function setup(options: { now?: () => Date } = {}) {
  const remote = await makeRemote();
  const sync = await detectSync(remote.cloneA, ENV);
  if (!sync) throw new Error("test setup: no sync handle");
  const desk = createDesk({ deskDir: path.join(remote.cloneA, "Desk"), rootDir: remote.cloneA, sync, now: options.now ?? (() => fixed) });
  return { ...remote, sync, desk };
}

/** What a cloud agent does: pull, answer every waiting note, commit and push. */
async function agentAnswers(cloneB: string) {
  sh(cloneB, ["pull", "--rebase", "-q"]);
  const dir = path.join(cloneB, "Desk");
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const text = await readFile(file, "utf8");
    if (!text.includes("status: waiting")) continue;
    await writeFile(file, `${text.replace("status: waiting", "status: done").replace("answered:", "answered: 2026-01-15T12:05:00+00:00").trimEnd()}\n\nDone by the agent.\n`);
  }
  sh(cloneB, ["add", "-A"]);
  sh(cloneB, ["-c", "user.name=agent", "-c", "user.email=agent@example.com", "commit", "-q", "-m", "agent answered"]);
  sh(cloneB, ["push", "-q"]);
}

describe("desk over git", () => {
  it("cloud round trip: send pushes the note, the agent answers, read sees the reply", async () => {
    const { desk, bare, cloneB } = await setup();
    const { id } = await desk.send({ type: "errand", title: "Book dentist", request: "Friday at 3" });
    expect(remoteLog(bare).some(line => line.startsWith("Handoff: errand 1 - Book dentist"))).toBe(true);
    expect(sh(bare, ["log", "-1", "--format=%an <%ae>", "main"])).toBe("Desk User <user@example.com>");
    await agentAnswers(cloneB);
    const item = await desk.read(id);
    expect(item.status).toBe("done");
    expect(item.reply).toBe("Done by the agent.");
    expect((await desk.wait(id, { maxMs: 1000, everyMs: 10 })).answered).toBe(true);
  });

  it("delivers the note when the agent pushed something else meanwhile (rebase and retry)", async () => {
    let first = true;
    let cloneBPath = "";
    const { desk, bare, cloneB } = await setup({
      now: () => {
        if (first) {
          first = false;
          // Between our pull and our push the agent pushes an unrelated commit.
          sh(cloneBPath, ["commit", "-q", "--allow-empty", "-m", "agent was here"]);
          sh(cloneBPath, ["push", "-q"]);
        }
        return fixed;
      },
    });
    cloneBPath = cloneB;
    await desk.send({ type: "errand", title: "Race", request: "r" });
    expect(remoteLog(bare)).toEqual(expect.arrayContaining(["agent was here"]));
    expect(remoteLog(bare).some(line => line.startsWith("Handoff: errand 1 - Race"))).toBe(true);
  });

  // Two senders (this one and another tool) both pick "highest number + 1"; whoever pushes second must take the next free number.
  it("renumbers its own note when another sender pushed the same number first", async () => {
    let first = true;
    let cloneBPath = "";
    const { desk, bare } = await setup({
      now: () => {
        if (first) {
          first = false;
          // Between our pull and our push another sender files item 1.
          const created = localIso(fixed);
          const dir = path.join(cloneBPath, "Desk");
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, noteFileName(created, 1, "Other sender")), renderNote({ id: 1, type: "errand", created, title: "Other sender", request: "x" }));
          sh(cloneBPath, ["add", "-A"]);
          sh(cloneBPath, ["commit", "-q", "-m", "other sender: item 1"]);
          sh(cloneBPath, ["push", "-q"]);
        }
        return fixed;
      },
    });
    cloneBPath = (await makeRemoteFor(bare)).cloneB;
    const sent = await desk.send({ type: "errand", title: "Mine", request: "r" });
    expect(sent.id).toBe(2);
    expect(sent.path).toContain("Item 02 - Mine.md");
    const files = sh(bare, ["ls-tree", "--name-only", "main", "Desk/"]).split(/\r?\n/);
    expect(files.some(file => file.includes("Item 01 - Other sender"))).toBe(true);
    expect(files.some(file => file.includes("Item 02 - Mine"))).toBe(true);
    expect(files.some(file => file.includes("Item 01 - Mine"))).toBe(false);
    expect(sh(bare, ["show", "main:Desk/2026-01-15 Item 02 - Mine.md"])).toContain("id: 2");
    expect((await desk.list() as Array<{ id: number }>).map(item => item.id)).toEqual([1, 2]);
  });

  it("refuses to write when the remote is unreachable at the start, and writes nothing", async () => {
    const { desk, bare, cloneA } = await setup();
    sh(cloneA, ["remote", "set-url", "origin", `${bare}-gone`]);
    await expect(desk.send({ type: "errand", title: "T", request: "r" })).rejects.toThrow(/Couldn't update the desk/);
    expect(await readdir(path.join(cloneA, "Desk")).catch(() => [])).toEqual([]);
  });

  it("keeps the note when the remote drops mid-send, and the next call delivers it", async () => {
    let drop: (() => void) | undefined;
    const { desk, bare, cloneA } = await setup({ now: () => { drop?.(); drop = undefined; return fixed; } });
    drop = () => sh(cloneA, ["remote", "set-url", "origin", `${bare}-gone`]);
    await expect(desk.send({ type: "errand", title: "Dropped", request: "r" })).rejects.toThrow(/committed in the desk's clone/);
    expect((await readdir(path.join(cloneA, "Desk"))).length).toBe(1);
    sh(cloneA, ["remote", "set-url", "origin", bare]);
    expect((await desk.list()).length).toBe(1);
    expect(remoteLog(bare).some(line => line.includes("Dropped"))).toBe(true);
  });

  it("keeps the note when the remote is reachable but refuses the push (access revoked), and delivers it once access returns", async () => {
    const { desk, bare, cloneA } = await setup();
    const hook = path.join(bare, "hooks", "pre-receive");
    await mkdir(path.dirname(hook), { recursive: true });
    await writeFile(hook, "#!/bin/sh\necho 'remote: Permission denied' >&2\nexit 1\n", { mode: 0o755 });
    await expect(desk.send({ type: "errand", title: "Denied", request: "r" })).rejects.toThrow(/committed in the desk's clone/);
    expect((await readdir(path.join(cloneA, "Desk"))).length).toBe(1);
    expect(remoteLog(bare).some(line => line.includes("Denied"))).toBe(false);
    await rm(hook);
    expect((await desk.list()).length).toBe(1);
    expect(remoteLog(bare).some(line => line.includes("Denied"))).toBe(true);
  });

  it("reads from the local copy and says so when the remote is unreachable", async () => {
    const { desk, bare, cloneA } = await setup();
    const { id } = await desk.send({ type: "errand", title: "T", request: "r" });
    sh(cloneA, ["remote", "set-url", "origin", `${bare}-gone`]);
    const listed = await desk.list();
    expect(Array.isArray(listed)).toBe(false);
    expect((listed as { stale: string }).stale).toMatch(/^Couldn't update/);
    expect((await desk.read(id)).stale).toMatch(/^Couldn't update/);
  });

  it("gives concurrent sends from two desks on one clone distinct numbers", async () => {
    const { desk, sync, bare, cloneA } = await setup();
    const second = createDesk({ deskDir: path.join(cloneA, "Desk"), rootDir: cloneA, sync, now: () => fixed });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? desk : second).send({ type: "errand", title: `T${i}`, request: "x" })));
    expect(new Set(results.map(r => r.id)).size).toBe(6);
    expect(remoteLog(bare).filter(line => line.startsWith("Handoff: errand")).length).toBe(6);
  });
});

describe("writeFiles over git", () => {
  const inbox = (cloneA: string) => path.join(cloneA, "Inbox", "n.md");

  it("commits and pushes exactly the files the task changed", async () => {
    const { desk, bare, cloneA } = await setup();
    await mkdir(path.join(cloneA, "Inbox"), { recursive: true });
    await writeFile(path.join(cloneA, "unrelated.txt"), "not ours\n");
    const result = await desk.writeFiles(async () => {
      await writeFile(inbox(cloneA), "# N\n\nhello\n");
      return { files: [inbox(cloneA)], message: "Handoff: reply to n", result: { ok: true } };
    });
    expect(result).toEqual({ ok: true, committed: true });
    expect(remoteLog(bare)).toContain("Handoff: reply to n");
    expect(sh(bare, ["show", "--name-only", "--format=", "main"])).toBe("Inbox/n.md");
  });

  it("makes no commit when nothing changed", async () => {
    const { desk, bare } = await setup();
    const before = remoteLog(bare).length;
    const result = await desk.writeFiles(async () => ({ files: [], message: "nothing", result: {} }));
    expect(result.committed).toBe(false);
    expect(remoteLog(bare).length).toBe(before);
  });

  it("drops our change with a clear message when the agent edited the same lines, and leaves no rebase behind", async () => {
    const { desk, cloneA, cloneB } = await setup();
    await mkdir(path.join(cloneA, "Inbox"), { recursive: true });
    await desk.writeFiles(async () => {
      await writeFile(inbox(cloneA), "# N\n\nbase line\n");
      return { files: [inbox(cloneA)], message: "Handoff: add n", result: {} };
    });
    sh(cloneB, ["pull", "--rebase", "-q"]);
    await expect(desk.writeFiles(async () => {
      // While our task runs, the agent pushes a conflicting edit of the same line.
      await writeFile(path.join(cloneB, "Inbox", "n.md"), "# N\n\nagent line\n");
      sh(cloneB, ["commit", "-q", "-am", "agent edit"]);
      sh(cloneB, ["push", "-q"]);
      await writeFile(inbox(cloneA), "# N\n\nour line\n");
      return { files: [inbox(cloneA)], message: "Handoff: our edit", result: {} };
    })).rejects.toThrow(/changed meanwhile/);
    expect(sh(cloneA, ["status", "--porcelain=v1", "--branch"]).split("\n")[0]).not.toContain("rebase");
    expect(await readFile(inbox(cloneA), "utf8")).not.toContain("<<<<<<<");
  });

  it("keeps the user's uncommitted edits to other tracked files when it drops our conflicted change", async () => {
    const { desk, cloneA, cloneB } = await setup();
    await mkdir(path.join(cloneA, "Inbox"), { recursive: true });
    await writeFile(path.join(cloneA, "handoff.md"), "rules\n");
    await desk.writeFiles(async () => {
      await writeFile(inbox(cloneA), "# N\n\nbase line\n");
      return { files: [inbox(cloneA), path.join(cloneA, "handoff.md")], message: "Handoff: add n", result: {} };
    });
    sh(cloneB, ["pull", "--rebase", "-q"]);
    await expect(desk.writeFiles(async () => {
      await writeFile(path.join(cloneB, "Inbox", "n.md"), "# N\n\nagent line\n");
      sh(cloneB, ["commit", "-q", "-am", "agent edit"]);
      sh(cloneB, ["push", "-q"]);
      // The user is editing handoff.md in the clone while this runs.
      await writeFile(path.join(cloneA, "handoff.md"), "rules\nmy unsaved thought\n");
      await writeFile(inbox(cloneA), "# N\n\nour line\n");
      return { files: [inbox(cloneA)], message: "Handoff: our edit", result: {} };
    })).rejects.toThrow(/changed meanwhile/);
    expect(await readFile(path.join(cloneA, "handoff.md"), "utf8")).toContain("my unsaved thought");
  });

  it("says where the user's edits are when they clash and end up in the stash", async () => {
    const { desk, cloneA, cloneB } = await setup();
    await mkdir(path.join(cloneA, "Inbox"), { recursive: true });
    await writeFile(path.join(cloneA, "handoff.md"), "rules\n");
    await desk.writeFiles(async () => {
      await writeFile(inbox(cloneA), "# N\n\nbase line\n");
      return { files: [inbox(cloneA), path.join(cloneA, "handoff.md")], message: "Handoff: add n", result: {} };
    });
    sh(cloneB, ["pull", "--rebase", "-q"]);
    await expect(desk.writeFiles(async () => {
      await writeFile(path.join(cloneB, "Inbox", "n.md"), "# N\n\nagent line\n");
      await writeFile(path.join(cloneB, "handoff.md"), "rules\nagent thought\n");
      sh(cloneB, ["commit", "-q", "-am", "agent edit"]);
      sh(cloneB, ["push", "-q"]);
      // The user is editing handoff.md in the clone while this runs.
      await writeFile(path.join(cloneA, "handoff.md"), "rules\nmy unsaved thought\n");
      await writeFile(inbox(cloneA), "# N\n\nour line\n");
      return { files: [inbox(cloneA)], message: "Handoff: our edit", result: {} };
    })).rejects.toThrow(/git stash pop/);
    expect(sh(cloneA, ["stash", "list"])).toContain("your uncommitted edits");
  });
});
