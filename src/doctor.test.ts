import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDoctor, runDoctor, type Check } from "./doctor.js";
import { initDesk } from "./init.js";
import { enqueue, outboxDir } from "./outbox.js";
import { ensureBuilt } from "./testBuild.js";

// Fake secrets are assembled at run time, so no secret scanner ever sees one in the source.
const token = `${"7".repeat(9)}:${"d".repeat(35)}`;
const hookTail = ["T", "5".repeat(8), "/B", "5".repeat(8), "/", "u".repeat(24)].join("");
const hook = `https://hooks.slack.com/services/${hookTail}`;
const mailPassword = `pw-${"m".repeat(16)}`;

const fresh = async (init = true) => {
  const dir = await mkdtemp(path.join(tmpdir(), "handoff doctor-"));
  if (init) await initDesk(dir);
  const state = await mkdtemp(path.join(tmpdir(), "handoff doctor state-"));
  return { dir, state };
};
const by = (checks: Check[], name: string) => checks.find(check => check.name === name)!;
const base = (dir: string, state: string, extra: Record<string, string> = {}) => ({ HANDOFF_DIR: dir, HANDOFF_STATE_DIR: state, HANDOFF_SYNC: "off", ...extra });

describe("the checks", () => {
  it("with nothing configured: ok on the basics, a warning that no doorbell will tell the agent, and exit 0", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: base(dir, state) });
    expect(by(result.checks, "Node").status).toBe("ok");
    expect(by(result.checks, "Desk folder").status).toBe("ok");
    expect(by(result.checks, "Doorbells").status).toBe("warn");
    expect(result.code).toBe(0);
  });
  it("warns that handoff.md is still the template, and that a missing desk is created on first use", async () => {
    const { dir, state } = await fresh();
    expect(by((await runDoctor({ env: base(dir, state) })).checks, "handoff.md").status).toBe("warn");
    const missing = await runDoctor({ env: base(path.join(dir, "nope"), state) });
    expect(by(missing.checks, "Desk folder").status).toBe("warn");
    expect(by(missing.checks, "Desk folder").detail).toMatch(/init/);
  });
  it("fails on an old Node", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: base(dir, state), nodeVersion: "v20.11.0" });
    expect(by(result.checks, "Node").status).toBe("fail");
    expect(result.code).toBe(1);
  });
  it("email: names what is missing when half is set, ok when complete", async () => {
    const { dir, state } = await fresh();
    const partial = await runDoctor({ env: base(dir, state, { HANDOFF_MAIL_USER: "me@example.com" }) });
    expect(by(partial.checks, "Email doorbell").status).toBe("warn");
    expect(by(partial.checks, "Email doorbell").detail).toMatch(/HANDOFF_MAIL_TO/);
    expect(by(partial.checks, "Email doorbell").detail).toMatch(/HANDOFF_MAIL_APP_PASSWORD/);
    const full = await runDoctor({ env: base(dir, state, { HANDOFF_MAIL_USER: "me@example.com", HANDOFF_MAIL_TO: "me@example.com", HANDOFF_MAIL_APP_PASSWORD: mailPassword }) });
    expect(by(full.checks, "Email doorbell").status).toBe("ok");
  });
  it("Telegram: a bad token shape or chat id fails; a command is reported as set but not run", async () => {
    const { dir, state } = await fresh();
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: "nope", HANDOFF_TELEGRAM_CHAT_ID: "42" }) })).checks, "Telegram").status).toBe("fail");
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "x y" }) })).checks, "Telegram").status).toBe("fail");
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token }) })).checks, "Telegram").detail).toMatch(/HANDOFF_TELEGRAM_CHAT_ID/);
    const command = by((await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND: "get-token", HANDOFF_TELEGRAM_CHAT_ID: "42" }) })).checks, "Telegram");
    expect(command.status).toBe("ok");
    expect(command.detail).toMatch(/not run/);
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42" }) })).checks, "Telegram").status).toBe("ok");
  });
  it("Slack: only a Slack incoming webhook passes", async () => {
    const { dir, state } = await fresh();
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_SLACK_WEBHOOK_URL: "https://example.com/services/x" }) })).checks, "Slack").status).toBe("fail");
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_SLACK_WEBHOOK_URL: hook }) })).checks, "Slack").status).toBe("ok");
    expect(by((await runDoctor({ env: base(dir, state, { HANDOFF_SLACK_WEBHOOK_COMMAND: "get-hook" }) })).checks, "Slack").detail).toMatch(/not run/);
  });
  it("shows waiting retries, and a warning when the chat doorbells point at a test program", async () => {
    const { dir, state } = await fresh();
    const env = base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_CHAT_TEST_ENDPOINT: "http://127.0.0.1:9" });
    await enqueue(outboxDir(dir, env), 3, ["telegram"]);
    const result = await runDoctor({ env });
    expect(by(result.checks, "Retry list").status).toBe("warn");
    expect(by(result.checks, "Retry list").detail).toMatch(/1/);
    expect(by(result.checks, "Test endpoint").status).toBe("warn");
  });
});

