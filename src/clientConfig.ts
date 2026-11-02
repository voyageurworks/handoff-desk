/**
 * `handoff-desk config --client <name>`: the settings block for each MCP client, from one table.
 *
 * Most clients take the same JSON under `mcpServers`; a few differ (VS Code `servers`, Zed `context_servers`, Codex TOML), and
 * Windows needs `npx` run through `cmd /c`. `evidence` is honest: "verified" means the exact output was run against the real
 * client and it started the server; "read" means the client's own command read the output back correctly but does not start
 * servers; "documented" means the shape comes from the client's own documentation and was not run here. `checked` says exactly
 * what was run (client version, system, command).
 * See docs/projects/handoff-mcp/agent-platform-research.md in the maintainers' notes for sources and dates.
 */
export const PACKAGE = "@voyageurworks/handoff-desk";

export type ClientOptions = { dir: string; windows: boolean };
export type ClientSpec = {
  id: string;
  name: string;
  evidence: "verified" | "read" | "documented";
  /** What was run for "verified" and "read": the client version, the system and the command. */
  checked?: string;
  /** Where the text goes, in words. Printed on stderr so stdout stays pasteable. */
  where: string;
  render(options: ClientOptions): string;
  /**
   * Set only for a client whose user settings file is strict JSON in a documented place under the home folder; `handoff-desk
   * install` edits exactly that file and key (see install.ts). Every other client is config-only.
   */
  install?: { file: string[]; key: string };
};

const launch = ({ windows }: ClientOptions) => (windows ? { command: "cmd", args: ["/c", "npx", "-y", PACKAGE] } : { command: "npx", args: ["-y", PACKAGE] });
const entry = (options: ClientOptions) => ({ ...launch(options), env: { HANDOFF_DIR: options.dir } });
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const under = (key: string) => (options: ClientOptions) => json({ [key]: { handoff: entry(options) } });
// A JSON string is a valid TOML basic string for the text used here (escapes backslashes and quotes the same way).
const toml = (value: string) => JSON.stringify(value);
// Likewise a valid YAML double-quoted string, so the YAML blocks below never need a YAML library.
const yamlString = (value: string) => JSON.stringify(value);
const yamlList = (values: string[]) => `[${values.map(yamlString).join(", ")}]`;
// OpenCode and Kilo Code share one shape: a `mcp` key, a local type, the command as one array and an `environment` key.
const localEntry = (options: ClientOptions) => ({ type: "local", command: [launch(options).command, ...launch(options).args], enabled: true, environment: { HANDOFF_DIR: options.dir } });

