import { exec } from "node:child_process";

export type PasswordSource = { pass?: string; passCommand?: string };
export type PasswordResult = { pass?: string; reason?: string };

/** A password manager answers in a second or two; a prompt waiting for someone to type must not hang a tool call. */
const COMMAND_MS = 10_000;

/**
 * The mail password: given directly, or fetched by running the user's own command (HANDOFF_MAIL_PASSWORD_COMMAND) that
 * prints it, so it can live in a password manager or an encrypted store instead of a plain file. The command is
 * the user's own setting, run the way a git credential helper is. What it prints or errors with is never repeated
 * in a message, because that is where the password would be.
 */
export async function resolvePassword(source: PasswordSource, timeoutMs: number = COMMAND_MS): Promise<PasswordResult> {
  if (source.pass) return { pass: source.pass };
  if (!source.passCommand) return {};
  return new Promise(resolve => {
    exec(source.passCommand!, { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        resolve({ reason: timedOut ? `The password command did not answer within ${Math.round(timeoutMs / 1000)} seconds.` : "The password command failed (HANDOFF_MAIL_PASSWORD_COMMAND)." });
        return;
      }
      const pass = stdout.replace(/[\r\n]+$/, "").trim();
      resolve(pass ? { pass } : { reason: "The password command printed nothing (HANDOFF_MAIL_PASSWORD_COMMAND)." });
    });
  });
}
