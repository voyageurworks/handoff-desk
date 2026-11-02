# Changelog

## 1.1.0 (2026-11-02)

- **Optional Telegram and Slack doorbells**, next to the email one (off unless their settings are set): a short message when a note is created. By default it carries only the id, type, title and note name, not the request (`HANDOFF_NOTIFY_INCLUDE_REQUEST=1` adds a shortened request). The bot token and the Slack webhook are secrets: environment or the user's own command, never printed or returned; only `https://hooks.slack.com/services/...` webhooks are accepted and Slack mentions in a title are neutralised. Tested against the services' documented request format with a fake network, not against live accounts.
- `handoff_send` now returns `notified`, the list of doorbells that actually rang (`email`, `telegram`, `slack`), and a `chat` object when a chat doorbell is configured. The tool description tells the assistant to read it.
- **`handoff-desk config --client <name>`** prints the settings block for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI, Codex, LM Studio, Cline, Roo Code, Amazon Q and Zed (VS Code, Zed and Codex use different keys; Windows gets `cmd /c`), and `--list` shows which forms were verified and which follow the client's documentation (only Claude Code's Windows form was run against a real client; the rest follow each client's documentation). A ready-made `mcp.json` is in the repository.
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