export const CLIENTS: ClientSpec[] = [
  {
    id: "claude-code", name: "Claude Code", evidence: "verified", checked: "Claude Code 2.1 on Windows 11 (claude mcp add, then the server connected); macOS and Linux not run.",
    where: "Run this command in a terminal. Verified on Windows (PowerShell, with the quoted double dash and cmd /c); the macOS and Linux form follows Claude Code's documented syntax and was not run here.",
    render: options => options.windows
      ? `claude mcp add handoff -e HANDOFF_DIR="${options.dir}" '--' cmd /c npx -y '${PACKAGE}'\n`
      : `claude mcp add handoff -e HANDOFF_DIR="${options.dir}" -- npx -y ${PACKAGE}\n`,
  },
  { id: "claude-desktop", name: "Claude Desktop", evidence: "documented", where: "claude_desktop_config.json (Settings, Developer, Edit Config). Local servers only; restart the app.", render: under("mcpServers") },
  { id: "cursor", name: "Cursor", evidence: "documented", where: "~/.cursor/mcp.json for all projects, or .cursor/mcp.json in one project.", render: under("mcpServers"), install: { file: [".cursor", "mcp.json"], key: "mcpServers" } },
  {
    id: "vscode", name: "VS Code (GitHub Copilot agent mode)", evidence: "documented",
    where: "Command palette: MCP: Open User Configuration (mcp.json), or .vscode/mcp.json in one project. VS Code's key is `servers`.",
    render: options => json({ servers: { handoff: { type: "stdio", ...entry(options) } } }),
  },
  { id: "windsurf", name: "Windsurf (Devin Desktop)", evidence: "documented", where: "~/.config/devin/mcp_config.json (Windows %APPDATA%\\devin\\mcp_config.json); older versions: ~/.codeium/windsurf/mcp_config.json.", render: under("mcpServers") },
  { id: "gemini-cli", name: "Gemini CLI", evidence: "verified", checked: "Gemini CLI 0.66.0 on Windows 11: `gemini mcp list` showed the server connected (with folder trust off in a throwaway home); macOS and Linux not run.", where: "~/.gemini/settings.json for all projects, or .gemini/settings.json in one project.", render: under("mcpServers"), install: { file: [".gemini", "settings.json"], key: "mcpServers" } },
  {
    id: "codex", name: "Codex (CLI and IDE)", evidence: "read", checked: "Codex 0.166.0 on Windows 11: `codex mcp get handoff` read the file back correctly (stdio, the command, the arguments, the env); that command does not start the server.",
    where: "~/.codex/config.toml (or .codex/config.toml in a trusted project), or `codex mcp add handoff -- <command>`.",
    render: options => {
      const { command, args } = launch(options);
      return `[mcp_servers.handoff]\ncommand = ${toml(command)}\nargs = [${args.map(toml).join(", ")}]\n\n[mcp_servers.handoff.env]\nHANDOFF_DIR = ${toml(options.dir)}\n`;
    },
  },
  { id: "lm-studio", name: "LM Studio", evidence: "documented", where: "~/.lmstudio/mcp.json (Program tab, Install, Edit mcp.json).", render: under("mcpServers"), install: { file: [".lmstudio", "mcp.json"], key: "mcpServers" } },
  { id: "cline", name: "Cline", evidence: "documented", where: "cline_mcp_settings.json (MCP Servers icon, Configure tab, Configure MCP Servers).", render: under("mcpServers") },
  { id: "roo-code", name: "Roo Code", evidence: "documented", where: "MCP settings, Edit Global MCP, or .roo/mcp.json in one project (the project file wins).", render: under("mcpServers") },
  {
    id: "opencode", name: "OpenCode", evidence: "verified", checked: "OpenCode 1.19.5 on Windows 11: `opencode mcp list` showed the server connected; macOS and Linux not run.",
    where: "opencode.json or opencode.jsonc (your project root or your global OpenCode config). OpenCode's key is `mcp`, a local server's command is one array, and the environment key is `environment`.",
    render: options => json({ $schema: "https://opencode.ai/config.json", mcp: { handoff: localEntry(options) } }),
  },
  {
    id: "kilo-code", name: "Kilo Code", evidence: "verified", checked: "Kilo CLI 7.8.18 on Windows 11, reading $XDG_CONFIG_HOME/kilo/kilo.jsonc: `kilo mcp list` showed the server connected; the editor extension was not run.",
    where: "kilo.jsonc: ~/.config/kilo/kilo.jsonc for every project, or kilo.jsonc (or .kilo/kilo.jsonc) in one project; the project file wins. Kilo's key is `mcp`; merge it into the file if it already has one. The settings screen (Agent Behaviour, MCP Servers) edits the same file.",
    render: options => json({ mcp: { handoff: localEntry(options) } }),
  },
  {
    id: "kiro", name: "Kiro", evidence: "documented",
    where: "~/.kiro/settings/mcp.json for every workspace, or .kiro/settings/mcp.json in one workspace (the workspace file wins). Kiro also accepts disabled, autoApprove and disabledTools per server; none is needed here.",
    render: under("mcpServers"),
    install: { file: [".kiro", "settings", "mcp.json"], key: "mcpServers" },
  },
  {
    id: "amp", name: "Amp", evidence: "documented",
    where: "~/.config/amp/settings.json for every project (no approval needed), or .amp/settings.json in one project (Amp asks you to approve a workspace server the first time). Merge the amp.mcpServers key into the file if it already has one.",
    render: options => json({ "amp.mcpServers": { handoff: entry(options) } }),
    install: { file: [".config", "amp", "settings.json"], key: "amp.mcpServers" },
  },
  {
    id: "warp", name: "Warp", evidence: "documented",
    where: "Warp, Settings, Agents, MCP servers, + Add, then paste this JSON (Warp adds every server in it). Warp starts the command itself and stops it when it exits.",
    render: under("mcpServers"),
  },
  {
    id: "jetbrains", name: "JetBrains AI Assistant", evidence: "documented",
    where: "Settings, Tools, AI Assistant, Model Context Protocol (MCP), Add, then paste this JSON as the configuration and pick the server level (global or this project). JetBrains' documentation shows command and args; env is the common MCP key and is included so the desk folder reaches the server, so check the server starts and use handoff-desk doctor if it does not.",
    render: under("mcpServers"),
  },
  {
    id: "continue", name: "Continue", evidence: "documented",
    where: "A new file .continue/mcpServers/handoff.yaml in your workspace (or the same folder under your home folder). Continue reads every YAML file in that folder; no other file needs to change.",
    render: options => {
      const { command, args } = launch(options);
      return ["name: Handoff Desk", "version: 0.0.1", "schema: v1", "mcpServers:", "  - name: handoff", `    command: ${yamlString(command)}`, `    args: ${yamlList(args)}`, "    env:", `      HANDOFF_DIR: ${yamlString(options.dir)}`, ""].join("\n");
    },
  },
  {
    id: "goose", name: "Goose", evidence: "documented",
    where: "Under the `extensions:` key in Goose's config.yaml (Windows %APPDATA%\Block\goose\config\config.yaml; macOS and Linux ~/.config/goose/config.yaml), or add the same values in the app: Extensions, Add custom extension, Command-line extension. Merge the handoff entry into the existing extensions key.",
    render: options => {
      const { command, args } = launch(options);
      return ["extensions:", "  handoff:", "    type: stdio", "    name: handoff", "    enabled: true", `    cmd: ${yamlString(command)}`, `    args: ${yamlList(args)}`, "    env_keys: []", "    envs:", `      HANDOFF_DIR: ${yamlString(options.dir)}`, "    timeout: 300", ""].join("\n");
    },
  },
  { id: "amazon-q", name: "Amazon Q Developer", evidence: "documented", where: "~/.aws/amazonq/default.json (or .amazonq/default.json in one project); the older mcp.json files are still read.", render: under("mcpServers") },
  {
    id: "zed", name: "Zed", evidence: "documented",
    where: "Zed settings file (command palette: zed: open settings file). Zed's key is `context_servers`.",
    render: options => json({ context_servers: { handoff: entry(options) } }),
  },
];

