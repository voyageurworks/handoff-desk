import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { detectSync } from "./sync.js";
import { makeRemote, sh } from "./testRepos.js";

const text = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0].text);
const failed = (result: unknown) => Boolean((result as { isError?: boolean }).isError);
const ENV = { HANDOFF_GIT_NAME: "Desk User", HANDOFF_GIT_EMAIL: "user@example.com" };

async function connect(dir: string, env: Record<string, string> = {}) {
  const merged = { HANDOFF_DIR: dir, ...ENV, ...env };
  const config = loadConfig(merged);
  const sync = await detectSync(dir, merged).catch((error: unknown) => error as Error);
  const server = buildServer(config, sync);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("server over a synced desk", () => {
  it("send pushes the note and its email tells the agent to commit and push", async () => {
    const { cloneA, bare } = await makeRemote();
    const client = await connect(cloneA);
    const sent = JSON.parse(text(await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Book dentist", request: "Friday at 3" } })));
    expect(sent.id).toBe(1);
    expect(sent.ring.body).toContain("then commit and push");
    expect(sh(bare, ["log", "--format=%s", "main"])).toContain("Handoff: errand 1 - Book dentist");
  });

  it("inbox reply on a note the agent pushed ends up on the remote", async () => {
    const { cloneA, cloneB, bare } = await makeRemote();
    await mkdir(path.join(cloneB, "Inbox"), { recursive: true });
    await writeFile(path.join(cloneB, "Inbox", "idea.md"), "# Idea\n\nTry it.\n");
    sh(cloneB, ["add", "-A"]);
    sh(cloneB, ["commit", "-q", "-m", "agent note"]);
    sh(cloneB, ["push", "-q"]);
    const client = await connect(cloneA);
    const listed = JSON.parse(text(await client.callTool({ name: "handoff_inbox", arguments: { status: "new" } })));
    expect(listed.notes.map((n: { file: string }) => n.file)).toEqual(["idea.md"]);
    const reply = await client.callTool({ name: "handoff_inbox_reply", arguments: { file: "idea.md", reply: "Will do." } });
    expect(failed(reply)).toBe(false);
    expect(sh(bare, ["log", "--format=%s", "main"])).toContain("Handoff: reply to idea.md");
    expect(sh(bare, ["show", "main:Inbox/idea.md"])).toContain("Will do.");
  });

  it("uses a custom inbox folder and subject prefix", async () => {
    const { cloneA } = await makeRemote();
    await mkdir(path.join(cloneA, "For Claude"), { recursive: true });
    await writeFile(path.join(cloneA, "For Claude", "q.md"), "# Q\n");
    const client = await connect(cloneA, { HANDOFF_INBOX_DIR: "For Claude", HANDOFF_SUBJECT_PREFIX: "Claude" });
    const listed = JSON.parse(text(await client.callTool({ name: "handoff_inbox", arguments: {} })));
    expect(listed.notes.map((n: { file: string }) => n.file)).toEqual(["q.md"]);
    const sent = JSON.parse(text(await client.callTool({ name: "handoff_send", arguments: { type: "question", title: "Why", request: "r" } })));
    expect(sent.ring.subject).toBe("[Claude question #1] Why");
  });

  it("HANDOFF_SYNC=git in a plain folder is a tool error naming the setting", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-plain-"));
    const client = await connect(dir, { HANDOFF_SYNC: "git" });
    const result = await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "T", request: "r" } });
    expect(failed(result)).toBe(true);
    expect(text(result)).toContain("HANDOFF_SYNC=git");
  });
});
