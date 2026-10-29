import nodemailer from "nodemailer";
import type { NoteType } from "./note.js";
import { resolvePassword } from "./secret.js";

/** `pass`, or `passCommand` (a command that prints it), is the mail password. `to`: the agent's mailbox. `host`/`port` default to Gmail's SMTP over TLS. */
export type DoorbellConfig = { user?: string; pass?: string; passCommand?: string; to?: string; host?: string; port?: number };
export type DoorbellResult = { rung: boolean; reason?: string };
export type RingItem = { type: NoteType; id: number; title: string; path: string; request: string; replyBy?: string };

/** Time allowed for each SMTP step. Gmail's greeting alone can take about 10 s on a slow network. */
export const SMTP_STEP_MS = 20_000;
/** Time allowed for the whole send, whatever the steps add up to. */
const RING_TOTAL_MS = 45_000;

/** Port 465 is TLS from the first byte; any other port must upgrade with STARTTLS or fail, never send the password in the clear. */
export function transportOptions(config: DoorbellConfig, port: number) {
  const secure = port === 465;
  return { host: config.host ?? "smtp.gmail.com", port, secure, requireTLS: !secure, auth: { user: config.user, pass: config.pass }, connectionTimeout: SMTP_STEP_MS, greetingTimeout: SMTP_STEP_MS, socketTimeout: SMTP_STEP_MS };
}

/** `prefix`: the word before the type in the subject (default "Handoff"). `sync`: the desk is a git repo the agent pushes to. `totalMs`: cap on the whole send. */
export type RingOptions = { prefix?: string; sync?: boolean; totalMs?: number };

export function doorbellSubject(item: { type: NoteType; id: number; title: string }, prefix = "Handoff"): string {
  return `[${prefix} ${item.type} #${item.id}] ${item.title.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

/**
 * The doorbell email. It carries the whole request, so the agent can act without opening the desk folder first.
 * Sent over SMTP when configured; otherwise the caller sends the same message some other way (the tool result includes it).
 */
export function ringMessage(item: RingItem, to: string, options: RingOptions = {}): { to: string; subject: string; body: string } {
  const replyBy = item.replyBy ? `\nReply by: ${item.replyBy}\n` : "";
  const answer = `Answer under "## Reply", set status to done and answered${options.sync ? ", then commit and push" : ""}.`;
  return {
    to,
    subject: doorbellSubject(item, options.prefix),
    body: `New handoff #${item.id} (${item.type}): ${item.title}\n\n${item.request}\n${replyBy}\nThe same item is in the desk folder at: ${item.path}\n${answer} Never write passwords, codes or keys.`,
  };
}

/** Sends the doorbell. Never throws: the note is already written, so a failure only loses the nudge. */
export async function ringDoorbell(config: DoorbellConfig, item: RingItem, options: RingOptions = {}): Promise<DoorbellResult> {
  if (!config.user || (!config.pass && !config.passCommand)) return { rung: false, reason: "Doorbell not configured (set HANDOFF_MAIL_USER and HANDOFF_MAIL_APP_PASSWORD or HANDOFF_MAIL_PASSWORD_COMMAND)." };
  if (!config.to) return { rung: false, reason: "No recipient for the doorbell (set HANDOFF_MAIL_TO)." };
  const { pass, reason } = await resolvePassword(config);
  if (!pass) return { rung: false, reason: reason ?? "No mail password." };
  const port = config.port ?? 465;
  try {
    const transport = nodemailer.createTransport(transportOptions({ ...config, pass }, port));
    const message = ringMessage(item, config.to, options);
    // The three SMTP steps could add up to a minute, longer than an MCP client waits for a tool call: the whole send has its own cap.
    const totalMs = options.totalMs ?? RING_TOTAL_MS;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">(resolve => { timer = setTimeout(() => resolve("late"), totalMs); });
    const sent = transport.sendMail({ from: config.user, to: message.to, subject: message.subject, text: message.body });
    sent.catch(() => undefined); // if the cap wins, a later failure of this send is not an unhandled rejection
    try {
      if (await Promise.race([sent, late]) === "late") {
        transport.close();
        return { rung: false, reason: `The mail server did not answer within ${Math.round(totalMs / 1000)} seconds, so the doorbell was not sent.` };
      }
    } finally {
      clearTimeout(timer);
    }
    return { rung: true };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split(pass).join("[redacted]");
    return { rung: false, reason: `The mail server rejected the doorbell: ${message}`.slice(0, 300) };
  }
}
