import { execFile } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { capabilitiesIn } from "./capabilities.js";
import { CLIENTS } from "./clientConfig.js";
import { loadConfig, syncEnv } from "./config.js";
import { clientEnv } from "./install.js";
import { ringSlack, ringTelegram, validSlackWebhook, validTelegramChat, validTelegramToken } from "./notify.js";
import { pendingCount } from "./outbox.js";
import { detectSync } from "./sync.js";

/**
 * `handoff-desk doctor`: checks the setup and says what to fix. It reads settings the way the server does (and, with
 * --client, from the client's own settings file, because a terminal does not have the settings the client passes).
 * It never prints a secret, only the name of a setting; a *_COMMAND setting is reported as "set" and not run; and it
 * sends nothing unless --ping is given, and then only a clearly labelled test message to Telegram and Slack, never email
 * (a test mail could be taken for a request by the agent that reads the mailbox).
 */
export type Check = { name: string; status: "ok" | "warn" | "fail" | "info"; detail: string };
export type DoctorOptions = {
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  ping?: boolean;
  fetchImpl?: typeof fetch;
  /** Read the handoff entry's env from this client's settings file instead of `env`. */
  client?: string;
  home?: string;
};
export type DoctorResult = { checks: Check[]; code: number };

const MIN_NODE = 22;
const run = promisify(execFile);

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) => void checks.push({ name, status, detail });

  const major = Number((options.nodeVersion ?? process.version).replace(/^v/, "").split(".")[0]);
  add("Node", major >= MIN_NODE ? "ok" : "fail", major >= MIN_NODE ? options.nodeVersion ?? process.version : `${options.nodeVersion ?? process.version} is too old; handoff-desk needs Node ${MIN_NODE} or newer.`);

  let env = options.env ?? process.env;
  let source = "this terminal's environment";
  if (options.client) {
    const found = await clientEnv(options.client, options.home ?? os.homedir());
    const name = CLIENTS.find(client => client.id === options.client)?.name ?? options.client;
    if (!found.env) {
      add("Settings from", "fail", found.reason);
      return finish(checks);
    }
    env = found.env;
    source = `${name}'s settings file (its handoff entry)`;
  }
  if (env.HANDOFF_ENV_FILE) source += ", and the file named by HANDOFF_ENV_FILE";
  add("Settings from", "info", source);
  const config = loadConfig(env);

  const folder = await stat(config.dir).catch(() => null);
  if (!folder) add("Desk folder", "warn", `${config.dir} does not exist yet; handoff-desk init creates it (the server also creates it on first use).`);
  else if (!folder.isDirectory()) add("Desk folder", "fail", `${config.dir} is not a folder.`);
  else if (await access(config.dir, constants.W_OK).then(() => false, () => true)) add("Desk folder", "fail", `${config.dir} is not writable.`);
  else add("Desk folder", "ok", config.dir);

  if (folder?.isDirectory()) {
    const capabilities = await capabilitiesIn(config.dir).catch(() => null);
    if (!capabilities) add("handoff.md", "warn", "Missing or unreadable; handoff-desk init creates a template to edit.");
    else if (capabilities.unedited) add("handoff.md", "warn", "Still the template; fill it in so the agent knows what it may do alone.");
    else add("handoff.md", "ok", "Edited.");
  }

  if (config.sync === "off") {
    add("Git sync", "info", "Off: the desk is a plain local folder.");
  } else {
    const git = await run("git", ["--version"]).then(result => result.stdout.trim(), () => null);
    if (git) {
      add("Git sync", "ok", `${git}; sync is ${config.sync}.`);
      // What the server will actually do with this folder, so a desk that was meant to sync is not found out to be local-only later.
      if (folder?.isDirectory() && !config.remote) {
        const found = await detectSync(config.dir, syncEnv(config, env)).catch(error => error as Error);
        if (found instanceof Error) add("Desk sync", "fail", found.message);
        else if (found) add("Desk sync", "ok", "The desk is a git work tree with an upstream: notes are committed and pushed.");
        else add("Desk sync", "info", "The desk is a plain local folder (not a git work tree with an upstream branch). Fine for an agent on this computer; a cloud agent needs a private git repository (docs/cloud-agents.md).");
      }
    } else add("Git sync", config.sync === "git" ? "fail" : "warn", "git was not found, so the desk cannot sync.");
  }

  for (const warning of config.warnings) add("Setting", "warn", warning);

  const mail = config.doorbell;
  const mailParts = [mail.user, mail.pass, mail.passCommand, mail.to];
  if (!mailParts.some(Boolean)) {
    add("Email doorbell", "info", "Not set (optional).");
  } else {
    const missing = [!mail.user && "HANDOFF_MAIL_USER", !mail.pass && !mail.passCommand && "HANDOFF_MAIL_APP_PASSWORD or HANDOFF_MAIL_PASSWORD_COMMAND", !mail.to && "HANDOFF_MAIL_TO"].filter(Boolean);
    add("Email doorbell", missing.length ? "warn" : "ok", missing.length ? `Incomplete, missing ${missing.join(", ")}.` : `Set${mail.passCommand && !mail.pass ? " (password command not run)" : ""}.`);
  }

  const t = config.chat.telegram;
  if (!t) {
    add("Telegram", "info", "Not set (optional).");
  } else {
    const missing = [!t.token && !t.tokenCommand && "HANDOFF_TELEGRAM_BOT_TOKEN (or HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND)", !t.chatId && "HANDOFF_TELEGRAM_CHAT_ID"].filter(Boolean);
    if (missing.length) add("Telegram", "warn", `Incomplete, missing ${missing.join(" and ")}.`);
    else if (t.token && !validTelegramToken(t.token)) add("Telegram", "fail", "HANDOFF_TELEGRAM_BOT_TOKEN does not look like a bot token (expected 123456789:ABC...).");
    else if (t.chatId && !validTelegramChat(t.chatId)) add("Telegram", "fail", "HANDOFF_TELEGRAM_CHAT_ID must be a number (a group id starts with -) or a public @channel name.");
    else add("Telegram", "ok", t.token ? "Set." : "Set (token command not run).");
  }

  const s = config.chat.slack;
  if (!s) add("Slack", "info", "Not set (optional).");
  else if (s.webhook && !validSlackWebhook(s.webhook)) add("Slack", "fail", "HANDOFF_SLACK_WEBHOOK_URL must be a Slack incoming webhook (https://hooks.slack.com/services/...).");
  else add("Slack", "ok", s.webhook ? "Set." : "Set (webhook command not run).");

  const any = mailParts.some(Boolean) || Boolean(t) || Boolean(s);
  add("Doorbells", any ? "info" : "warn", any ? "At least one is set." : "None set: nothing tells the agent a note is waiting, so it only sees notes when it looks at the desk.");

  const waiting = await pendingCount(config.outbox);
  add("Retry list", waiting ? "warn" : "ok", waiting ? `${waiting} chat doorbell(s) did not go through and will be re-sent.` : "Nothing waiting.");
  if (config.chat.testEndpoint) add("Test endpoint", "warn", "Telegram and Slack are pointed at a program on this computer (HANDOFF_CHAT_TEST_ENDPOINT); nothing reaches the real services.");

  if (options.ping) {
    const item = { type: "status" as const, id: 0, title: "doctor test", path: "Desk/doctor-test.md", request: "doctor test" };
    const settings = { test: true, endpoint: config.chat.testEndpoint };
    if (t && !checks.some(check => check.name === "Telegram" && check.status === "fail")) {
      const result = await ringTelegram(t, item, settings, options.fetchImpl);
      add("Test message: Telegram", result.rung ? "ok" : "fail", result.rung ? "Sent; look for it in the chat." : result.reason ?? "Not sent.");
    }
    if (s && !checks.some(check => check.name === "Slack" && check.status === "fail")) {
      const result = await ringSlack(s, item, settings, options.fetchImpl);
      add("Test message: Slack", result.rung ? "ok" : "fail", result.rung ? "Sent; look for it in the channel." : result.reason ?? "Not sent.");
    }
  }
  return finish(checks);
}

const finish = (checks: Check[]): DoctorResult => ({ checks, code: checks.some(check => check.status === "fail") ? 1 : 0 });

export function formatDoctor(result: DoctorResult): string {
  const width = Math.max(...result.checks.map(check => check.name.length));
  const lines = result.checks.map(check => `  [${check.status.padEnd(4)}] ${check.name.padEnd(width)}  ${check.detail}`);
  const count = (status: Check["status"]) => result.checks.filter(check => check.status === status).length;
  return `handoff-desk doctor\n${lines.join("\n")}\n${count("fail")} problem(s), ${count("warn")} warning(s).`;
}
