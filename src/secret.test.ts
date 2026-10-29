import { describe, expect, it } from "vitest";
import { resolvePassword } from "./secret.js";

const node = (code: string) => `"${process.execPath}" -e "${code}"`;

describe("resolvePassword", () => {
  it("returns a plain password as it is, without running anything", async () => {
    await expect(resolvePassword({ pass: "plain", passCommand: "exit 1" })).resolves.toEqual({ pass: "plain" });
  });
  it("runs the command and trims the trailing newline", async () => {
    await expect(resolvePassword({ passCommand: node("process.stdout.write('abc123 ' + String.fromCharCode(10))") })).resolves.toEqual({ pass: "abc123" });
  });
  it("reports nothing configured when there is neither", async () => {
    await expect(resolvePassword({})).resolves.toEqual({});
  });
  it("fails with a reason that never repeats the command's output", async () => {
    const result = await resolvePassword({ passCommand: node("process.stdout.write('topsecret'); process.stderr.write('topsecret'); process.exit(3)") });
    expect(result.pass).toBeUndefined();
    expect(result.reason).toMatch(/password command/i);
    expect(JSON.stringify(result)).not.toContain("topsecret");
  });
  it("treats an empty answer as a failure", async () => {
    const result = await resolvePassword({ passCommand: node("process.stdout.write('')") });
    expect(result.pass).toBeUndefined();
    expect(result.reason).toMatch(/nothing/i);
  });
  it("gives up on a command that never answers", async () => {
    const result = await resolvePassword({ passCommand: node("setTimeout(()=>{},60000)") }, 500);
    expect(result.pass).toBeUndefined();
    expect(result.reason).toMatch(/did not answer/i);
  });
});