describe("secrets", () => {
  it("never appear in the checks or the printed report, whatever is set", async () => {
    const { dir, state } = await fresh();
    const env = base(dir, state, {
      HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: hook,
      HANDOFF_MAIL_USER: "me@example.com", HANDOFF_MAIL_TO: "me@example.com", HANDOFF_MAIL_APP_PASSWORD: mailPassword,
    });
    const result = await runDoctor({ env });
    const everything = `${JSON.stringify(result.checks)}\n${formatDoctor(result)}`;
    for (const secret of [token, hookTail, mailPassword, token.split(":")[1]]) expect(everything).not.toContain(secret);
  });
  it("also not when a check fails because of them", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: `${token}!!`, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: `${hook}?x=1 y` }) });
    const everything = `${JSON.stringify(result.checks)}\n${formatDoctor(result)}`;
    expect(everything).not.toContain(token.split(":")[1]);
    expect(everything).not.toContain(hookTail);
  });
});

describe("--ping", () => {
  const calls = () => {
    const seen: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => { seen.push({ url: String(url), body: String(init?.body ?? "") }); return new Response("ok", { status: 200 }); }) as typeof fetch;
    return { seen, fetchImpl };
  };
  it("sends nothing unless asked", async () => {
    const { dir, state } = await fresh();
    const { seen, fetchImpl } = calls();
    await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: hook }), fetchImpl });
    expect(seen).toEqual([]);
  });
  it("sends one clearly labelled test message per configured chat channel, and reports each", async () => {
    const { dir, state } = await fresh();
    const { seen, fetchImpl } = calls();
    const result = await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42", HANDOFF_SLACK_WEBHOOK_URL: hook }), ping: true, fetchImpl });
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.body).toMatch(/doctor test/i);
      expect(call.body).not.toMatch(/New handoff|## Reply/);
    }
    expect(by(result.checks, "Test message: Telegram").status).toBe("ok");
    expect(by(result.checks, "Test message: Slack").status).toBe("ok");
    expect(result.code).toBe(0);
  });
  it("a service that refuses makes a failure with the reason, and exit 1", async () => {
    const { dir, state } = await fresh();
    const fetchImpl = (async () => new Response("no", { status: 401 })) as typeof fetch;
    const result = await runDoctor({ env: base(dir, state, { HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42" }), ping: true, fetchImpl });
    expect(by(result.checks, "Test message: Telegram").status).toBe("fail");
    expect(by(result.checks, "Test message: Telegram").detail).toMatch(/401/);
    expect(result.code).toBe(1);
  });
  it("does not ring the email doorbell (a test mail could be mistaken for a request)", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: base(dir, state, { HANDOFF_MAIL_USER: "me@example.com", HANDOFF_MAIL_TO: "me@example.com", HANDOFF_MAIL_APP_PASSWORD: mailPassword }), ping: true });
    expect(result.checks.some(check => /Test message: Email/.test(check.name))).toBe(false);
  });
});

