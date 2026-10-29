import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commitAndPush, detectSync, ensureClone, PushFailedError, pushPending } from "./sync.js";
import { makeRemote, sh } from "./testRepos.js";

const remoteLog = (bare: string) => sh(bare, ["log", "--format=%s", "main"]).split("\n");

describe("commitAndPush", () => {
  it("pushes a new file to the remote", async () => {
    const { bare, cloneA } = await makeRemote();
    await writeFile(path.join(cloneA, "a.md"), "a\n");
    await commitAndPush(cloneA, [path.join(cloneA, "a.md")], "add a");
    expect(remoteLog(bare)).toContain("add a");
  });

  it("rebases onto a commit the agent pushed meanwhile", async () => {
    const { bare, cloneA, cloneB } = await makeRemote();
    await writeFile(path.join(cloneB, "agent.md"), "x\n");
    await commitAndPush(cloneB, [path.join(cloneB, "agent.md")], "agent commit");
    await writeFile(path.join(cloneA, "a.md"), "a\n");
    await commitAndPush(cloneA, [path.join(cloneA, "a.md")], "add a");
    expect(remoteLog(bare)).toEqual(expect.arrayContaining(["add a", "agent commit"]));
  });

  it("survives uncommitted edits to a tracked file (the user is editing handoff.md)", async () => {
    const { bare, cloneA, cloneB } = await makeRemote();
    await writeFile(path.join(cloneB, "agent.md"), "x\n");
    await commitAndPush(cloneB, [path.join(cloneB, "agent.md")], "agent commit");
    await writeFile(path.join(cloneA, "README.md"), "my unsaved-to-git edit\n");
    await writeFile(path.join(cloneA, "a.md"), "a\n");
    await commitAndPush(cloneA, [path.join(cloneA, "a.md")], "add a");
    expect(remoteLog(bare)).toEqual(expect.arrayContaining(["add a", "agent commit"]));
    expect(sh(cloneA, ["show", "--name-only", "--format=", "HEAD"])).toBe("a.md");
    expect((await readFile(path.join(cloneA, "README.md"), "utf8")).trim()).toBe("my unsaved-to-git edit");
  });

  it("commits only the named paths", async () => {
    const { cloneA } = await makeRemote();
    await writeFile(path.join(cloneA, "README.md"), "edited but not staged\n");
    await writeFile(path.join(cloneA, "a.md"), "a\n");
    await commitAndPush(cloneA, [path.join(cloneA, "a.md")], "add a");
    expect(sh(cloneA, ["show", "--name-only", "--format=", "HEAD"])).toBe("a.md");
  });

  it("keeps the commit when the remote is unreachable and delivers it later", async () => {
    const { bare, cloneA } = await makeRemote();
    sh(cloneA, ["remote", "set-url", "origin", `${bare}-gone`]);
    await writeFile(path.join(cloneA, "a.md"), "a\n");
    await expect(commitAndPush(cloneA, [path.join(cloneA, "a.md")], "add a")).rejects.toBeInstanceOf(PushFailedError);
    expect(sh(cloneA, ["log", "-1", "--format=%s"])).toBe("add a");
    sh(cloneA, ["remote", "set-url", "origin", bare]);
    expect(await pushPending(cloneA)).toBe(1);
    expect(remoteLog(bare)).toContain("add a");
    expect(await pushPending(cloneA)).toBe(0);
  });

  it("uses the identity it is given", async () => {
    const { cloneA } = await makeRemote();
    await writeFile(path.join(cloneA, "a.md"), "a\n");
    await commitAndPush(cloneA, [path.join(cloneA, "a.md")], "add a", { name: "Desk Bot", email: "bot@example.com" });
    expect(sh(cloneA, ["log", "-1", "--format=%an <%ae>"])).toBe("Desk Bot <bot@example.com>");
  });
});

