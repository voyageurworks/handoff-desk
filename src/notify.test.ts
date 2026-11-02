import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatText, loopbackEndpoint, ringChat, ringSlack, ringTelegram, slackText } from "./notify.js";
import { resolvePassword } from "./secret.js";

// Fake credentials are assembled at run time, so no secret scanner ever sees one in the source.
const token = `${"1".repeat(9)}:${"x".repeat(35)}`;
const hook = ["https://hooks.slack.com/", "services/", "T", "0".repeat(8), "/B", "0".repeat(8), "/", "y".repeat(24)].join("");
const item = {
  type: "question" as const,
  id: 3,
  title: "Book the dentist",
  path: path.join(os.tmpdir(), "somebody", "handoff", "Desk", "2026-11-02 Item 03 - Book the dentist.md"),
  request: "Friday at 3 please",
};

type Call = { url: string; init: RequestInit };
function recorder(response: () => Response | Promise<Response> = () => new Response("ok", { status: 200 })) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const node = (code: string) => `"${process.execPath}" -e "${code}"`;

describe("chatText", () => {
  it("names the item and the note, not the request, and never the absolute path", () => {
    const text = chatText(item, {});
    expect(text).toContain("#3");
    expect(text).toContain("question");
    expect(text).toContain("Book the dentist");
    expect(text).toContain("Desk/2026-11-02 Item 03 - Book the dentist.md");
    expect(text).not.toContain("somebody");
    expect(text).not.toContain("Friday at 3");
  });
  it("adds a cleaned, shortened request only when asked", () => {
    const long = `Line one\u0007\nline two ${"z".repeat(900)}`;
    const text = chatText({ ...item, request: long }, { includeRequest: true });
    expect(text).toContain("Line one line two");
    expect(text).not.toContain("\u0007");
    expect(text).not.toContain("z".repeat(501));
    expect(text.length).toBeLessThan(4096);
  });
});

describe("slackText", () => {
  it("escapes what Slack treats as a mention or a link", () => {
    expect(slackText("<!channel> <!here> <@U1> a & b")).toBe("&lt;!channel&gt; &lt;!here&gt; &lt;@U1&gt; a &amp; b");
  });
});

