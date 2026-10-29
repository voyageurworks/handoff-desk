# Connecting your MCP client

`handoff-desk` is a stdio MCP server. Every client needs the same three things:

| Setting | Value |
| --- | --- |
| Command | `node` |
| Arguments | the absolute path to `dist/main.js` in your clone (for example `/home/you/handoff-desk/dist/main.js`; on Windows write `C:/Users/you/handoff-desk/dist/main.js` with forward slashes) |
| Environment | `HANDOFF_DIR`, the desk folder (see [the settings table](../README.md#settings) for the rest) |

Build first (`pnpm install && pnpm build`) and create the desk (`node dist/main.js init <desk folder>`). Restart the client after changing its config. The formats below were checked in October 2026; if your client's version differs, its own MCP documentation wins.

Keep secrets such as the mail app password out of these files: use `HANDOFF_ENV_FILE` or `HANDOFF_MAIL_PASSWORD_COMMAND` ([keeping-secrets.md](keeping-secrets.md)).

## Claude Code

```sh
claude mcp add handoff -e HANDOFF_DIR="$HOME/handoff" -- node /absolute/path/to/handoff-desk/dist/main.js
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

Or edit `~/.codex/config.toml` (the CLI and the IDE extension share it):

```toml
[mcp_servers.handoff]
command = "node"
args = ["/absolute/path/to/handoff-desk/dist/main.js"]

[mcp_servers.handoff.env]
HANDOFF_DIR = "/absolute/path/to/your/desk"
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

## Windsurf, Gemini CLI and others

Most other clients use the same `mcpServers` shape as Cursor:

- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Gemini CLI: `~/.gemini/settings.json`

If your client can run a stdio MCP server, give it the command, arguments and environment from the table at the top.

## Check that it works

Ask the client: "List my handoff items." You should get an empty list on a new desk. Then follow the [quick start](../README.md#quick-start-5-minutes-no-real-agent-needed) to hand over a first item and let the stand-in answer it.
