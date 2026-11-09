import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBuilt } from "./testBuild.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const clients = readFileSync(path.join(ROOT, "docs", "clients.md"), "utf8");
const blocks = (lang: string) =>
  [...clients.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map(match => match[1]!);

const ENTRY_PLACEHOLDER = "/absolute/path/to/handoff-desk/dist/main.js";
const DESK_PLACEHOLDER = "/absolute/path/to/your/desk";
const TOOLS = ["handoff_answer", "handoff_capabilities", "handoff_inbox", "handoff_inbox_reply", "handoff_list", "handoff_pending", "handoff_read", "handoff_send", "handoff_status", "handoff_wait"];

interface Launch { command: string; args: string[]; env: Record<string, string> }

// What a client does with its config: run `command args` with `env` added to its own environment.
async function launchAndList(launch: Launch): Promise<string[]> {
  const transport = new StdioClientTransport({ command: launch.command, args: launch.args, env: { ...process.env as Record<string, string>, ...launch.env } });
  const client = new Client({ name: "client-config-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name).sort();
    // The desk folder is made when the first item is written, so write one.
    const sent = (await client.callTool({ name: "handoff_send", arguments: { type: "question", title: "Config check", request: "ping" } })) as { isError?: boolean };
    expect(sent.isError).toBeFalsy();
    return names;
  } finally {
    await client.close();
  }
}

const withRealPaths = (text: string, entry: string, desk: string) =>
  text.split(ENTRY_PLACEHOLDER).join(entry.replaceAll("\\", "/")).split(DESK_PLACEHOLDER).join(desk.replaceAll("\\", "/"));

function fromJson(text: string): Launch {
  const config = JSON.parse(text) as Record<string, any>;
  const server = (config.mcpServers ?? config.servers).handoff;
  return { command: server.command, args: server.args, env: server.env };
}

function fromToml(text: string): Launch {
  const command = /^command = "([^"]+)"/m.exec(text)![1]!;
  const args = JSON.parse(/^args = (\[.*\])$/m.exec(text)![1]!) as string[];
  const env = Object.fromEntries([...text.matchAll(/^(HANDOFF_[A-Z_]+) = "([^"]*)"$/gm)].map(match => [match[1]!, match[2]!]));
  return { command, args, env };
}

describe("every client config in docs/clients.md starts a working server", () => {
  // Cursor, VS Code (Copilot), Claude Desktop use JSON; Codex uses TOML. All end up as the same child process.
  it("JSON configs (Cursor, VS Code, Claude Desktop) and the Codex TOML", async () => {
    const entry = await ensureBuilt();
    const root = await mkdtemp(path.join(tmpdir(), "handoff clients-"));
    const desk = path.join(root, "my desk");
    // A TOML block without a command is a setting for an existing server (the Codex tool approval), not a launch.
    const tomlBlocks = blocks("toml");
    expect(tomlBlocks.filter(text => !/^command = /m.test(text)).join("\n")).toContain('[mcp_servers.handoff.tools.handoff_send]\napproval_mode = "approve"');
    const launches = [...blocks("json"), ...tomlBlocks.filter(text => /^command = /m.test(text))].map(text => {
      const real = withRealPaths(text, entry, desk);
      return text.includes("[mcp_servers") ? fromToml(real) : fromJson(real);
    });
    expect(launches.length).toBeGreaterThanOrEqual(4);
    for (const launch of launches) {
      expect(launch.command).toBe("node");
      expect(await launchAndList(launch)).toEqual(TOOLS);
    }
    await expect(stat(path.join(desk, "Desk"))).resolves.toBeTruthy();
  }, 180_000);

  it("a desk folder written as ~/something resolves to the home folder, not a folder named ~", async () => {
    const entry = await ensureBuilt();
    const home = await mkdtemp(path.join(tmpdir(), "handoff home-"));
    const launch: Launch = { command: "node", args: [entry], env: { HANDOFF_DIR: "~/tilde-desk", HOME: home, USERPROFILE: home } };
    expect(await launchAndList(launch)).toEqual(TOOLS);
    await expect(stat(path.join(home, "tilde-desk", "Desk"))).resolves.toBeTruthy();
  }, 120_000);
});
