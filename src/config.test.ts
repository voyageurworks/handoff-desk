import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { expandHome, loadConfig, syncEnv } from "./config.js";

// A password in the MCP client's own config sits there as plain text; a private file keeps it out.
describe("HANDOFF_ENV_FILE", () => {
  async function envFile(text: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "handoff-env-"));
    const file = path.join(dir, "handoff.env");
    await writeFile(file, text);
    return file;
  }

  it("reads the mail settings from the file", async () => {
    const file = await envFile("HANDOFF_MAIL_USER=me@example.test\nHANDOFF_MAIL_APP_PASSWORD=filepass\nHANDOFF_MAIL_TO=agent@example.test\n");
    expect(loadConfig({ HANDOFF_ENV_FILE: file }).doorbell).toMatchObject({ user: "me@example.test", pass: "filepass", to: "agent@example.test" });
  });

  it("lets the environment win over the file", async () => {
    const file = await envFile("HANDOFF_MAIL_USER=file@example.test\nHANDOFF_MAIL_APP_PASSWORD=filepass\n");
    expect(loadConfig({ HANDOFF_ENV_FILE: file, HANDOFF_MAIL_USER: "env@example.test" }).doorbell).toMatchObject({ user: "env@example.test", pass: "filepass" });
  });

  it("starts without the settings when the file is missing, and never prints", async () => {
    expect(loadConfig({ HANDOFF_ENV_FILE: path.join(os.tmpdir(), "no-such-handoff.env") }).doorbell).toMatchObject({ user: undefined, pass: undefined });
  });

  it("reads other settings from the file too", async () => {
    const file = await envFile("HANDOFF_SUBJECT_PREFIX=Claude\nHANDOFF_INBOX_DIR=For Claude\n");
    expect(loadConfig({ HANDOFF_ENV_FILE: file })).toMatchObject({ prefix: "Claude", inboxDir: "For Claude" });
  });

  it("reads the time zone and git identity from the file too", async () => {
    const NL = String.fromCharCode(10);
    const file = await envFile(["HANDOFF_TZ=America/Halifax", "HANDOFF_GIT_NAME=Desk Bot", "HANDOFF_GIT_EMAIL=bot@example.test", ""].join(NL));
    const config = loadConfig({ HANDOFF_ENV_FILE: file });
    expect(config.tz).toBe("America/Halifax");
    expect(config.identity).toEqual({ name: "Desk Bot", email: "bot@example.test" });
  });

  it("hands the file's git identity and the chosen sync mode to sync detection", async () => {
    const NL = String.fromCharCode(10);
    const file = await envFile(["HANDOFF_GIT_NAME=Desk Bot", "HANDOFF_GIT_EMAIL=bot@example.test", ""].join(NL));
    const env = syncEnv(loadConfig({ HANDOFF_ENV_FILE: file, HANDOFF_SYNC: "git" }), {});
    expect(env).toMatchObject({ HANDOFF_SYNC: "git", HANDOFF_GIT_NAME: "Desk Bot", HANDOFF_GIT_EMAIL: "bot@example.test" });
  });

  it("says on stderr which settings file could not be read", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const missing = path.join(os.tmpdir(), "no-such-handoff.env");
    loadConfig({ HANDOFF_ENV_FILE: missing });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(missing));
    warn.mockRestore();
  });
});

// PowerShell and cmd do not expand "~", and a JSON client config never does: without this a new user gets a folder literally named "~".
describe("leading ~ in paths", () => {
  it("expands ~ at the start of a path (both slash styles) and leaves other paths alone", () => {
    const home = os.homedir();
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/desk")).toBe(path.join(home, "desk"));
    expect(expandHome("~" + String.fromCharCode(92) + "desk")).toBe(path.join(home, "desk"));
    expect(expandHome("/abs/desk")).toBe("/abs/desk");
    expect(expandHome("~other/desk")).toBe("~other/desk");
    expect(expandHome("a/~/b")).toBe("a/~/b");
  });

  it("applies to the desk folder, the mail folder and the settings file", async () => {
    const home = os.homedir();
    const config = loadConfig({ HANDOFF_DIR: "~/desk", HANDOFF_MAIL_DIR: "~/mailcopies" });
    expect(config.dir).toBe(path.join(home, "desk"));
    expect(config.desk.deskDir).toBe(path.join(home, "desk", "Desk"));
    expect(config.mailDir).toBe(path.join(home, "mailcopies"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    loadConfig({ HANDOFF_ENV_FILE: "~/no-such-settings.env" });
    expect(spy.mock.calls.join(" ")).toContain(path.join(home, "no-such-settings.env"));
    spy.mockRestore();
  });
});
