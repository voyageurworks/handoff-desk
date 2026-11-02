/**
 * `handoff-desk config --client <name>`: the settings block for each MCP client, from one table.
 *
 * Most clients take the same JSON under `mcpServers`; a few differ (VS Code `servers`, Zed `context_servers`, Codex TOML), and
 * Windows needs `npx` run through `cmd /c`. `evidence` is honest: "verified" means the exact output was run against that client;
 * "documented" means the shape comes from the client's own documentation (or a dated roundup of it) and was not run here.
 * See docs/projects/handoff-mcp/agent-platform-research.md in the maintainers' notes for sources and dates.
 */
export const PACKAGE = "@voyageurworks/handoff-desk";

export type ClientOptions = { dir: string; windows: boolean };
export type ClientSpec = {
  id: string;
  name: string;
  evidence: "verified" | "documented";
  /** Where the text goes, in words. Printed on stderr so stdout stays pasteable. */
  where: string;
  render(options: ClientOptions): string;
};

const launch = ({ windows }: ClientOptions) => (windows ? { command: "cmd", args: ["/c", "npx", "-y", PACKAGE] } : { command: "npx", args: ["-y", PACKAGE] });
const entry = (options: ClientOptions) => ({ ...launch(options), env: { HANDOFF_DIR: options.dir } });
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const under = (key: string) => (options: ClientOptions) => json({ [key]: { handoff: entry(options) } });
// A JSON string is a valid TOML basic string for the text used here (escapes backslashes and quotes the same way).
const toml = (value: string) => JSON.stringify(value);

export const CLIENTS: ClientSpec[] = [
  {
    id: "claude-code", name: "Claude Code", evidence: "verified",
    where: "Run this command in a terminal. Verified on Windows (PowerShell, with the quoted double dash and cmd /c); the macOS and Linux form follows Claude Code's documented syntax and was not run here.",
    render: options => options.windows
      ? `claude mcp add handoff -e HANDOFF_DIR="${options.dir}" '--' cmd /c npx -y '${PACKAGE}'\n`
      : `claude mcp add handoff -e HANDOFF_DIR="${options.dir}" -- npx -y ${PACKAGE}\n`,
  },
  { id: "claude-desktop", name: "Claude Desktop", evidence: "documented", where: "claude_desktop_config.json (Settings, Developer, Edit Config). Local servers only; restart the app.", render: under("mcpServers") },
  { id: "cursor", name: "Cursor", evidence: "documented", where: "~/.cursor/mcp.json for all projects, or .cursor/mcp.json in one project.", render: under("mcpServers") },
  {
    id: "vscode", name: "VS Code (GitHub Copilot agent mode)", evidence: "documented",
    where: "Command palette: MCP: Open User Configuration (mcp.json), or .vscode/mcp.json in one project. VS Code's key is `servers`.",
    render: options => json({ servers: { handoff: { type: "stdio", ...entry(options) } } }),
  },
  { id: "windsurf", name: "Windsurf (Devin Desktop)", evidence: "documented", where: "~/.config/devin/mcp_config.json (Windows %APPDATA%\\devin\\mcp_config.json); older versions: ~/.codeium/windsurf/mcp_config.json.", render: under("mcpServers") },
  { id: "gemini-cli", name: "Gemini CLI", evidence: "documented", where: "~/.gemini/settings.json for all projects, or .gemini/settings.json in one project.", render: under("mcpServers") },
  {
    id: "codex", name: "Codex (CLI and IDE)", evidence: "documented",
    where: "~/.codex/config.toml (or .codex/config.toml in a trusted project), or `codex mcp add handoff -- <command>`.",
    render: options => {
      const { command, args } = launch(options);
      return `[mcp_servers.handoff]\ncommand = ${toml(command)}\nargs = [${args.map(toml).join(", ")}]\n\n[mcp_servers.handoff.env]\nHANDOFF_DIR = ${toml(options.dir)}\n`;
    },
  },
  { id: "lm-studio", name: "LM Studio", evidence: "documented", where: "~/.lmstudio/mcp.json (Program tab, Install, Edit mcp.json).", render: under("mcpServers") },
  { id: "cline", name: "Cline", evidence: "documented", where: "cline_mcp_settings.json (MCP Servers icon, Configure tab, Configure MCP Servers).", render: under("mcpServers") },
  { id: "roo-code", name: "Roo Code", evidence: "documented", where: "MCP settings, Edit Global MCP, or .roo/mcp.json in one project (the project file wins).", render: under("mcpServers") },
  {
    id: "opencode", name: "OpenCode", evidence: "documented",
    where: "opencode.json or opencode.jsonc (your project root or your global OpenCode config). OpenCode's key is `mcp`, a local server's command is one array, and the environment key is `environment`.",
    render: options => json({ $schema: "https://opencode.ai/config.json", mcp: { handoff: { type: "local", command: [launch(options).command, ...launch(options).args], enabled: true, environment: { HANDOFF_DIR: options.dir } } } }),
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
  return { out: client.render(options), err: `${client.name} [${client.evidence}]: ${client.where}`, code: 0 };
}
