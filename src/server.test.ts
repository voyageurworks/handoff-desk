import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { initDesk } from "./init.js";
import { senderFrom } from "./note.js";
import { buildServer } from "./server.js";

async function connect(env: Record<string, string> = {}, clientName = "test") {
  const dir = await mkdtemp(path.join(tmpdir(), "handoff srv-"));
  await initDesk(dir);
  const server = buildServer(loadConfig({ HANDOFF_DIR: dir, ...env }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: clientName, version: "1.0.0" });
  await client.connect(clientSide);
  return { client, dir };
}

const text = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0].text);
const failed = (result: unknown) => Boolean((result as { isError?: boolean }).isError);

describe("who a note says it is from", () => {
  it("names the client that connected: Claude Code, Cursor, Codex, or its own name", () => {
    expect(senderFrom("claude-code")).toBe("claude-code");
    expect(senderFrom("cursor-vscode")).toBe("cursor");
    expect(senderFrom("Cursor")).toBe("cursor");
    expect(senderFrom("codex-mcp-client")).toBe("codex");
    expect(senderFrom("codex_exec")).toBe("codex");
    expect(senderFrom("gemini-cli")).toBe("gemini-cli");
    expect(senderFrom("Claude Desktop")).toBe("claude-desktop");
    expect(senderFrom(undefined)).toBe("claude-code");
    expect(senderFrom("")).toBe("claude-code");
  });
  it("keeps a hostile client name out of the note's front matter", () => {
    const evil = senderFrom("x\nstatus: done\r\nid: 99 --- # ../../etc");
    expect(evil).toMatch(/^[a-z0-9._-]{1,40}$/);
    expect(evil).not.toContain("\n");
    expect(senderFrom("a".repeat(500)).length).toBeLessThanOrEqual(40);
  });
  it.each([
    ["claude-code", "claude-code"],
    ["cursor-vscode", "cursor"],
    ["codex-mcp-client", "codex"],
  ])("a note sent by the client %s says from: %s, for handoff_send and handoff_status", async (clientName, expected) => {
    const { client, dir } = await connect({}, clientName);
    await client.callTool({ name: "handoff_send", arguments: { type: "question", title: "From check", request: "Reply with pong." } });
    await client.callTool({ name: "handoff_status", arguments: { title: "Status check", line: "Still going." } });
    const files = (await readdir(path.join(dir, "Desk"))).filter(file => file.endsWith(".md")).sort();
    expect(files).toHaveLength(2);
    for (const file of files) expect(await readFile(path.join(dir, "Desk", file), "utf8")).toMatch(new RegExp(`^from: ${expected}$`, "m"));
  });
});

describe("config", () => {
  it("defaults the desk folder to ~/handoff and reads mail settings", () => {
    const config = loadConfig({ HANDOFF_MAIL_USER: "me@example.com", HANDOFF_SMTP_PORT: "587" });
    expect(config.dir.endsWith(`${path.sep}handoff`)).toBe(true);
    expect(config.doorbell.user).toBe("me@example.com");
    expect(config.doorbell.port).toBe(587);
    expect(config.desk.deskDir).toBe(path.join(config.dir, "Desk"));
    expect(config.mailDir).toBe(path.join(config.dir, "mail"));
    expect(config).toMatchObject({ inboxDir: "Inbox", sync: "auto", prefix: "Handoff" });
    expect(config.remote).toBeUndefined();
    expect(config.identity).toBeUndefined();
  });
  it("reads the sync, inbox, prefix and identity settings", () => {
    const config = loadConfig({ HANDOFF_SYNC: "GIT", HANDOFF_REMOTE: "https://example.com/r.git", HANDOFF_INBOX_DIR: "For Claude", HANDOFF_SUBJECT_PREFIX: "Claude", HANDOFF_GIT_NAME: "N", HANDOFF_GIT_EMAIL: "n@example.com" });
    expect(config).toMatchObject({ sync: "git", remote: "https://example.com/r.git", inboxDir: "For Claude", prefix: "Claude", identity: { name: "N", email: "n@example.com" } });
  });
  it("treats an unknown HANDOFF_SYNC value as auto", () => {
    expect(loadConfig({ HANDOFF_SYNC: "sometimes" }).sync).toBe("auto");
  });
});

