import path from "node:path";
import type { DoorbellResult, RingItem } from "./doorbell.js";
import { resolvePassword } from "./secret.js";

/**
 * Optional chat doorbells, next to the email one: a short message to Telegram (a bot) and/or Slack (an incoming webhook)
 * when a note is created. Outgoing only; the agent still answers in the note. Every secret (bot token, webhook URL) comes from
 * the environment or the user's own command and is never written to a result, an error or a log.
 */
export type ChatConfig = {
  telegram?: { token?: string; tokenCommand?: string; chatId?: string };
  slack?: { webhook?: string; webhookCommand?: string };
  /** Add a shortened copy of the request to the chat message. Off by default: chat services are third parties. */
  includeRequest?: boolean;
};
export type ChatOptions = { includeRequest?: boolean };
export type ChatResult = { telegram?: DoorbellResult; slack?: DoorbellResult };

/** Time allowed for each chat service to answer. */
export const CHAT_STEP_MS = 10_000;
/** Telegram refuses a message longer than this many characters. */
const TELEGRAM_MAX = 4096;
/** How much of the request goes into the message when the setting asks for it. */
const REQUEST_MAX = 500;

const clean = (text: string) => text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The message. It names the item and the note (relative to the desk folder, so the computer's user name never leaves) and
 * says what to do; the request itself is added only when asked for.
 */
export function chatText(item: RingItem, options: ChatOptions = {}): string {
  const lines = [`New handoff #${item.id} (${item.type}): ${clean(item.title).slice(0, 120)}`, `Note: Desk/${clean(path.basename(item.path))}`];
  if (options.includeRequest) lines.push("", clean(item.request).slice(0, REQUEST_MAX));
  lines.push("", 'Answer under "## Reply" and set status to done.');
  return lines.join("\n").slice(0, TELEGRAM_MAX);
}

/** Slack turns <!channel>, <@U123> and <https://...|text> into pings and links; the three characters it asks to escape are escaped. */
export function slackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const timedOut = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** A real bot token looks like 123456789:AA... ; anything with other characters could change the API path. */
const TOKEN = /^\d{3,20}:[A-Za-z0-9_-]{16,80}$/;
/** A numeric chat id (groups and channels are negative) or a public channel name. */
const CHAT = /^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/;

export async function ringTelegram(config: NonNullable<ChatConfig["telegram"]>, item: RingItem, options: ChatOptions = {}, fetchImpl: typeof fetch = fetch): Promise<DoorbellResult> {
  if (!config.token && !config.tokenCommand) return { rung: false, reason: "Telegram doorbell not configured (set HANDOFF_TELEGRAM_BOT_TOKEN or HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND)." };
  if (!config.chatId) return { rung: false, reason: "No Telegram chat for the doorbell (set HANDOFF_TELEGRAM_CHAT_ID)." };
  if (!CHAT.test(config.chatId)) return { rung: false, reason: "HANDOFF_TELEGRAM_CHAT_ID must be a number (a group id starts with -) or a public @channel name." };
  const { pass: token, reason } = await resolvePassword({ pass: config.token, passCommand: config.tokenCommand }, undefined, "HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND");
  if (!token) return { rung: false, reason: reason ?? "No Telegram bot token." };
  if (!TOKEN.test(token)) return { rung: false, reason: "The Telegram bot token does not look like a bot token (expected 123456789:ABC...)." };
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text: chatText(item, options), link_preview_options: { is_disabled: true } }),
      redirect: "error",
      signal: AbortSignal.timeout(CHAT_STEP_MS),
    });
    return response.ok ? { rung: true } : { rung: false, reason: `Telegram answered ${response.status}, so the doorbell was not sent (check the bot token and that the bot may write to the chat).` };
  } catch (error) {
    // Never the error's own text: it can carry the request address, and the token is part of it.
    return { rung: false, reason: timedOut(error) ? `Telegram did not answer within ${Math.round(CHAT_STEP_MS / 1000)} seconds, so the doorbell was not sent.` : "Could not reach Telegram, so the doorbell was not sent." };
  }
}

/** Only a Slack incoming webhook: https, exactly hooks.slack.com, no credentials, no port, a /services/ path. Parsed, not prefix-matched. */
function slackWebhook(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || url.username || url.password || url.port) return null;
    return url.pathname.startsWith("/services/") ? url.href : null;
  } catch {
    return null;
  }
}

export async function ringSlack(config: NonNullable<ChatConfig["slack"]>, item: RingItem, options: ChatOptions = {}, fetchImpl: typeof fetch = fetch): Promise<DoorbellResult> {
  if (!config.webhook && !config.webhookCommand) return { rung: false, reason: "Slack doorbell not configured (set HANDOFF_SLACK_WEBHOOK_URL or HANDOFF_SLACK_WEBHOOK_COMMAND)." };
  const { pass: value, reason } = await resolvePassword({ pass: config.webhook, passCommand: config.webhookCommand }, undefined, "HANDOFF_SLACK_WEBHOOK_COMMAND");
  if (!value) return { rung: false, reason: reason ?? "No Slack webhook." };
  const webhook = slackWebhook(value);
  if (!webhook) return { rung: false, reason: "The Slack setting must be a Slack incoming webhook (https://hooks.slack.com/services/...); nothing was sent." };
  try {
    const response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: slackText(chatText(item, options)) }),
      redirect: "error",
      signal: AbortSignal.timeout(CHAT_STEP_MS),
    });
    return response.ok ? { rung: true } : { rung: false, reason: `Slack answered ${response.status}, so the doorbell was not sent (check that the webhook is still active).` };
  } catch (error) {
    return { rung: false, reason: timedOut(error) ? `Slack did not answer within ${Math.round(CHAT_STEP_MS / 1000)} seconds, so the doorbell was not sent.` : "Could not reach Slack, so the doorbell was not sent." };
  }
}

const touched = (...values: Array<string | undefined>) => values.some(Boolean);

/** Rings every configured channel at once; only configured channels appear in the result. Never throws. */
export async function ringChat(config: ChatConfig, item: RingItem, options: ChatOptions = {}, fetchImpl: typeof fetch = fetch): Promise<ChatResult> {
  const withSetting = { includeRequest: options.includeRequest ?? config.includeRequest };
  const jobs: Array<Promise<[keyof ChatResult, DoorbellResult]>> = [];
  const t = config.telegram;
  if (t && touched(t.token, t.tokenCommand, t.chatId)) jobs.push(ringTelegram(t, item, withSetting, fetchImpl).then(result => ["telegram", result]));
  const s = config.slack;
  if (s && touched(s.webhook, s.webhookCommand)) jobs.push(ringSlack(s, item, withSetting, fetchImpl).then(result => ["slack", result]));
  return Object.fromEntries(await Promise.all(jobs)) as ChatResult;
}
