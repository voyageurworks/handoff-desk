import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { initDesk } from "./init.js";
import { buildServer } from "./server.js";

// Fake credentials are assembled at run time, so no secret scanner ever sees one in the source.
const token = `${"2".repeat(9)}:${"q".repeat(35)}`;
const hook = ["https://hooks.slack.com/", "services/", "T", "1".repeat(8), "/B", "1".repeat(8), "/", "z".repeat(24)].join("");

async function connect(env: Record<string, string>, fetchImpl: typeof fetch) {
  const dir = await mkdtemp(path.join(tmpdir(), "handoff chat-"));
  await initDesk(dir);
  const server = buildServer(loadConfig({ HANDOFF_DIR: dir, ...env }), null, fetchImpl);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}
const send = async (client: Client, title = "Book the dentist") =>
  JSON.parse(((await client.callTool({ name: "handoff_send", arguments: { type: "errand", title, request: "Friday at 3" } })) as { content: Array<{ text: string }> }).content[0].text);

function recorder(response: () => Response = () => new Response("ok", { status: 200 })) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string | URL) => { urls.push(String(url)); return response(); }) as typeof fetch;
  return { urls, fetchImpl };
}

describe("chat doorbell settings", () => {
  it("reads the six settings and leaves chat empty when none is set", () => {
    const set = loadConfig({
      HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND: "get-token", HANDOFF_TELEGRAM_CHAT_ID: "42",
      HANDOFF_SLACK_WEBHOOK_URL: hook, HANDOFF_SLACK_WEBHOOK_COMMAND: "get-hook", HANDOFF_NOTIFY_INCLUDE_REQUEST: "1",
    });
    expect(set.chat).toEqual({
      telegram: { token, tokenCommand: "get-token", chatId: "42" },
      slack: { webhook: hook, webhookCommand: "get-hook" },
      includeRequest: true,
    });
    expect(loadConfig({}).chat).toEqual({ includeRequest: false });
  });
});

describe("handoff_send with chat doorbells", () => {
  it("is unchanged when no chat channel is configured, and says nobody was notified", async () => {
    const { urls, fetchImpl } = recorder();
    const result = await send(await connect({}, fetchImpl));
    expect(result).toHaveProperty("ring");
    expect(result).not.toHaveProperty("chat");
    expect(result.notified).toEqual([]);
    expect(urls).toHaveLength(0);
  });
  it("rings Telegram and Slack, reports who rang, and keeps the email part as it was", async () => {
    const { urls, fetchImpl } = recorder();
    const client = await connect({ HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: hook }, fetchImpl);
    const result = await send(client);
    expect(result.chat).toEqual({ telegram: { rung: true }, slack: { rung: true } });
    expect(result.notified).toEqual(["telegram", "slack"]);
    expect(result.ring.rung).toBe(false);
    expect(result.ring.reason).toMatch(/not configured/i);
    expect([...urls].sort()).toEqual([hook, `https://api.telegram.org/bot${token}/sendMessage`].sort());
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(hook);
  });
  it("still delivers the note when a chat service fails, and says why without secrets", async () => {
    const { fetchImpl } = recorder(() => new Response("nope", { status: 500 }));
    const result = await send(await connect({ HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42" }, fetchImpl));
    expect(result.id).toBe(1);
    expect(result.notified).toEqual([]);
    expect(result.chat.telegram).toMatchObject({ rung: false });
    expect(result.chat.telegram.reason).toContain("500");
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("tells the assistant about the new field in the tool description", async () => {
    const { fetchImpl } = recorder();
    const client = await connect({}, fetchImpl);
    const tools = (await client.listTools()).tools;
    const description = tools.find(tool => tool.name === "handoff_send")?.description ?? "";
    expect(description).toMatch(/notified/);
    expect(description).toMatch(/telegram/i);
  });
});
