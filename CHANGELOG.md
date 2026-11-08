# Changelog

## Unreleased

- Tests only: `src/freeRunners.test.ts` fails if a workflow uses a runner label that is not on the free list (larger, GPU, self-hosted or unknown runners could be billed), so the CI stays within GitHub's free tier.

- CI only: the `macOS monthly report` workflow also writes its facts (fixed words and numbers) to `status.json` on the `macos-report` branch, so an automatic reviewer can read them without the GitHub API.

## 1.2.2 (2026-11-04)

No change to the program. This release brings the packaged README and docs up to date with the repository (setup, security and macOS testing notes), and the CI changes below.

- CI only: a new `macOS monthly report` workflow runs on the 1st of each month and posts the facts (macOS jobs passed, failed or without a runner, and any run where macOS was not verified) as a comment on the macOS tracking issue, with a status and a recommendation. A recommendation to close the issue needs runs spanning 60 days.

- CI only: macOS moved out of the push CI into its own workflow (`macos.yml`: pull requests, weekly, on demand; Intel and Apple silicon, Node 22 and 24, the quick start under bash and zsh, plus macOS 26) with one required check, `macOS result`. A macOS job that ran and failed blocks the merge; if GitHub assigns no Mac at all, the check passes with a visible warning that macOS was not verified, so a runner shortage no longer marks every push as failed or forces an administrator override. The `CI retry` workflow stays but no longer has macOS jobs to re-run.

- CI only: a small `CI retry` workflow re-runs, once, the macOS jobs that GitHub cancelled before they got a runner. A job that started and failed is never re-run.
- CI only: macOS jobs run on both Apple silicon (`macos-latest`, macOS 26) and Intel (`macos-15-intel`). GitHub's Apple-silicon pool sometimes has no free runner and cancels the job ("not acquired by Runner"); rerun it when that happens.
- Docs only: `docs/chat-doorbells.md`, a step-by-step setup for the Telegram and Slack doorbells (private secrets file, finding the chat id, creating the Slack webhook, checking it, what each refusal means).
- Docs only: the chat doorbells are now tested live as well (Telegram and Slack on Windows 11 and Linux, Telegram on macOS 15 Intel); the README lists what was not tested live.
- Docs only: Kiro, Warp, the JetBrains IDEs and Zed are listed as "not supported yet" (not tested) in `README.md` and `docs/clients.md`, and are out of the main client lists. Their `config` and `install` output is unchanged.
- Docs only: `SECURITY.md` now covers the chat doorbells, the retry list, `install`, `doctor` and the `from:` line; a one-line-each table for Claude Code, Cursor and Codex at the top of `docs/clients.md`; the agent contract page explains the `from:` values. Checked on Node 24.20 with deprecation warnings turned into errors: the server, the CLI commands and all 354 tests run clean.

## 1.2.1 (2026-11-03)

- Codex 0.166.0 is now `verified` in `config --list`: `codex exec` started the server from our config, completed the handshake and offered all 8 tools to a local stand-in model (Windows 11). Only Amp stays at `read`. Goose 1.57.0 is now `verified` too, and the Junie CLI 1468.30 is a new `junie-cli` entry (21 clients), both with the server started and the handshake completed from our config (Windows 11, throwaway folders, local stand-in models; the JetBrains IDEs and the Goose app were not run). Codex, scripted to call `handoff_send`, created a note that the stand-in agent answered and `handoff_read` returned; Codex needs that call approved (docs added).
- **Notes say which client sent them**: `from:` was always `claude-code`; it now comes from the MCP client's own name (`claude-code`, `cursor`, `codex`, or the client's own name), reduced to safe characters so it cannot add lines to a note's front matter. Checked with the real Codex 0.166.0 (`from: codex`). The agent contract says `from` is information, not proof of who sent a note.
- **Claude Code, Cursor and Codex are named everywhere**: the package, registry and Cursor plugin descriptions, and a README section that says what has been run for each (Claude Code and Codex: the real client; Cursor: config and install tested, the Cursor app itself not run).
- **Codex needs the send call approved**: documented in `docs/clients.md` and `docs/troubleshooting.md` (an interactive session asks; `codex exec` refuses unless `[mcp_servers.handoff.tools.handoff_send]` has `approval_mode = "approve"`).
- **Cursor directory**: `.cursor-plugin/plugin.json` in the repository (name, description, logo, keywords) for cursor.directory; it is not part of the npm package, and a test keeps its version in step with `package.json`.
- Tests: the YAML that `config` prints for Continue and Goose is parsed with a real YAML parser (dev dependency `yaml`), including awkward folder names; the client count is no longer hard-coded.