describe("detectSync", () => {
  it("is null for a plain folder, a repo without upstream, and when sync is off", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "handoff-plain-"));
    expect(await detectSync(plain, {})).toBeNull();
    const lone = await mkdtemp(path.join(tmpdir(), "handoff-lone-"));
    sh(lone, ["init", "-q"]);
    expect(await detectSync(lone, {})).toBeNull();
    const { cloneA } = await makeRemote();
    expect(await detectSync(cloneA, { HANDOFF_SYNC: "off" })).toBeNull();
  });
  it("returns a handle for a clone with an upstream, including from a subfolder", async () => {
    const { cloneA } = await makeRemote();
    await mkdir(path.join(cloneA, "sub"));
    const handle = await detectSync(path.join(cloneA, "sub"), { HANDOFF_GIT_NAME: "N", HANDOFF_GIT_EMAIL: "n@example.com" });
    // git reports the long form of a path while the temp dir may come as an 8.3 short name (Windows CI): compare real paths.
    const real = (await realpath(cloneA)).replace(/\\/g, "/");
    expect((await realpath(handle!.root)).replace(/\\/g, "/")).toBe(real);
    expect((await realpath(handle!.gitDir)).replace(/\\/g, "/")).toBe(`${real}/.git`);
    expect(handle?.identity).toEqual({ name: "N", email: "n@example.com" });
  });
  it("throws under HANDOFF_SYNC=git in a plain folder", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "handoff-plain-"));
    await expect(detectSync(plain, { HANDOFF_SYNC: "git" })).rejects.toThrow(/HANDOFF_SYNC=git/);
  });
});

describe("ensureClone", () => {
  it("clones into a missing folder and leaves a non-empty folder alone", async () => {
    const { root, bare } = await makeRemote();
    const target = path.join(root, "fresh clone");
    await ensureClone(target, bare);
    expect((await readdir(target)).includes("README.md")).toBe(true);
    const busy = path.join(root, "busy");
    await mkdir(busy);
    await writeFile(path.join(busy, "mine.txt"), "x");
    await ensureClone(busy, bare);
    expect(await readdir(busy)).toEqual(["mine.txt"]);
  });
});

describe("git hardening", () => {
  it("never follows an ext:: remote (it would run a command), whatever the user's git config says", async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff-ext-")), "clone");
    const flag = path.join(path.dirname(dir), "ran");
    await expect(ensureClone(dir, `ext::sh -c "touch ${flag.split(path.sep).join("/")}" %S`)).rejects.toThrow();
    await expect(readFile(flag)).rejects.toThrow();
  });
  it("keeps credentials inside a remote URL out of error messages", async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff-cred-")), "clone");
    const error = await ensureClone(dir, "http://user:sekrit-token@127.0.0.1:1/none.git").then(() => null, (e: unknown) => e);
    expect(String(error)).not.toContain("sekrit-token");
  });
});

describe("commit identity fallback", () => {
  it("commits with a neutral identity when git has no name or email anywhere", async () => {
    const { cloneA, bare } = await makeRemote();
    sh(cloneA, ["config", "--unset", "user.name"]);
    sh(cloneA, ["config", "--unset", "user.email"]);
    const empty = path.join(path.dirname(cloneA), "empty-gitconfig");
    await writeFile(empty, "");
    const saved = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM, n: process.env.GIT_CONFIG_SYSTEM };
    process.env.GIT_CONFIG_GLOBAL = empty;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    try {
      const handle = await detectSync(cloneA, { HANDOFF_SYNC: "git" });
      expect(handle?.identity).toEqual({ name: "handoff-desk", email: "handoff-desk@localhost" });
      await mkdir(path.join(cloneA, "Desk"), { recursive: true });
      await writeFile(path.join(cloneA, "Desk", "n.md"), "note\n");
      await commitAndPush(cloneA, ["Desk/n.md"], "Handoff: note", handle?.identity);
      expect(sh(bare, ["log", "-1", "--format=%an|%s", "main"])).toBe("handoff-desk|Handoff: note");
    } finally {
      for (const [key, value] of [["GIT_CONFIG_GLOBAL", saved.g], ["GIT_CONFIG_NOSYSTEM", saved.s]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("keeps the repository's own identity when git has one", async () => {
    const { cloneA } = await makeRemote();
    const handle = await detectSync(cloneA, { HANDOFF_SYNC: "git" });
    expect(handle?.identity).toBeUndefined();
  });
});
