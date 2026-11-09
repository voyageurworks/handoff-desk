import type { RingItem } from "./doorbell.js";
import { resolvePassword } from "./secret.js";

/**
 * Optional wake call for an OpenClaw Gateway: after a note is created, one POST to the Gateway's /hooks/wake tells the agent
 * to look at the desk. Outgoing only, like the chat doorbells; the agent still answers in the note. The hook token comes from
 * the environment or the user's own command and is never written to a result, an error or a log. The message names the item
 * and says what to do; the request text is never sent, because a wake is delivered to the agent as a trusted notice.
 */
export type WakeConfig = { url?: string; token?: string; tokenCommand?: string; agentId?: string };
export type WakeOutcome = { rung: boolean; reason?: string };

/** Time allowed for the Gateway to answer. */
export const WAKE_STEP_MS = 10_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const AGENT_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** https anywhere, or plain http only to this computer; no credentials, query or fragment; the path must end in /wake. */
export function wakeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
    if (!secure || url.username || url.password || url.search || url.hash) return null;
    return /\/wake\/?$/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

export const validAgentId = (value: string) => AGENT_ID.test(value);

/** A hook token is a long random string of visible ASCII; anything else (spaces, line breaks, non-ASCII) could not be a header value and is never sent. */
export const validHookToken = (value: string) => /^[\x21-\x7E]{8,512}$/.test(value);

/**
 * The wake is delivered to the agent as a trusted notice, so it holds only what handoff-desk itself controls: the number and
 * the type (one of three fixed words). The title and the request are written by whichever assistant sent the note, which may
 * have read a hostile page or mail, so they stay in the note, where the agent treats them as untrusted information.
 */
export function wakeText(item: Pick<RingItem, "id" | "type">, options: { test?: boolean } = {}): string {
  if (options.test) return "handoff-desk doctor test: this wake call works. Nothing to do.";
  const type = ["errand", "question", "status"].includes(item.type) ? item.type : "note";
  return `New handoff #${Math.trunc(Number(item.id))} (${type}) is waiting on the desk. Call handoff_capabilities for what you may do alone, handoff_pending to read it, then handoff_answer.`;
}

export async function wakeAgent(config: WakeConfig, item: RingItem, options: { test?: boolean } = {}, fetchImpl: typeof fetch = fetch): Promise<WakeOutcome> {
  if (!config.url) return { rung: false, reason: "OpenClaw wake not configured (set HANDOFF_OPENCLAW_WAKE_URL)." };
  if (!config.token && !config.tokenCommand) return { rung: false, reason: "No OpenClaw hook token (set HANDOFF_OPENCLAW_HOOK_TOKEN or HANDOFF_OPENCLAW_HOOK_TOKEN_COMMAND)." };
  const url = wakeUrl(config.url);
  if (!url) return { rung: false, reason: "HANDOFF_OPENCLAW_WAKE_URL must be the Gateway's /hooks/wake address: https://..., or http://127.0.0.1:<port>/hooks/wake on the same computer; nothing was sent." };
  if (config.agentId && !validAgentId(config.agentId)) return { rung: false, reason: "HANDOFF_OPENCLAW_AGENT_ID may only use letters, digits, dots, dashes and underscores; nothing was sent." };
  const { pass: token, reason } = await resolvePassword({ pass: config.token, passCommand: config.tokenCommand }, undefined, "HANDOFF_OPENCLAW_HOOK_TOKEN_COMMAND");
  if (!token) return { rung: false, reason: reason ?? "No OpenClaw hook token." };
  if (!validHookToken(token)) return { rung: false, reason: "The OpenClaw hook token must be one run of visible characters, 8 to 512 long, with no spaces or line breaks (copy hooks.token again); nothing was sent." };
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: wakeText(item, options), mode: "now", ...(config.agentId ? { agentId: config.agentId } : {}) }),
      redirect: "error",
      signal: AbortSignal.timeout(WAKE_STEP_MS),
    });
    if (response.ok) return { rung: true };
    if (response.status === 401 || response.status === 403) return { rung: false, reason: `The OpenClaw Gateway refused the hook token (${response.status}); check hooks.token in its config.` };
    if (response.status === 404) return { rung: false, reason: "The OpenClaw Gateway answered 404: hooks are off, or the path is not /hooks/wake (set hooks.enabled in its config)." };
    return { rung: false, reason: `The OpenClaw Gateway answered ${response.status}, so the wake call was not accepted.` };
  } catch (error) {
    // Never the error's own text: it can carry the address.
    const slow = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { rung: false, reason: slow ? `The OpenClaw Gateway did not answer within ${Math.round(WAKE_STEP_MS / 1000)} seconds.` : "Could not reach the OpenClaw Gateway, so the wake call was not sent." };
  }
}
