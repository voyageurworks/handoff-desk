import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { capabilitiesIn } from "./capabilities.js";
import { loadConfig } from "./config.js";
import { createDesk } from "./desk.js";
import { initDesk } from "./init.js";
import { buildServer } from "./server.js";
import { detectSync, ensureClone, pullRebase, type SyncHandle } from "./sync.js";
import { ensureBuilt } from "./testBuild.js";
import { makeRemote, sh } from "./testRepos.js";

const run = promisify(execFile);
const text = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0].text);
const failed = (result: unknown) => Boolean((result as { isError?: boolean }).isError);
const ENV = { HANDOFF_GIT_NAME: "Desk User", HANDOFF_GIT_EMAIL: "user@example.com" };

async function connect(dir: string, source: Parameters<typeof buildServer>[1], env: Record<string, string> = {}) {
  const server = buildServer(loadConfig({ HANDOFF_DIR: dir, ...ENV, ...env }), source);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("a remote value that looks like a git option is never run as one", () => {
  it("ensureClone rejects '--version' and creates nothing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "handoff-opt-"));
    const target = path.join(root, "clone");
    await expect(ensureClone(target, "--version")).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });
});

describe("uncommitted edits that conflict with what the agent pushed", () => {
  it("leaves the edits in git stash, leaves the clone clean and current, and the next call works", async () => {
    const { cloneA, cloneB } = await makeRemote();
    await writeFile(path.join(cloneB, "README.md"), "agent line\n");
    sh(cloneB, ["commit", "-q", "-am", "agent edit"]);
    sh(cloneB, ["push", "-q"]);
    await writeFile(path.join(cloneA, "README.md"), "my line\n");

    await expect(pullRebase(cloneA)).rejects.toThrow(/git stash/);
    expect(sh(cloneA, ["stash", "list"])).not.toBe("");
    expect(sh(cloneA, ["stash", "show", "-p"])).toContain("my line");
    expect((await readFile(path.join(cloneA, "README.md"), "utf8")).trim()).toBe("agent line");
    expect(sh(cloneA, ["status", "--porcelain"])).toBe("");
    await expect(pullRebase(cloneA)).resolves.toBeUndefined();
  });
});

describe("send when the remote is unreachable", () => {
  it("says plainly that nothing was sent or saved", async () => {
    const { cloneA, bare } = await makeRemote();
    const sync = await detectSync(cloneA, ENV);
    const desk = createDesk({ deskDir: path.join(cloneA, "Desk"), rootDir: cloneA, sync: sync ?? undefined });
    sh(cloneA, ["remote", "set-url", "origin", `${bare}-gone`]);
    await expect(desk.send({ type: "errand", title: "T", request: "r" })).rejects.toThrow(/Nothing was sent or saved.*Couldn't update the desk/s);
  });
});

describe("an unedited handoff.md", () => {
  it("is flagged, and stops being flagged once the placeholders are replaced", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-unedited-"));
    await initDesk(dir);
    expect((await capabilitiesIn(dir)).unedited).toBe(true);
    await writeFile(path.join(dir, "handoff.md"), "# Rules\n\n## About me\n\nI am a tester.\n\n## You may do alone\n\n- Look things up\n\n## Ask me first\n\n- Spend money\n\n## Never\n\n- Share secrets\n");
    expect((await capabilitiesIn(dir)).unedited).toBe(false);
  });
});

describe("inbox notes that are links to some other file", () => {
  // A symbolic link where this account may create one, otherwise a hard link (no privilege needed): both write through.
  it.each(["symbolic", "hard"])("a %s link is not written through", async kind => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-link-"));
    await initDesk(dir);
    const outside = path.join(await mkdtemp(path.join(tmpdir(), "handoff-outside-")), "secret.md");
    await writeFile(outside, "# Outside\n\nnot yours\n");
    const note = path.join(dir, "Inbox", "idea.md");
    try {
      await (kind === "symbolic" ? symlink(outside, note) : link(outside, note));
    } catch {
      return; // this account may not be allowed to create that kind of link; nothing to test
    }
    const client = await connect(dir, null);
    const result = await client.callTool({ name: "handoff_inbox_reply", arguments: { file: "idea.md", reply: "hello" } });
    expect(failed(result)).toBe(true);
    expect(text(result)).toMatch(/link/);
    expect(await readFile(outside, "utf8")).toBe("# Outside\n\nnot yours\n");
  });
});

describe("sync set-up that fails at first is retried, not remembered", () => {
  it("the first tool call reports the error and the next one succeeds once the problem is fixed", async () => {
    const { cloneA } = await makeRemote();
    let calls = 0;
    const source = async (): Promise<SyncHandle | null> => {
      calls++;
      if (calls === 1) throw new Error("clone failed: network unreachable");
      return detectSync(cloneA, ENV);
    };
    const client = await connect(cloneA, source);
    const first = await client.callTool({ name: "handoff_list", arguments: {} });
    expect(failed(first)).toBe(true);
    expect(text(first)).toContain("network unreachable");
    const second = await client.callTool({ name: "handoff_list", arguments: {} });
    expect(failed(second)).toBe(false);
    expect(JSON.parse(text(second))).toEqual([]);
    await client.callTool({ name: "handoff_list", arguments: {} });
    expect(calls).toBe(2); // a success is remembered
  });
});

describe("handoff_wait stays inside the 60 s that MCP clients allow one call by default", () => {
  it("takes `seconds` (at most 50) and returns unanswered when time is up", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-wait-"));
    const client = await connect(dir, null);
    await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "T", request: "r" } });
    const tool = (await client.listTools()).tools.find(t => t.name === "handoff_wait");
    const props = (tool?.inputSchema.properties ?? {}) as Record<string, { maximum?: number }>;
    expect(props.seconds?.maximum).toBeLessThanOrEqual(50);
    expect(props.minutes).toBeUndefined();
    const started = Date.now();
    const waited = JSON.parse(text(await client.callTool({ name: "handoff_wait", arguments: { id: 1, seconds: 1 } })));
    expect(waited.answered).toBe(false);
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});

describe("two server processes sending at once on one clone", () => {
  it("get distinct item numbers and every note reaches the remote", async () => {
    const entry = await ensureBuilt();
    const dist = path.dirname(entry);
    const { cloneA, bare } = await makeRemote();
    const script = path.join(await mkdtemp(path.join(tmpdir(), "handoff-proc-")), "send3.mjs");
    await writeFile(script, `
      import { createDesk } from ${JSON.stringify(pathToFileURL(path.join(dist, "desk.js")).href)};
      import { detectSync } from ${JSON.stringify(pathToFileURL(path.join(dist, "sync.js")).href)};
      import path from "node:path";
      const [root, tag] = process.argv.slice(2);
      const sync = await detectSync(root, process.env);
      const desk = createDesk({ deskDir: path.join(root, "Desk"), rootDir: root, sync });
      for (let i = 0; i < 2; i++) await desk.send({ type: "errand", title: tag + " " + i, request: "r" });
    `);
    const env = { ...process.env, ...ENV };
    await Promise.all(["p1", "p2"].map(tag => run(process.execPath, [script, cloneA, tag], { env })));
    const log = sh(bare, ["log", "--format=%s", "main"]).split("\n").filter(line => line.startsWith("Handoff: errand"));
    expect(log).toHaveLength(4);
    const ids = log.map(line => line.match(/errand (\d+) -/)?.[1]);
    expect(new Set(ids).size).toBe(4);
    await mkdir(path.join(cloneA, "Desk"), { recursive: true });
  });
});
