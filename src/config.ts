import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import type { DoorbellConfig } from "./doorbell.js";
import { loopbackEndpoint, type ChatConfig } from "./notify.js";
import type { Identity } from "./sync.js";

export type SyncMode = "auto" | "git" | "off";
export type HandoffConfig = {
  dir: string;
  desk: { deskDir: string };
  doorbell: DoorbellConfig;
  /** Optional Telegram and Slack doorbells (see notify.ts). Empty unless their settings are set. */
  chat: ChatConfig;
  mailDir: string;
  /** Folder (inside `dir`) where the agent leaves notes for Claude. */
  inboxDir: string;
  /** auto: sync through git when `dir` is a work tree with an upstream. git: required. off: local folder only. */
  sync: SyncMode;
  /** Clone this repository into `dir` on first use (a cloud session). */
  remote?: string;
  /** Commit identity for the desk's commits; otherwise the repository's own git config. */
  identity?: Identity;
  /** Subject prefix of the doorbell email: `[<prefix> errand #3] ...`. */
  prefix: string;
  /** Time zone for note and email dates (HANDOFF_TZ); otherwise the system zone. */
  tz?: string;
};

/** A leading "~" means the home folder. Shells like PowerShell and cmd, and JSON client configs, do not expand it themselves. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~" + String.fromCharCode(92))) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Settings from the file named by HANDOFF_ENV_FILE, so a mail password need not sit in the MCP client's own config. Real environment values win. */
function withEnvFile(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.HANDOFF_ENV_FILE) return env;
  const file = expandHome(env.HANDOFF_ENV_FILE);
  try {
    return { ...parseEnv(readFileSync(file, "utf8")), ...env };
  } catch {
    // A missing or unreadable file is no reason to fail the server; the settings are simply absent. The path (never its
    // contents) goes to stderr so a typo isn't mistaken for "mail not configured". stdout belongs to the MCP protocol.
    console.error(`handoff-desk: could not read HANDOFF_ENV_FILE ${file}`);
    return env;
  }
}

/** The environment sync detection reads: the real one plus the sync mode and any git identity that came from the settings file. */
export function syncEnv(config: HandoffConfig, base: NodeJS.ProcessEnv = process.env, mode: SyncMode = config.sync): NodeJS.ProcessEnv {
  return { ...base, HANDOFF_SYNC: mode, ...(config.identity ? { HANDOFF_GIT_NAME: config.identity.name, HANDOFF_GIT_EMAIL: config.identity.email } : {}) };
}

/** The loopback-only test destination for the chat doorbells; a value that is not one is ignored with a warning that never repeats it. */
function testEndpoint(value: string | undefined): { testEndpoint?: string } {
  if (!value) return {};
  const endpoint = loopbackEndpoint(value);
  if (!endpoint) console.error("handoff-desk: HANDOFF_CHAT_TEST_ENDPOINT ignored; only http://127.0.0.1:<port>, http://localhost:<port> or http://[::1]:<port> is accepted.");
  return endpoint ? { testEndpoint: endpoint } : {};
}

/** Settings come from the environment (set in the MCP client's config) and, if HANDOFF_ENV_FILE names one, a private file. Nothing is printed, so stdout stays clean. */
export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): HandoffConfig {
  const env = withEnvFile(rawEnv);
  const dir = env.HANDOFF_DIR ? expandHome(env.HANDOFF_DIR) : path.join(os.homedir(), "handoff");
  const port = env.HANDOFF_SMTP_PORT ? Number(env.HANDOFF_SMTP_PORT) : undefined;
  const mode = (env.HANDOFF_SYNC || "auto").toLowerCase();
  return {
    dir,
    desk: { deskDir: path.join(dir, "Desk") },
    doorbell: { user: env.HANDOFF_MAIL_USER, pass: env.HANDOFF_MAIL_APP_PASSWORD, passCommand: env.HANDOFF_MAIL_PASSWORD_COMMAND, to: env.HANDOFF_MAIL_TO, host: env.HANDOFF_SMTP_HOST, port: Number.isInteger(port) ? port : undefined },
    chat: {
      ...(env.HANDOFF_TELEGRAM_BOT_TOKEN || env.HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND || env.HANDOFF_TELEGRAM_CHAT_ID ? { telegram: { token: env.HANDOFF_TELEGRAM_BOT_TOKEN, tokenCommand: env.HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND, chatId: env.HANDOFF_TELEGRAM_CHAT_ID } } : {}),
      ...(env.HANDOFF_SLACK_WEBHOOK_URL || env.HANDOFF_SLACK_WEBHOOK_COMMAND ? { slack: { webhook: env.HANDOFF_SLACK_WEBHOOK_URL, webhookCommand: env.HANDOFF_SLACK_WEBHOOK_COMMAND } } : {}),
      includeRequest: ["1", "true", "yes", "on"].includes((env.HANDOFF_NOTIFY_INCLUDE_REQUEST ?? "").toLowerCase()),
      ...testEndpoint(env.HANDOFF_CHAT_TEST_ENDPOINT),
    },
    mailDir: env.HANDOFF_MAIL_DIR ? expandHome(env.HANDOFF_MAIL_DIR) : path.join(dir, "mail"),
    inboxDir: env.HANDOFF_INBOX_DIR || "Inbox",
    sync: mode === "git" || mode === "off" ? mode : "auto",
    remote: env.HANDOFF_REMOTE || undefined,
    identity: env.HANDOFF_GIT_NAME && env.HANDOFF_GIT_EMAIL ? { name: env.HANDOFF_GIT_NAME, email: env.HANDOFF_GIT_EMAIL } : undefined,
    prefix: env.HANDOFF_SUBJECT_PREFIX || "Handoff",
    tz: env.HANDOFF_TZ || undefined,
  };
}
