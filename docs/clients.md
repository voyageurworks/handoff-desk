# Connecting your MCP client

`handoff-desk` is a stdio MCP server. Every client needs the same three things:

| Setting | Value |
| --- | --- |
| Command | `node` |
| Arguments | the absolute path to `dist/main.js` in your clone (for example `/home/you/handoff-desk/dist/main.js`; on Windows write `C:/Users/you/handoff-desk/dist/main.js` with forward slashes) |
| Environment | `HANDOFF_DIR`, the desk folder (see [the settings table](../README.md#settings) for the rest) |

**Shortcut:** `npx -y @voyageurworks/handoff-desk config --client <name>` prints the block for your client with the right key and the Windows form (`--list` shows the clients and whether each form was verified or only follows the client's documentation). The table below is the same thing for a clone.

Build first (`npm install && npm run build`, or the pnpm equivalent) and create the desk (`node dist/main.js init <desk folder>`). Restart the client after changing its config. The formats below were checked in October 2026; if your client's version differs, its own MCP documentation wins.

Keep secrets such as the mail app password out of these files: use `HANDOFF_ENV_FILE` or `HANDOFF_MAIL_PASSWORD_COMMAND` ([keeping-secrets.md](keeping-secrets.md)).

## Claude Code

```sh
claude mcp add handoff -e HANDOFF_DIR="$HOME/handoff" -- node /absolute/path/to/handoff-desk/dist/main.js
```

In Windows PowerShell 5.1 write the double dash in quotes, because PowerShell drops a bare `--`:

```powershell
claude mcp add handoff -e HANDOFF_DIR="$HOME/handoff" '--' node C:/absolute/path/to/handoff-desk/dist/main.js
```

Check with `claude mcp list`. Remove with `claude mcp remove handoff`. Add `--scope user` to make it available in every project.

## Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "handoff": {
      "command": "node",
      "args": ["/absolute/path/to/handoff-desk/dist/main.js"],
      "env": { "HANDOFF_DIR": "/absolute/path/to/your/desk" }
    }
  }
}
```

## VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your workspace (or use the "MCP: Open User Configuration" command for all workspaces), then use Copilot in agent mode:

```json
{
  "servers": {
    "handoff": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/handoff-desk/dist/main.js"],
      "env": { "HANDOFF_DIR": "/absolute/path/to/your/desk" }
    }
  }
}
```

## Codex

With the Codex CLI:

```sh
codex mcp add handoff --env HANDOFF_DIR=/absolute/path/to/your/desk -- node /absolute/path/to/handoff-desk/dist/main.js
```

In Windows PowerShell 5.1 write the double dash in quotes (`'--'`), as for Claude Code above. Or edit `~/.codex/config.toml` (the CLI and the IDE extension share it):

```toml
[mcp_servers.handoff]
command = "node"
args = ["/absolute/path/to/handoff-desk/dist/main.js"]