describe("ringTelegram", () => {
  it("posts plain text to the bot API and nothing else", async () => {
    const { calls, fetchImpl } = recorder();
    const result = await ringTelegram({ token, chatId: "12345" }, item, {}, fetchImpl);
    expect(result).toEqual({ rung: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("error");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ chat_id: "12345", text: chatText(item, {}), link_preview_options: { is_disabled: true } });
    expect(body).not.toHaveProperty("parse_mode");
  });
  it("accepts a channel name as the chat", async () => {
    const { calls, fetchImpl } = recorder();
    expect((await ringTelegram({ token, chatId: "@my_channel" }, item, {}, fetchImpl)).rung).toBe(true);
    expect(JSON.parse(String(calls[0].init.body)).chat_id).toBe("@my_channel");
  });
  it("reports the status code and never the token", async () => {
    const { fetchImpl } = recorder(() => new Response(`{"description":"bad ${token}"}`, { status: 401 }));
    const result = await ringTelegram({ token, chatId: "1" }, item, {}, fetchImpl);
    expect(result.rung).toBe(false);
    expect(result.reason).toContain("401");
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("never throws and never repeats the token when the network fails", async () => {
    const fetchImpl = (async () => { throw new TypeError(`fetch failed for https://api.telegram.org/bot${token}/sendMessage`); }) as typeof fetch;
    const result = await ringTelegram({ token, chatId: "1" }, item, {}, fetchImpl);
    expect(result.rung).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("says it timed out", async () => {
    const fetchImpl = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch;
    const result = await ringTelegram({ token, chatId: "1" }, item, {}, fetchImpl);
    expect(result).toMatchObject({ rung: false });
    expect(result.reason).toMatch(/did not answer/i);
  });
  it("refuses a value that is not a bot token or a chat, without any request", async () => {
    const { calls, fetchImpl } = recorder();
    expect((await ringTelegram({ token: "abc/def?x=1", chatId: "1" }, item, {}, fetchImpl)).reason).toMatch(/bot token/i);
    expect((await ringTelegram({ token: `${token}/../x`, chatId: "1" }, item, {}, fetchImpl)).rung).toBe(false);
    expect((await ringTelegram({ token, chatId: "one two" }, item, {}, fetchImpl)).reason).toMatch(/chat/i);
    expect(calls).toHaveLength(0);
  });
  it("reads the token from the user's own command", async () => {
    const { calls, fetchImpl } = recorder();
    const result = await ringTelegram({ tokenCommand: node(`process.stdout.write('${token}')`), chatId: "1" }, item, {}, fetchImpl);
    expect(result.rung).toBe(true);
    expect(calls[0].url).toContain(token);
  });
  it("explains what is missing", async () => {
    const { calls, fetchImpl } = recorder();
    expect((await ringTelegram({ chatId: "1" }, item, {}, fetchImpl)).reason).toMatch(/HANDOFF_TELEGRAM_BOT_TOKEN/);
    expect((await ringTelegram({ token }, item, {}, fetchImpl)).reason).toMatch(/HANDOFF_TELEGRAM_CHAT_ID/);
    expect(calls).toHaveLength(0);
  });
});

describe("ringSlack", () => {
  it("posts the escaped text to the incoming webhook", async () => {
    const { calls, fetchImpl } = recorder();
    const sneaky = { ...item, title: "<!channel> pay <@U1> & go" };
    const result = await ringSlack({ webhook: hook }, sneaky, {}, fetchImpl);
    expect(result).toEqual({ rung: true });
    expect(calls[0].url).toBe(hook);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("error");
    const text = JSON.parse(String(calls[0].init.body)).text as string;
    expect(text).toContain("&lt;!channel&gt;");
    expect(text).toContain("&lt;@U1&gt;");
    expect(text).not.toContain("<!channel>");
  });
  it("sends nothing anywhere but a Slack incoming webhook", async () => {
    const { calls, fetchImpl } = recorder();
    const bad = [
      "http://hooks.slack.com/services/T/B/x",
      "https://example.com/services/T/B/x",
      "https://hooks.slack.com.example.com/services/T/B/x",
      "https://user:pw@hooks.slack.com/services/T/B/x",
      "https://hooks.slack.com:8443/services/T/B/x",
      "https://hooks.slack.com/triggers/T/B/x",
      "not a url",
    ];
    for (const webhook of bad) {
      const result = await ringSlack({ webhook }, item, {}, fetchImpl);
      expect(result.rung, webhook).toBe(false);
      expect(result.reason, webhook).toMatch(/Slack incoming webhook/i);
      expect(JSON.stringify(result), webhook).not.toContain("pw@");
    }
    expect(calls).toHaveLength(0);
  });
  it("reports the status code and never the webhook", async () => {
    const { fetchImpl } = recorder(() => new Response(`no_service ${hook}`, { status: 404 }));
    const result = await ringSlack({ webhook: hook }, item, {}, fetchImpl);
    expect(result.rung).toBe(false);
    expect(result.reason).toContain("404");
    expect(JSON.stringify(result)).not.toContain(hook);
    const broken = (async () => { throw new Error(`could not reach ${hook}`); }) as typeof fetch;
    expect(JSON.stringify(await ringSlack({ webhook: hook }, item, {}, broken))).not.toContain(hook);
  });
  it("reads the webhook from the user's own command, and explains what is missing", async () => {
    const { fetchImpl } = recorder();
    expect((await ringSlack({ webhookCommand: node(`process.stdout.write('${hook}')`) }, item, {}, fetchImpl)).rung).toBe(true);
    expect((await ringSlack({}, item, {}, fetchImpl)).reason).toMatch(/HANDOFF_SLACK_WEBHOOK_URL/);
  });
});

describe("ringChat", () => {
  it("returns nothing when no channel is configured", async () => {
    const { calls, fetchImpl } = recorder();
    expect(await ringChat({}, item, {}, fetchImpl)).toEqual({});
    expect(calls).toHaveLength(0);
  });
  it("rings only the configured channels, and one failing does not affect the other", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("ok", { status: 200 }));
    const both = await ringChat({ telegram: { token, chatId: "1" }, slack: { webhook: hook } }, item, {}, fetchImpl);
    expect(both).toEqual({ telegram: { rung: true }, slack: { rung: true } });
    expect(calls).toHaveLength(2);
    const onlySlack = await ringChat({ slack: { webhook: hook } }, item, {}, fetchImpl);
    expect(Object.keys(onlySlack)).toEqual(["slack"]);
    const mixed = await ringChat({ telegram: { token, chatId: "1" }, slack: { webhook: "https://example.com/x" } }, item, {}, fetchImpl);
    expect(mixed.telegram?.rung).toBe(true);
    expect(mixed.slack?.rung).toBe(false);
  });
  it("includes the request only when the setting says so", async () => {
    const { calls, fetchImpl } = recorder();
    await ringChat({ slack: { webhook: hook }, includeRequest: true }, item, {}, fetchImpl);
    expect(JSON.parse(String(calls[0].init.body)).text).toContain("Friday at 3 please");
  });
});

describe("resolvePassword names the right setting", () => {
  it("defaults to the mail setting and names the chat setting when told to", async () => {
    const failing = node("process.exit(2)");
    expect((await resolvePassword({ passCommand: failing })).reason).toContain("HANDOFF_MAIL_PASSWORD_COMMAND");
    expect((await resolvePassword({ passCommand: failing }, 5000, "HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND")).reason).toContain("HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND");
  });
});

describe("the loopback test endpoint", () => {
  const item = { id: 7, type: "errand", title: "Book dentist", request: "Friday", path: "/home/me/handoff/Desk/0007 - book-dentist.md" } as Parameters<typeof ringTelegram>[1];
  const fakeToken = `${"3".repeat(9)}:${"k".repeat(35)}`;
  const fakeHook = ["https://hooks.slack.com/", "services/", "T", "2".repeat(8), "/B", "2".repeat(8), "/", "y".repeat(24)].join("");
  const recorder = () => {
    const urls: string[] = [];
    return { urls, fetchImpl: (async (url: string | URL) => { urls.push(String(url)); return new Response("ok"); }) as typeof fetch };
  };

  it.each([
    ["http://127.0.0.1:8123", "http://127.0.0.1:8123"],
    ["http://localhost:9", "http://localhost:9"],
    ["http://[::1]:65535", "http://[::1]:65535"],
    ["http://127.0.0.1:8123/", "http://127.0.0.1:8123"],
  ])("accepts %s", (value, expected) => {
    expect(loopbackEndpoint(value)).toBe(expected);
  });

  it.each([
    "https://127.0.0.1:8123", "http://127.0.0.1", "http://example.com:8123", "http://127.0.0.1.example.com:8123", "http://0.0.0.0:8123",
    "http://127.0.0.2:8123", "http://user:pw@127.0.0.1:8123", "http://127.0.0.1:8123/path", "http://127.0.0.1:8123/?x=1", "http://127.0.0.1:8123/#x",
    "http://127.0.0.1:0", "http://127.0.0.1:99999", "ftp://127.0.0.1:8123", "127.0.0.1:8123", "", "not a url",
  ])("ignores %j", value => {
    expect(loopbackEndpoint(value)).toBeNull();
  });

  it("sends Telegram to the endpoint, with the same path and body as the real service", async () => {
    const { urls, fetchImpl } = recorder();
    const result = await ringTelegram({ token: fakeToken, chatId: "42" }, item, { endpoint: "http://127.0.0.1:8123" }, fetchImpl);
    expect(result).toEqual({ rung: true });
    expect(urls).toEqual([`http://127.0.0.1:8123/bot${fakeToken}/sendMessage`]);
  });

  it("sends Slack to /slack on the endpoint, but only after the webhook itself validated", async () => {
    const { urls, fetchImpl } = recorder();
    expect(await ringSlack({ webhook: fakeHook }, item, { endpoint: "http://127.0.0.1:8123" }, fetchImpl)).toEqual({ rung: true });
    expect(urls).toEqual(["http://127.0.0.1:8123/slack"]);
    const refused = recorder();
    const result = await ringSlack({ webhook: "https://example.com/services/x" }, item, { endpoint: "http://127.0.0.1:8123" }, refused.fetchImpl);
    expect(result.rung).toBe(false);
    expect(refused.urls).toEqual([]);
  });

  it("still refuses a bad token or chat id when an endpoint is set", async () => {
    const { urls, fetchImpl } = recorder();
    expect((await ringTelegram({ token: "nope", chatId: "42" }, item, { endpoint: "http://127.0.0.1:8123" }, fetchImpl)).rung).toBe(false);
    expect((await ringTelegram({ token: fakeToken, chatId: "x y" }, item, { endpoint: "http://127.0.0.1:8123" }, fetchImpl)).rung).toBe(false);
    expect(urls).toEqual([]);
  });

  it("never uses a remote or https endpoint even if one reaches the senders: the real service is used", async () => {
    const { urls, fetchImpl } = recorder();
    await ringTelegram({ token: fakeToken, chatId: "42" }, item, { endpoint: "https://evil.example:443" }, fetchImpl);
    await ringSlack({ webhook: fakeHook }, item, { endpoint: "http://evil.example:80" }, fetchImpl);
    expect(urls).toEqual([`https://api.telegram.org/bot${fakeToken}/sendMessage`, fakeHook]);
  });

  it("ringChat passes the configured endpoint to both channels", async () => {
    const { urls, fetchImpl } = recorder();
    await ringChat({ telegram: { token: fakeToken, chatId: "42" }, slack: { webhook: fakeHook }, testEndpoint: "http://localhost:8123" }, item, {}, fetchImpl);
    expect(urls.sort()).toEqual([`http://localhost:8123/bot${fakeToken}/sendMessage`, "http://localhost:8123/slack"].sort());
  });
});