## 1.2.0 (2026-11-03)

- **Seven more clients in `config`**, 20 in all: Continue, Goose, JetBrains AI Assistant, Kilo Code, Kiro, Amp and Warp, each from the client's own documentation (Continue and Goose print YAML, Amp uses the dotted `amp.mcpServers` key, Kilo Code the OpenCode-style `mcp` shape).
- **Checked against real clients** (installed from npm into a throwaway folder, in a throwaway home, never logged in): Gemini CLI 0.66.0, OpenCode 1.19.5, the Kilo CLI 7.8.18 and the Continue CLI 1.5.47 started the server from the config we print (a logging wrapper confirmed each started it and completed the MCP handshake; Gemini needed its folder-trust check off in the throwaway home, else it reports the server Disabled); Continue also offered all 8 tools to a local stand-in model, and only its `config.yaml` `mcpServers` list loads in the CLI (not the `.continue/mcpServers` folder file, which is for the editor extension); Codex 0.166.0 and Amp 0.0.1793664053 read our config back correctly (neither command starts the server, and Amp's own check needs a login). New evidence level `read`, and each line says exactly what was run. All on Windows 11; macOS and Linux were not run.
- **`handoff-desk install --client <name>`** adds the server to a client's own settings file (Cursor, Gemini CLI, LM Studio, Kiro, Amp): dry run unless `--write`, one entry added and the rest of the file untouched, a backup first, refuses comments, links and folders, atomic write, stops if the file changed meanwhile, `--force` updates command and args and keeps the entry's other settings including secrets.
- **`handoff-desk doctor`** checks Node, the desk, `handoff.md`, git and the email, Telegram and Slack settings and says what to fix; `--client` reads a client's own settings file, `--ping` sends one labelled test message to Telegram and Slack. It never prints a secret or runs a `*_COMMAND`.
- **Retry list for chat doorbells**: a Telegram or Slack message that failed for a reason that can pass (network, timeout, 429, 5xx) is re-sent when the server starts and on the next send, with growing waits, up to 5 times or 3 days, marked `Re-sent`, and dropped if the note was answered. Only a pointer to the note is stored, on this computer, outside the desk and git (`HANDOFF_STATE_DIR`). `handoff_send` returns `resent` when something was re-sent.
- **Agent contract**: `templates/agent-skill/SKILL.md` (see docs/agent-contract.md), the rules for the agent that answers notes, pinned by a test to the real note parser.
- `config` now tells you that the first start downloads the package and what to do if a client times out (seen with Gemini CLI on a cold cache).
- Tests: the built program against a local stand-in for Telegram and Slack (`HANDOFF_CHAT_TEST_ENDPOINT`, loopback `http` only; see CONTRIBUTING.md): the exact requests, 429, 500, a dropped connection, nothing listening, no secret in any output. Not yet against live Telegram or Slack accounts. CI passed on Linux, macOS and Windows (Node 22 and 24).

## 1.1.0 (2026-11-02)

- **Optional Telegram and Slack doorbells**, next to the email one (off unless their settings are set): a short message when a note is created. By default it carries only the id, type, title and note name, not the request (`HANDOFF_NOTIFY_INCLUDE_REQUEST=1` adds a shortened request). The bot token and the Slack webhook are secrets: environment or the user's own command, never printed or returned; only `https://hooks.slack.com/services/...` webhooks are accepted and Slack mentions in a title are neutralised. Tested against the services' documented request format with a fake network, not against live accounts.
- `handoff_send` now returns `notified`, the list of doorbells that actually rang (`email`, `telegram`, `slack`), and a `chat` object when a chat doorbell is configured. The tool description tells the assistant to read it.
- **`handoff-desk config --client <name>`** prints the settings block for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI, Codex, LM Studio, Cline, Roo Code, Amazon Q, Zed and OpenCode (VS Code, Zed, Codex and OpenCode use different shapes; Windows gets `cmd /c`), and `--list` shows which forms were verified and which follow the client's documentation (only Claude Code's Windows form was run against a real client; the rest follow each client's documentation). A ready-made `mcp.json` is in the repository.
- The new settings are listed in `server.json` (the secrets marked as secret).

## 1.0.3 (2026-11-02)

- Fix: the server told MCP clients it was version 1.0.0 whatever was installed. It now reports the real package version (a test checks it).
- Ready for the official MCP Registry: `mcpName` in package.json and a `server.json` (a test keeps their name and version in step); `glama.json` for the Glama directory.
- README: a 30-second picture of how a handoff works, and a quick start that needs no clone or build (`npx`). Building from source is still documented.
- Issue forms instead of plain templates, and Discussions for questions.

## 1.0.2 (2026-11-02)

- Version 1.0.1 was tagged but never published to npm (its release job failed before the publish step), so 1.0.2 is the first version published from GitHub Actions.

- Releases now go through a two-job workflow with an approval step, and are published from GitHub Actions with a provenance statement (npm trusted publishing). No change to the server itself.
- More search keywords in `package.json`; the npm page and badges are fixed.

## 1.0.0 (2026-11-01)

- Published to npm as `@voyageurworks/handoff-desk` (the first version was published by hand, so it has no provenance badge).

- A leading `~` in `HANDOFF_DIR`, `HANDOFF_MAIL_DIR`, `HANDOFF_ENV_FILE` and the `init` argument is expanded to the home folder. PowerShell, Command Prompt and JSON configs do not expand it, which used to create a folder literally named `~`.
- CI now also runs on macOS, runs the quick start under bash and zsh on Linux and macOS, and launches the server from every config example in docs/clients.md.

- Documentation: rewritten README with a five-minute quick start, per-client setup (Claude Code, Cursor, VS Code, Codex, Claude Desktop, others), architecture, troubleshooting and FAQ; a test keeps the examples and links valid.

- Community files: issue and pull request templates, code of conduct.

- `handoff_read` on a number that two notes share shows the older note and a `warning` naming the other.
- The tool result of `handoff_send` now says (`emailCopyError`) when the local copy of the email could not be saved, instead of staying silent.
- When git has no name or email configured anywhere, the desk commits as `handoff-desk` instead of failing.
- Security hardening: git transports limited to file, https and ssh; tokens in remote URLs scrubbed from errors; tool descriptions mark the agent's text as untrusted; CI pinned and read-only; security workflow and Dependabot added.
- New `HANDOFF_MAIL_PASSWORD_COMMAND`: the doorbell can fetch the mail password by running a command (password manager, encrypted file) instead of reading it from a file. See docs/keeping-secrets.md.
- MCP server with `handoff_send`, `handoff_status`, `handoff_list`, `handoff_read`, `handoff_wait`, `handoff_capabilities`, `handoff_inbox`, `handoff_inbox_reply`.
- Folder desk, or a private git repository for cloud agents (pull with rebase, push, one retry, stale reads when offline).
- Optional doorbell email (SMTP, 20 s per step) with a local copy of each email.
- `HANDOFF_ENV_FILE` for keeping mail credentials out of client configs.
- Duplicate-number guard: if two senders file the same item number, the second one renames its own note.
- A refused or failed push keeps the note and delivers it on the next call.
- Checked once against a real cloud agent over git and email (five rounds).

Fixes from the first audit:

- When the user's own unsaved edits clash with new changes while a conflicted change is dropped, they stay in `git stash` and the error now says so.
- A dropped conflicted change no longer discards the user's other uncommitted edits.
- Desk and Inbox read only regular files; links and folders named like notes are skipped.
- The settings file now also supplies the git identity and time zone; an unreadable settings file is named on stderr.
- Mail on any port but 465 must upgrade with STARTTLS; the whole send is capped at 45 s.
- The lock is removed only by its owner, and a dead lock is broken by one waiter only.
- The secret filter no longer rejects ordinary status lines such as "tests pass: 42/42".
- A retried inbox reply that contains headings is no longer added twice.