export function renderClientConfig(id: string, options: ClientOptions): string | undefined {
  return CLIENTS.find(client => client.id === id)?.render(options);
}

const USAGE = "Usage: handoff-desk config --client <name> [--dir <desk folder>] [--windows]\n       handoff-desk config --list";

/** The `config` command, pure so it can be tested: what to print on stdout, what on stderr, and the exit code. */
export function configCommand(args: string[], platform: string = process.platform): { out?: string; err?: string; code: number } {
  if (args.includes("--list")) {
    const width = Math.max(...CLIENTS.map(client => client.id.length));
    return { out: `${CLIENTS.map(client => `${client.id.padEnd(width)}  ${client.name}  [${client.evidence}]`).join("\n")}\n`, code: 0 };
  }
  const value = (flag: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  const id = value("--client");
  if (!id) return { err: USAGE, code: 2 };
  const client = CLIENTS.find(candidate => candidate.id === id);
  if (!client) return { err: `Unknown client "${id}". Choose one of: ${CLIENTS.map(candidate => candidate.id).join(", ")}.`, code: 1 };
  const options = { dir: value("--dir") ?? "~/handoff", windows: args.includes("--windows") || platform === "win32" };
  return { out: client.render(options), err: `${client.name} [${client.evidence}]: ${client.where}${client.checked ? `\nChecked: ${client.checked}` : ""}\nThe first start downloads the package; if the client reports a timeout, run \`npx -y ${PACKAGE} config --list\` once and restart the client.`, code: 0 };
}
