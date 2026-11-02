import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureBuilt } from "./testBuild.js";

// Fake credentials are assembled at run time, so no secret scanner ever sees one in the source.
const token = `${"4".repeat(9)}:${"m".repeat(35)}`;
const slackPath = ["services/", "T", "3".repeat(8), "/B", "3".repeat(8), "/", "w".repeat(24)].join("");
const hook = `https://hooks.slack.com/${slackPath}`;
const text = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0].text;

type Seen = { method?: string; url?: string; body: string };
type Mode = "ok" | "500" | "429" | "hangup";

/** A local stand-in for Telegram and Slack: records every request and answers the way the chosen mode says. */
async function mock(mode: Mode) {
  const seen: Seen[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", chunk => (body += chunk));
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, body });
      if (mode === "hangup") return request.socket.destroy();
      if (mode === "500") return void response.writeHead(500).end("boom");
      if (mode === "429") return void response.writeHead(429, { "retry-after": "5" }).end('{"ok":false}');
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { seen, server, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** A port with nothing listening on it. */
async function deadEndpoint() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

const open: Server[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });

async function run(endpoint: string, extra: Record<string, string> = {}) {
  const entry = await ensureBuilt();
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff chat e2e-")), "desk");
  const transport = new StdioClientTransport({
    command: process.execPath, args: [entry], stderr: "pipe",
    env: { HANDOFF_DIR: dir, HANDOFF_SYNC: "off", HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: hook, HANDOFF_CHAT_TEST_ENDPOINT: endpoint, ...extra },
  });
  let stderr = "";
  transport.stderr?.on("data", chunk => (stderr += chunk));
  const client = new Client({ name: "chat e2e", version: "1.0.0" });
  await client.connect(transport);
  const send = async () => text(await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Book <!channel> & dentist", request: "Friday at 3, private details" } }));
  return { client, send, dir, stderr: () => stderr };
}

describe("Telegram and Slack doorbells in the built program, against a local stand-in", () => {
  it("sends exactly the documented request to each service and reports both as rung", async () => {
    const stand = await mock("ok"); open.push(stand.server);
    const { client, send, stderr } = await run(stand.endpoint);
    try {
      const raw = await send();
      const result = JSON.parse(raw);
      expect(result.notified).toEqual(expect.arrayContaining(["telegram", "slack"]));
      expect(result.chat).toEqual({ telegram: { rung: true }, slack: { rung: true } });
      const telegram = stand.seen.find(request => request.url === `/bot${token}/sendMessage`)!;
      const slack = stand.seen.find(request => request.url === "/slack")!;
      expect([telegram.method, slack.method]).toEqual(["POST", "POST"]);
      const tbody = JSON.parse(telegram.body);
      expect(Object.keys(tbody).sort()).toEqual(["chat_id", "link_preview_options", "text"]);
      expect(tbody.chat_id).toBe("42");
      expect(tbody.link_preview_options).toEqual({ is_disabled: true });
      expect(tbody.text).toContain("Book <!channel> & dentist");
      expect(tbody.text).not.toContain("private details");
      const sbody = JSON.parse(slack.body);
      expect(Object.keys(sbody)).toEqual(["text"]);
      expect(sbody.text).toContain("Book &lt;!channel&gt; &amp; dentist");
      expect(sbody.text).not.toContain("<!channel>");
      for (const visible of [raw, stderr()]) { expect(visible).not.toContain(token); expect(visible).not.toContain(slackPath); }
    } finally { await client.close(); }
  }, 180_000);

  it("includes the request only when asked", async () => {
    const stand = await mock("ok"); open.push(stand.server);
    const { client, send } = await run(stand.endpoint, { HANDOFF_NOTIFY_INCLUDE_REQUEST: "1" });
    try {
      await send();
      expect(stand.seen.map(request => request.body).join("\n")).toContain("private details");
    } finally { await client.close(); }
  }, 180_000);

  it.each<[Mode, RegExp]>([["500", /500/], ["429", /429/], ["hangup", /Could not reach/]])("when the services answer %s: not rung, the status is named, the note is still written, nothing secret leaks", async (mode, reason) => {
    const stand = await mock(mode); open.push(stand.server);
    const { client, send, dir, stderr } = await run(stand.endpoint);
    try {
      const raw = await send();
      const result = JSON.parse(raw);
      expect(result.id).toBe(1);
      expect(result.notified).toEqual([]);
      expect(result.chat.telegram.rung).toBe(false);
      expect(result.chat.slack.rung).toBe(false);
      expect(result.chat.telegram.reason).toMatch(reason);
      expect(result.chat.slack.reason).toMatch(reason);
      expect((await readdir(path.join(dir, "Desk"))).some(name => name.endsWith(".md"))).toBe(true);
      for (const visible of [raw, stderr()]) { expect(visible).not.toContain(token); expect(visible).not.toContain(slackPath); expect(visible).not.toContain("127.0.0.1"); }
    } finally { await client.close(); }
  }, 180_000);

  it("when nothing is listening: not rung, a clear reason, still no secret", async () => {
    const { client, send, stderr } = await run(await deadEndpoint());
    try {
      const raw = await send();
      const result = JSON.parse(raw);
      expect(result.notified).toEqual([]);
      expect(result.chat.telegram.reason).toMatch(/Could not reach Telegram/);
      expect(result.chat.slack.reason).toMatch(/Could not reach Slack/);
      for (const visible of [raw, stderr()]) { expect(visible).not.toContain(token); expect(visible).not.toContain(slackPath); }
    } finally { await client.close(); }
  }, 180_000);

  it("ignores a remote endpoint with one warning on stderr, never on stdout, and never echoes the value", async () => {
    const { client, stderr } = await run("https://user:pw@evil.example:443");
    try {
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
      const warnings = stderr().split("\n").filter(line => line.includes("HANDOFF_CHAT_TEST_ENDPOINT"));
      expect(warnings).toHaveLength(1);
      expect(stderr()).not.toContain("evil.example");
      expect(stderr()).not.toContain("pw@");
    } finally { await client.close(); }
  }, 180_000);
});