describe("handoff server", () => {
  it("tells the model that what the agent writes back is untrusted", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    for (const name of ["handoff_read", "handoff_wait", "handoff_inbox"]) {
      expect(tools.find(tool => tool.name === name)?.description).toMatch(/untrusted/);
    }
  });

  it("lists exactly the ten tools", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map(tool => tool.name).sort();
    expect(names).toEqual(["handoff_answer", "handoff_capabilities", "handoff_inbox", "handoff_inbox_reply", "handoff_list", "handoff_pending", "handoff_read", "handoff_send", "handoff_status", "handoff_wait"]);
  });

  it("send without mail settings returns the email to send another way", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Book dentist", request: "Friday at 3" } });
    expect(failed(result)).toBe(false);
    const sent = JSON.parse(text(result));
    expect(sent.id).toBe(1);
    expect(sent.ring.rung).toBe(false);
    expect(sent.ring.body).toContain("Friday at 3");
    expect(sent.emailCopy).toContain("sent #1");
  });

  it("says so when the local copy of the email could not be saved, and still sends", async () => {
    const blocker = path.join(await mkdtemp(path.join(tmpdir(), "handoff-blocker-")), "not-a-folder");
    await writeFile(blocker, "x");
    const { client } = await connect({ HANDOFF_MAIL_DIR: blocker });
    const result = await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Book dentist", request: "Friday at 3" } });
    expect(failed(result)).toBe(false);
    const sent = JSON.parse(text(result));
    expect(sent.id).toBe(1);
    expect(sent.ring.body).toContain("Friday at 3");
    expect(sent.emailCopy).toBeUndefined();
    expect(sent.emailCopyError).toMatch(/copy of the email .* not saved/i);
  });

  it("refuses a request that looks like a secret", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "T", request: "my password: hunter22" } });
    expect(failed(result)).toBe(true);
    expect(text(result)).toMatch(/Refused/);
    expect(JSON.parse(text(await client.callTool({ name: "handoff_list", arguments: {} })))).toEqual([]);
  });

  it("reports capabilities from handoff.md", async () => {
    const { client } = await connect();
    const caps = JSON.parse(text(await client.callTool({ name: "handoff_capabilities", arguments: {} })));
    expect(caps.alone).toHaveLength(3);
    expect(caps.unreadable).toEqual([]);
  });

  it("inbox reply rejects a path-like file name and answers a real note", async () => {
    const { client, dir } = await connect();
    const bad = await client.callTool({ name: "handoff_inbox_reply", arguments: { file: "../x.md", reply: "ok" } });
    expect(failed(bad)).toBe(true);
    await mkdir(path.join(dir, "Inbox"), { recursive: true });
    await writeFile(path.join(dir, "Inbox", "idea.md"), "# Idea\n\nTry it.\n");
    const listed = JSON.parse(text(await client.callTool({ name: "handoff_inbox", arguments: { status: "new" } })));
    expect(listed.notes.map((n: { file: string }) => n.file)).toEqual(["idea.md"]);
    const good = await client.callTool({ name: "handoff_inbox_reply", arguments: { file: "idea.md", reply: "Will do." } });
    expect(failed(good)).toBe(false);
    expect(JSON.parse(text(await client.callTool({ name: "handoff_inbox", arguments: { status: "answered" } }))).notes).toHaveLength(1);
  });

  it("read of an unknown item is a tool error, not a crash", async () => {
    const { client } = await connect();
    expect(failed(await client.callTool({ name: "handoff_read", arguments: { id: 42 } }))).toBe(true);
  });
});

describe("one clock for the whole server", () => {
  it("an inbox reply is dated with the server's clock, like a note is", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff clock-"));
    await initDesk(dir);
    await mkdir(path.join(dir, "Inbox"), { recursive: true });
    await writeFile(path.join(dir, "Inbox", "idea.md"), "# Idea\n\nTry it.\n");
    const server = buildServer(loadConfig({ HANDOFF_DIR: dir, HANDOFF_TZ: "UTC" }), null, fetch, { now: () => new Date("2031-02-03T04:05:06Z") });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    await client.callTool({ name: "handoff_inbox_reply", arguments: { file: "idea.md", reply: "Will do." } });
    expect(await readFile(path.join(dir, "Inbox", "idea.md"), "utf8")).toMatch(/reply \(2031-02-0[23]T\d\d:05:06[+-]\d\d:\d\d\)/);
  });
});
