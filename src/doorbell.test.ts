import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { SMTP_STEP_MS, ringDoorbell, ringMessage, transportOptions } from "./doorbell.js";

const item = { type: "errand" as const, id: 9, title: "Book  dentist", path: "Desk/2026-01-15 Item 09 - Book dentist.md", request: "Friday at 3", replyBy: "Thu" };

describe("ringMessage", () => {
  it("formats the subject and carries the whole request", () => {
    const message = ringMessage(item, "agent@example.com");
    expect(message.to).toBe("agent@example.com");
    expect(message.subject).toBe("[Handoff errand #9] Book dentist");
    expect(message.body).toContain("Friday at 3");
    expect(message.body).toContain("Reply by: Thu");
    expect(message.body).toContain(item.path);
    expect(message.body).toContain('Answer under "## Reply", set status to done and answered.');
  });
  it("uses a custom subject prefix", () => {
    expect(ringMessage(item, "a@example.com", { prefix: "Claude" }).subject).toBe("[Claude errand #9] Book dentist");
  });
  it("tells a cloud agent to commit and push only when the desk syncs through git", () => {
    expect(ringMessage(item, "a@example.com", { sync: true }).body).toContain("then commit and push");
    expect(ringMessage(item, "a@example.com").body).not.toContain("commit and push");
  });
  it("cuts a very long title at 120 characters", () => {
    expect(ringMessage({ ...item, title: "t".repeat(300) }, "a@example.com").subject.length).toBe("[Handoff errand #9] ".length + 120);
  });
});

describe("ringDoorbell", () => {
  // Gmail's SMTP greeting takes about 10 s on a slow network, so a 10 s limit timed out every ring (seen live).
  it("gives the mail server at least 20 seconds per step", () => {
    expect(SMTP_STEP_MS).toBeGreaterThanOrEqual(20_000);
  });
  it("does not throw when nothing is configured and names the settings", async () => {
    const result = await ringDoorbell({}, item);
    expect(result.rung).toBe(false);
    expect(result.reason).toContain("HANDOFF_MAIL_USER");
  });
  it("does not throw when no recipient is set", async () => {
    const result = await ringDoorbell({ user: "me@example.com", pass: "abcd efgh ijkl mnop" }, item);
    expect(result.rung).toBe(false);
    expect(result.reason).toContain("HANDOFF_MAIL_TO");
  });
  it("never leaks the password when SMTP fails", async () => {
    const pass = "abcdefghijklmnop";
    const result = await ringDoorbell({ user: "me@example.com", pass, to: "agent@example.com", host: "127.0.0.1", port: 1 }, item);
    expect(result.rung).toBe(false);
    expect(result.reason).not.toContain(pass);
  });
});

describe("transportOptions", () => {
  const config = { user: "me@example.test", pass: "x", to: "a@example.test" };
  it("uses TLS from the start on 465 and requires STARTTLS on every other port", () => {
    expect(transportOptions(config, 465)).toMatchObject({ secure: true, requireTLS: false });
    expect(transportOptions(config, 587)).toMatchObject({ secure: false, requireTLS: true });
  });
});

describe("ringDoorbell time cap", () => {
  it("gives up after the total time even when the mail server accepts the connection and never speaks", async () => {
    const server = createServer(() => undefined); // accepts, says nothing
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const started = Date.now();
    const result = await ringDoorbell({ user: "me@example.test", pass: "x", to: "a@example.test", host: "127.0.0.1", port }, { type: "errand", id: 1, title: "T", path: "Desk/x.md", request: "r" }, { totalMs: 400 });
    server.close();
    expect(result.rung).toBe(false);
    expect(result.reason).toMatch(/did not answer/);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("ringDoorbell with a password command", () => {
  const node = (code: string) => `"${process.execPath}" -e "${code}"`;
  it("does not ring, and says why, when the password command fails; the output is never repeated", async () => {
    const result = await ringDoorbell({ user: "me@example.test", to: "agent@example.test", passCommand: node("process.stdout.write('leakme'); process.exit(2)") }, item);
    expect(result.rung).toBe(false);
    expect(result.reason).toMatch(/password command failed/i);
    expect(JSON.stringify(result)).not.toContain("leakme");
  });
  it("counts a password command as the doorbell being configured", async () => {
    const result = await ringDoorbell({ user: "me@example.test", passCommand: "x" }, item);
    expect(result.reason).toMatch(/recipient/i);
  });
});
