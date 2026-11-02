import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENTS, PACKAGE, configCommand, renderClientConfig } from "./clientConfig.js";
import { ensureBuilt } from "./testBuild.js";

const root = path.resolve(import.meta.dirname, "..");
const unix = { dir: "~/handoff", windows: false };
const windows = { dir: "C:\\Users\\me\\handoff", windows: true };
const jsonClients = ["claude-desktop", "cursor", "windsurf", "gemini-cli", "lm-studio", "cline", "roo-code", "amazon-q"];

describe("the client table", () => {
  it("lists exactly the clients documented in the research, each with a where and an honest label", () => {
    expect(CLIENTS.map(client => client.id).sort()).toEqual(["amazon-q", "claude-code", "claude-desktop", "cline", "codex", "cursor", "gemini-cli", "lm-studio", "roo-code", "vscode", "windsurf", "zed"]);
    for (const client of CLIENTS) {
      expect(client.where.length, client.id).toBeGreaterThan(5);
      expect(["verified", "documented"], client.id).toContain(client.evidence);
    }
    // Only a client that was really run is called verified.
    expect(CLIENTS.filter(client => client.evidence === "verified").map(client => client.id)).toEqual(["claude-code"]);
  });
});

describe("renderClientConfig", () => {
  it.each(jsonClients)("%s: valid JSON under mcpServers, launching the package with the desk folder", id => {
    const config = JSON.parse(renderClientConfig(id, unix)!);
    expect(Object.keys(config)).toEqual(["mcpServers"]);
    expect(config.mcpServers.handoff).toEqual({ command: "npx", args: ["-y", PACKAGE], env: { HANDOFF_DIR: "~/handoff" } });
  });
  it("VS Code uses its own key and says the transport", () => {
    const config = JSON.parse(renderClientConfig("vscode", unix)!);
    expect(Object.keys(config)).toEqual(["servers"]);
    expect(config.servers.handoff).toEqual({ type: "stdio", command: "npx", args: ["-y", PACKAGE], env: { HANDOFF_DIR: "~/handoff" } });
  });
  it("Zed uses context_servers (shape from Zed's own documentation)", () => {
    const config = JSON.parse(renderClientConfig("zed", unix)!);
    expect(Object.keys(config)).toEqual(["context_servers"]);
    expect(config.context_servers.handoff).toEqual({ command: "npx", args: ["-y", PACKAGE], env: { HANDOFF_DIR: "~/handoff" } });
  });
  it("Codex gets a TOML table, with the environment in its own sub-table", () => {
    const toml = renderClientConfig("codex", unix)!;
    expect(toml).toContain("[mcp_servers.handoff]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain(`args = ["-y", "${PACKAGE}"]`);
    expect(toml).toContain("[mcp_servers.handoff.env]");
    expect(toml).toContain('HANDOFF_DIR = "~/handoff"');
  });
  it("runs npx through cmd /c on Windows, and escapes the backslashes in a Windows folder", () => {
    const cursor = JSON.parse(renderClientConfig("cursor", windows)!);
    expect(cursor.mcpServers.handoff).toEqual({ command: "cmd", args: ["/c", "npx", "-y", PACKAGE], env: { HANDOFF_DIR: "C:\\Users\\me\\handoff" } });
    const toml = renderClientConfig("codex", windows)!;
    expect(toml).toContain('command = "cmd"');
    expect(toml).toContain(`args = ["/c", "npx", "-y", "${PACKAGE}"]`);
    expect(toml).toContain('HANDOFF_DIR = "C:\\\\Users\\\\me\\\\handoff"');
  });
  it("Claude Code gets the command that was verified, with PowerShell's quoted double dash on Windows", () => {
    expect(renderClientConfig("claude-code", unix)).toBe(`claude mcp add handoff -e HANDOFF_DIR="~/handoff" -- npx -y ${PACKAGE}\n`);
    expect(renderClientConfig("claude-code", windows)).toBe(`claude mcp add handoff -e HANDOFF_DIR="C:\\Users\\me\\handoff" '--' cmd /c npx -y '${PACKAGE}'\n`);
  });
  it("returns nothing for an unknown client", () => {
    expect(renderClientConfig("nope", unix)).toBeUndefined();
  });
});

describe("the repository's mcp.json", () => {
  it("is exactly what the generator prints for a JSON client, and holds no secret", async () => {
    const text = await readFile(path.join(root, "mcp.json"), "utf8");
    expect(JSON.parse(text)).toEqual(JSON.parse(renderClientConfig("cursor", unix)!));
    expect(text).not.toMatch(/token|password|webhook|secret/i);
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(PACKAGE).toBe(pkg.name);
    expect(pkg.files).not.toContain("mcp.json");
  });
});

describe("configCommand", () => {
  it("lists every client with its label", () => {
    const result = configCommand(["--list"], "linux");
    expect(result.code).toBe(0);
    for (const client of CLIENTS) expect(result.out).toContain(client.id);
    expect(result.out).toMatch(/claude-code\s+.*verified/);
    expect(result.out).toMatch(/cursor\s+.*documented/);
  });
  it("prints only the config on stdout and says where it goes on stderr", () => {
    const result = configCommand(["--client", "cursor"], "linux");
    expect(result.code).toBe(0);
    expect(() => JSON.parse(result.out!)).not.toThrow();
    expect(result.err).toMatch(/mcp\.json/);
  });
  it("honours --dir and --windows, and defaults the form to the platform", () => {
    expect(JSON.parse(configCommand(["--client", "cursor", "--dir", "/data/desk"], "linux").out!).mcpServers.handoff.env.HANDOFF_DIR).toBe("/data/desk");
    expect(JSON.parse(configCommand(["--client", "cursor", "--windows"], "linux").out!).mcpServers.handoff.command).toBe("cmd");
    expect(JSON.parse(configCommand(["--client", "cursor"], "win32").out!).mcpServers.handoff.command).toBe("cmd");
  });
  it("names the valid clients for an unknown one, and shows usage for none", () => {
    const unknown = configCommand(["--client", "nope"], "linux");
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("cursor");
    expect(configCommand([], "linux").code).toBe(2);
  });
});

describe("the config command in the built program", () => {
  it("prints a config and exits 0; an unknown client exits 1", async () => {
    const entry = await ensureBuilt();
    const ok = execFileSync(process.execPath, [entry, "config", "--client", "zed"], { encoding: "utf8" });
    expect(JSON.parse(ok).context_servers.handoff.command).toBe(process.platform === "win32" ? "cmd" : "npx");
    const bad = spawnSync(process.execPath, [entry, "config", "--client", "nope"], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("zed");
  }, 180_000);
});