[mcp_servers.handoff.env]
HANDOFF_DIR = "/absolute/path/to/your/desk"
```

Codex asks before it calls a tool that is not marked read-only, and `handoff_send` writes a note. In an interactive session you approve the call. In `codex exec` (approval policy `never`) the call is refused with "MCP tool call requires approval, but approval policy is never"; to let that one tool through without a prompt, add this to `config.toml` (tested with Codex 0.166.0, where a note was created and answered end to end):

```toml
[mcp_servers.handoff.tools.handoff_send]
approval_mode = "approve"
```

Codex can also be the **agent** that answers your notes, not only the client: point it at the desk folder (or the private desk repository) and give it the rules in [cloud-agents.md](cloud-agents.md).

## Claude Desktop

Add to `claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "handoff": {
      "command": "node",
      "args": ["/absolute/path/to/handoff-desk/dist/main.js"],
      "env": { "HANDOFF_DIR": "/absolute/path/to/your/desk" }
    }
  }
}
```

## Every other client

The quickest way for any client is to let handoff-desk print (or write) the settings:

```sh
npx -y @voyageurworks/handoff-desk config --list                 # every client and how sure we are of it
npx -y @voyageurworks/handoff-desk config --client opencode      # prints the block; the file to put it in goes to stderr
npx -y @voyageurworks/handoff-desk install --client gemini-cli   # dry run; add --write to edit the file (see below)
```

Each client has its own shape; the generator knows them (VS Code `servers`, Zed `context_servers`, OpenCode and Kilo Code `mcp` with the command as one array, Amp `amp.mcpServers`, Codex TOML, Continue and Goose YAML) and puts `cmd /c` before `npx` on Windows. The last column says what was actually run, never more.

| Client | Where it goes | `install` can write it | Evidence |
| --- | --- | --- | --- |
| Claude Code | `claude mcp add` (above) | no | verified, Windows |
| Gemini CLI | `~/.gemini/settings.json` | yes | verified: started and handshake completed (Gemini CLI 0.66.0, Windows; needs folder trust, else Gemini shows it Disabled) |
| OpenCode | `opencode.json` (project) or the global OpenCode config | no | verified: `opencode mcp list` showed it connected (1.19.5, Windows) |
| Kilo Code | `~/.config/kilo/kilo.jsonc` or `kilo.jsonc` / `.kilo/kilo.jsonc` in a project | no | verified with the Kilo CLI: `kilo mcp list` showed it connected (7.8.18, Windows); the editor extension was not run |
| Codex | `~/.codex/config.toml` | no | verified: `codex exec` started the server, completed the handshake and offered all 8 tools to a local stand-in model (0.166.0, Windows); Codex answering notes as the agent was not run |
| Cursor | `~/.cursor/mcp.json` | yes | documented |
| Kiro | `~/.kiro/settings/mcp.json` or `.kiro/settings/mcp.json` | yes | documented |
| Amp | `~/.config/amp/settings.json` (a workspace `.amp/settings.json` needs your approval in Amp) | yes | read back by `amp mcp list` (0.0.1793664053, Windows); that command does not start the server, and `amp mcp doctor` needs a login |
| LM Studio | `~/.lmstudio/mcp.json` | yes | documented |
| Claude Desktop | `claude_desktop_config.json` (Settings, Developer, Edit Config) | no | documented |
| Windsurf (Devin Desktop) | `~/.config/devin/mcp_config.json`, older `~/.codeium/windsurf/mcp_config.json` | no | documented |
| Warp | Settings, Agents, MCP servers, + Add, then paste the JSON | no | documented |
| Junie CLI (JetBrains) | `~/.junie/mcp/mcp.json` or `.junie/mcp/mcp.json`, or a folder passed with `--mcp-location` | no | verified: started the server, completed the handshake and offered the tools to a local stand-in model (1468.30, Windows; the JetBrains IDEs were not run, and its JVM ignores HOME and USERPROFILE, so set `JUNIE_HOME` when testing) |
| JetBrains AI Assistant | Settings, Tools, AI Assistant, Model Context Protocol (MCP), Add | no | documented; JetBrains' page shows `command` and `args`, and `env` is the common MCP key |
| Continue | `mcpServers:` in the `config.yaml` you pass to the CLI (`cn --config`), or `.continue/mcpServers/handoff.yaml` in the editor extension | no | verified with the Continue CLI: it started the server, completed the handshake and offered all 8 tools to a local stand-in model (1.5.47, Windows); the CLI did not read the folder file, and the editor extension was not run |
| Goose | `extensions:` in `config.yaml`, or Extensions, Add custom extension | no | verified: started the server, completed the handshake and offered the tools to a local stand-in model (1.57.0, Windows); the desktop app was not run |
| Zed | `context_servers` in Zed's settings file | no | documented |
| Cline, Roo Code, Amazon Q | see `config --client <name>` | no | documented |

"Documented" means the shape follows the client's own documentation and has not been run here. If one of them does not work for you, please open an issue with the client's name and version.

### `install`: let handoff-desk edit the file

`handoff-desk install --client <name>` adds the handoff entry to the client's own settings file. It is careful because it changes a file outside this project:

- **Dry run by default.** It prints the file it would change and only the handoff entry, never the rest of the file. `--write` makes the change.
- It adds one entry and leaves the rest of the file as it was (other servers, other settings, the indentation and the line endings), makes a timestamped backup first (never over an earlier one), and writes through a temporary file.
- It refuses what it cannot read exactly: comments or a trailing comma (so JSONC files), a link, a folder where the file should be. It stops if the file changes while it works.
- A `handoff` entry that is already there and differs is left alone unless you pass `--force`; then the command and arguments are updated and everything else in the entry, including secrets already in its `env`, is kept.
- It can edit Cursor, Gemini CLI, LM Studio, Kiro and Amp. For every other client it tells you to use `config`.

### Check your setup

`handoff-desk doctor` checks Node, the desk folder, `handoff.md`, git, and the email, Telegram and Slack settings, and says what to fix. It never prints a secret and never runs a `*_COMMAND` setting. `doctor --client cursor` reads the handoff entry's settings from that client's file (a terminal does not have the settings a client passes), and `doctor --ping` sends one clearly labelled test message to Telegram and Slack.

## Check that it works

Ask the client: "List my handoff items." You should get an empty list on a new desk. Then follow the [quick start](../README.md#quick-start-5-minutes-no-real-agent-needed) to hand over a first item and let the stand-in answer it.