describe("--client", () => {
  const withClient = async (content?: object) => {
    const home = await mkdtemp(path.join(tmpdir(), "handoff doctor home-"));
    if (content) {
      await mkdir(path.join(home, ".cursor"), { recursive: true });
      await writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify(content), "utf8");
    }
    return home;
  };
  it("reads the handoff entry's env from the client's own file, as the server would see it", async () => {
    const { dir, state } = await fresh();
    const home = await withClient({ mcpServers: { handoff: { command: "npx", env: { HANDOFF_DIR: dir, HANDOFF_STATE_DIR: state, HANDOFF_SYNC: "off", HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42" } } } });
    const result = await runDoctor({ env: {}, client: "cursor", home });
    expect(by(result.checks, "Settings from").detail).toMatch(/Cursor/);
    expect(by(result.checks, "Telegram").status).toBe("ok");
    expect(`${JSON.stringify(result.checks)}${formatDoctor(result)}`).not.toContain(token.split(":")[1]);
  });
  it("fails clearly when the file or the entry is missing, and for a client it cannot read", async () => {
    const { dir, state } = await fresh();
    const none = await runDoctor({ env: base(dir, state), client: "cursor", home: await withClient() });
    expect(by(none.checks, "Settings from").status).toBe("fail");
    const noEntry = await runDoctor({ env: base(dir, state), client: "cursor", home: await withClient({ mcpServers: {} }) });
    expect(by(noEntry.checks, "Settings from").status).toBe("fail");
    const other = await runDoctor({ env: base(dir, state), client: "zed", home: await withClient() });
    expect(by(other.checks, "Settings from").status).toBe("fail");
    expect(other.code).toBe(1);
  });
});

describe("the doctor command in the built program", () => {
  it("prints a report, exits 0 with warnings only and 1 with a failure, and never echoes a secret", async () => {
    const entry = await ensureBuilt();
    const { dir, state } = await fresh();
    const run = (extra: Record<string, string>) => spawnSync(process.execPath, [entry, "doctor"], { encoding: "utf8", env: { ...process.env, ...base(dir, state), ...extra } });
    const good = run({ HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "42" });
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("handoff-desk doctor");
    expect(good.stdout + good.stderr).not.toContain(token.split(":")[1]);
    const bad = run({ HANDOFF_TELEGRAM_BOT_TOKEN: token, HANDOFF_TELEGRAM_CHAT_ID: "not a chat" });
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).not.toContain(token.split(":")[1]);
  }, 180_000);
});

describe("the new checks", () => {
  it("lists an ignored setting as a warning", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: base(dir, state, { HANDOFF_SMTP_PORT: "mail" }) });
    expect(by(result.checks, "Setting").status).toBe("warn");
    expect(by(result.checks, "Setting").detail).toMatch(/HANDOFF_SMTP_PORT/);
  });
  it("says what the server will do with a desk that is not a git work tree", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: { HANDOFF_DIR: dir, HANDOFF_STATE_DIR: state, HANDOFF_SYNC: "auto" } });
    expect(by(result.checks, "Desk sync").status).toBe("info");
    expect(by(result.checks, "Desk sync").detail).toMatch(/plain local folder/);
  });
  it("HANDOFF_SYNC=git on a plain folder is a failure that says why", async () => {
    const { dir, state } = await fresh();
    const result = await runDoctor({ env: { HANDOFF_DIR: dir, HANDOFF_STATE_DIR: state, HANDOFF_SYNC: "git" } });
    expect(by(result.checks, "Desk sync").status).toBe("fail");
    expect(result.code).toBe(1);
  });
});
