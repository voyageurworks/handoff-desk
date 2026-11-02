import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENTS, PACKAGE, configCommand, renderClientConfig } from "./clientConfig.js";
import { ensureBuilt } from "./testBuild.js";

const root = path.resolve(import.meta.dirname, "..");
const unix = { dir: "~/handoff", windows: false };
const windows = { dir: "C:\\Users\\me\\handoff", windows: true };
const jsonClients = ["claude-desktop", "cursor", "windsurf", "gemini-cli", "lm-studio", "cline", "roo-code", "amazon-q", "kiro", "warp", "jetbrains"];

describe("the client table", () => {
  it("lists exactly the clients documented in the research, each with a where and an honest label", () => {
    expect(CLIENTS.map(client => client.id).sort()).toEqual(["amazon-q", "amp", "claude-code", "claude-desktop", "cline", "codex", "continue", "cursor", "gemini-cli", "goose", "jetbrains", "kilo-code", "kiro", "lm-studio", "opencode", "roo-code", "vscode", "warp", "windsurf", "zed"]);
    for (const client of CLIENTS) {
      expect(client.where.length, client.id).toBeGreaterThan(5);
      expect(["verified", "read", "documented"], client.id).toContain(client.evidence);
      // Anything stronger than "documented" says what was run; nothing else carries a claim.
      expect(Boolean(client.checked), client.id).toBe(client.evidence !== "documented");
    }
    // Only a client that was really run is called verified: the server connected (Claude Code, Gemini CLI, OpenCode, Kilo CLI).
    expect(CLIENTS.filter(client => client.evidence === "verified").map(client => client.id).sort()).toEqual(["claude-code", "gemini-cli", "kilo-code", "opencode"]);
    // Read back by the client's own command, which does not start servers.
    expect(CLIENTS.filter(client => client.evidence === "read").map(client => client.id)).toEqual(["codex"]);
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
  it("OpenCode uses its own shape: a mcp key, a local type and the command as one array (from OpenCode's own documentation)", () => {
    const config = JSON.parse(renderClientConfig("opencode", unix)!);
    expect(config.mcp.handoff).toEqual({ type: "local", command: ["npx", "-y", PACKAGE], enabled: true, environment: { HANDOFF_DIR: "~/handoff" } });
    expect(JSON.parse(renderClientConfig("opencode", windows)!).mcp.handoff.command).toEqual(["cmd", "/c", "npx", "-y", PACKAGE]);
  });
  it("Kilo Code uses the OpenCode-like shape in kilo.jsonc (from Kilo's own documentation)", () => {
    const config = JSON.parse(renderClientConfig("kilo-code", unix)!);
    expect(Object.keys(config)).toEqual(["mcp"]);
    expect(config.mcp.handoff).toEqual({ type: "local", command: ["npx", "-y", PACKAGE], enabled: true, environment: { HANDOFF_DIR: "~/handoff" } });
    expect(JSON.parse(renderClientConfig("kilo-code", windows)!).mcp.handoff.command).toEqual(["cmd", "/c", "npx", "-y", PACKAGE]);
  });
  it("Amp nests the server under the dotted key amp.mcpServers and says workspace files need approval", () => {
    const config = JSON.parse(renderClientConfig("amp", unix)!);
    expect(Object.keys(config)).toEqual(["amp.mcpServers"]);
    expect(config["amp.mcpServers"].handoff).toEqual({ command: "npx", args: ["-y", PACKAGE], env: { HANDOFF_DIR: "~/handoff" } });
    expect(CLIENTS.find(client => client.id === "amp")!.where).toMatch(/approv/i);
  });
  it("Continue gets a YAML block file with a name, version, schema and a mcpServers list", () => {
    const yaml = renderClientConfig("continue", unix)!;
    expect(yaml).toContain("name: Handoff Desk");
    expect(yaml).toContain("schema: v1");
    expect(yaml).toContain("mcpServers:\n  - name: handoff\n    command: " + JSON.stringify("npx") + "\n");
    expect(yaml).toContain("    args: [" + JSON.stringify("-y") + ", " + JSON.stringify(PACKAGE) + "]\n");
    expect(yaml).toContain("      HANDOFF_DIR: " + JSON.stringify("~/handoff"));
    expect(renderClientConfig("continue", windows)!).toContain("      HANDOFF_DIR: " + JSON.stringify(windows.dir));
    expect(renderClientConfig("continue", windows)!).toContain("    command: " + JSON.stringify("cmd"));
  });
  it("Goose gets an extensions entry of type stdio with cmd, args, env_keys, envs and a timeout", () => {
    const yaml = renderClientConfig("goose", unix)!;
    expect(yaml).toContain("extensions:\n  handoff:\n    type: stdio\n    name: handoff\n    enabled: true\n");
    expect(yaml).toContain("    cmd: " + JSON.stringify("npx") + "\n");
    expect(yaml).toContain("    args: [" + JSON.stringify("-y") + ", " + JSON.stringify(PACKAGE) + "]\n");
    expect(yaml).toContain("    env_keys: []\n");
    expect(yaml).toContain("    envs:\n      HANDOFF_DIR: " + JSON.stringify("~/handoff") + "\n");
    expect(yaml).toContain("    timeout: 300");
    expect(renderClientConfig("goose", windows)!).toContain("    cmd: " + JSON.stringify("cmd"));
  });
  it("the YAML blocks use no tabs and no trailing spaces, and end with a newline", () => {
    for (const id of ["continue", "goose"]) {
      const text = renderClientConfig(id, windows)!;
      expect(text, id).not.toContain("\t");
      expect(text, id).not.toMatch(/ +\n/);
      expect(text.endsWith("\n"), id).toBe(true);
    }
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
    expect(result.out!.trim().split("\n")).toHaveLength(20);
    for (const client of CLIENTS) expect(result.out).toContain(client.id);
    expect(result.out).toMatch(/claude-code\s+.*verified/);
    expect(result.out).toMatch(/cursor\s+.*documented/);
    expect(result.out).toMatch(/codex\s+.*\[read\]/);
    expect(result.out).toMatch(/gemini-cli\s+.*\[verified\]/);
  });
  it("prints only the config on stdout and says where it goes on stderr", () => {
    const result = configCommand(["--client", "cursor"], "linux");
    expect(result.code).toBe(0);
    expect(() => JSON.parse(result.out!)).not.toThrow();
    expect(result.err).toMatch(/mcp\.json/);
    expect(result.err).toMatch(/first start downloads the package/i);
    expect(configCommand(["--client", "gemini-cli"], "linux").err).toMatch(/Checked: Gemini CLI 0\.66\.0/);
    expect(result.err).not.toMatch(/Checked:/);
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
