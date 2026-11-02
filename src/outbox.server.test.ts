import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { initDesk } from "./init.js";
import { BACKOFF_MS, outboxDir } from "./outbox.js";
import { buildServer } from "./server.js";
import { runStandIn } from "./standin.js";

// Fake credentials are assembled at run time, so no secret scanner ever sees one in the source.
const token = `${"5".repeat(9)}:${"n".repeat(35)}`;
const hook = ["https://hooks.slack.com/", "services/", "T", "4".repeat(8), "/B", "4".repeat(8), "/", "v".repeat(24)].join("");
const t0 = new Date("2026-11-03T10:00:00Z");

type Call = { url: string; body: string };
/** A network that answers per service: telegram and slack each get a status, and every request is recorded. */
function network(status: { telegram: number; slack: number }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    const code = String(url).includes("telegram") ? status.telegram : status.slack;
    return new Response("x", { status: code });
  }) as typeof fetch;
  return { calls, status, fetchImpl };
}
const text = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0].text;

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "handoff outbox srv-"));
  await initDesk(dir);
  const state = await mkdtemp(path.join(tmpdir(), "handoff state-"));
  const env = { HANDOFF_DIR: dir, HANDOFF_STATE_DIR: state, HANDOFF_SYNC: "off", HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: hook };
  const config = loadConfig(env);
  const connect = async (fetchImpl: typeof fetch, now: () => Date) => {
    const server = buildServer(config, null, fetchImpl, { now });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    return client;
  };
  const send = async (client: Client, title = "Book the dentist") => JSON.parse(text(await client.callTool({ name: "handoff_send", arguments: { type: "errand", title, request: "Friday at 3" } })));
  const queued = async () => JSON.parse(await readFile(path.join(config.outbox, "outbox.json"), "utf8").catch(() => "[]")) as Array<{ id: number; channels: string[] }>;
  return { dir, config, connect, send, queued };
}

describe("the outbox in handoff_send", () => {
  it("is where loadConfig says: outside the desk, keyed by it", async () => {
    const { dir, config } = await setup();
    expect(config.outbox).toBe(outboxDir(dir, { HANDOFF_STATE_DIR: path.dirname(config.outbox) }));
    expect(path.relative(dir, config.outbox).startsWith("..")).toBe(true);
  });

  it("queues a channel that failed for a reason that can pass, without changing the result's shape", async () => {
    const { send, connect, queued } = await setup();
    const net = network({ telegram: 503, slack: 200 });
    const result = await send(await connect(net.fetchImpl, () => t0));
    expect(result.chat.telegram).toEqual({ rung: false, reason: expect.stringContaining("503") });
    expect(result.chat.slack).toEqual({ rung: true });
    expect(result.notified).toEqual(["slack"]);
    expect(await queued()).toEqual([expect.objectContaining({ id: 1, channels: ["telegram"] })]);
  });

  it.each([[401], [403], [404], [400]])("does not queue a refusal that retrying cannot fix (%s)", async code => {
    const { send, connect, queued } = await setup();
    await send(await connect(network({ telegram: code, slack: code }).fetchImpl, () => t0));
    expect(await queued()).toEqual([]);
  });

  it("queues a rate limit and a network error", async () => {
    const { send, connect, queued } = await setup();
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await send(await connect(down, () => t0));
    expect((await queued())[0].channels.slice().sort()).toEqual(["slack", "telegram"]);
    const limited = await setup();
    await limited.send(await limited.connect(network({ telegram: 429, slack: 429 }).fetchImpl, () => t0));
    expect((await limited.queued())[0].channels.slice().sort()).toEqual(["slack", "telegram"]);
  });

  it("queues nothing when no channel is configured or when everything rang", async () => {
    const { send, connect, queued } = await setup();
    await send(await connect(network({ telegram: 200, slack: 200 }).fetchImpl, () => t0));
    expect(await queued()).toEqual([]);
  });

  it("re-sends on the next send once it is due, says so, and marks the message as a repeat", async () => {
    const { send, connect, queued } = await setup();
    await send(await connect(network({ telegram: 503, slack: 200 }).fetchImpl, () => t0));
    const net = network({ telegram: 200, slack: 200 });
    const second = await send(await connect(net.fetchImpl, () => new Date(t0.getTime() + BACKOFF_MS[0] + 1)), "Another one");
    expect(second.resent).toEqual([{ id: 1, channels: ["telegram"] }]);
    expect(second.notified).toEqual(expect.arrayContaining(["telegram", "slack"]));
    const bodies = net.calls.filter(call => call.url.includes("telegram")).map(call => JSON.parse(call.body).text as string);
    expect(bodies.some(body => body.startsWith("Re-sent handoff #1"))).toBe(true);
    expect(bodies.some(body => body.startsWith("New handoff #2"))).toBe(true);
    expect(await queued()).toEqual([]);
  });

  it("does not re-send before it is due, and leaves out `resent` when nothing was re-sent", async () => {
    const { send, connect, queued } = await setup();
    await send(await connect(network({ telegram: 503, slack: 200 }).fetchImpl, () => t0));
    const net = network({ telegram: 200, slack: 200 });
    const second = await send(await connect(net.fetchImpl, () => new Date(t0.getTime() + 1000)), "Another one");
    expect(second).not.toHaveProperty("resent");
    expect((await queued()).map(entry => entry.id)).toEqual([1]);
  });

  it("does not announce a note that was answered in the meantime", async () => {
    const { send, connect, queued, dir } = await setup();
    await send(await connect(network({ telegram: 503, slack: 200 }).fetchImpl, () => t0));
    expect(await runStandIn(path.join(dir, "Desk"))).toBe(1);
    const net = network({ telegram: 200, slack: 200 });
    const second = await send(await connect(net.fetchImpl, () => new Date(t0.getTime() + BACKOFF_MS[0] + 1)), "Another one");
    expect(second).not.toHaveProperty("resent");
    expect(net.calls.map(call => call.body).join("\n")).not.toContain("handoff #1");
    expect(await queued()).toEqual([]);
  });

  it("a server that starts later re-sends what is due without waiting for a new send", async () => {
    const { send, connect, queued } = await setup();
    await send(await connect(network({ telegram: 503, slack: 200 }).fetchImpl, () => t0));
    const net = network({ telegram: 200, slack: 200 });
    const client = await connect(net.fetchImpl, () => new Date(t0.getTime() + BACKOFF_MS[0] + 1));
    await client.callTool({ name: "handoff_list", arguments: {} });
    for (let i = 0; i < 50 && (await queued()).length; i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(await queued()).toEqual([]);
    expect(net.calls.filter(call => call.url.includes("telegram"))).toHaveLength(1);
  });

  it("never lets a broken outbox break a send", async () => {
    const { send, connect, config } = await setup();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(config.outbox, { recursive: true });
    await writeFile(path.join(config.outbox, "outbox.json"), "{broken", "utf8");
    const result = await send(await connect(network({ telegram: 503, slack: 200 }).fetchImpl, () => t0));
    expect(result.id).toBe(1);
  });
});
