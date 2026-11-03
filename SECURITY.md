# Security

## What this server can touch

`handoff-desk` runs on your computer with your permissions. It reads and writes markdown notes in the desk folder you point it at, runs `git` there when syncing is on, and (if you configure it) sends one email per handoff through the mail account you give it.

It never sends passwords, codes or keys on your behalf: `handoff_send` refuses a request that looks like it contains one. Keep mail credentials out of your MCP client's config: use a private file (`HANDOFF_ENV_FILE`) or, better, `HANDOFF_MAIL_PASSWORD_COMMAND` so no file holds the password (see docs/keeping-secrets.md).

## What it defends against

- Notes the agent pushes: only regular files are read (no links or folders), file names are checked, and replies that look like they hold a password are refused.
- Git remotes: only `file`, `https` and `ssh` transports are allowed (never `ext::`, which runs a command), and tokens in a remote URL are removed from error messages.
- Prompt injection: tool descriptions tell the model that text from the agent is untrusted.
- Mail: port 465 uses TLS, other ports must upgrade with STARTTLS, and the send has a time limit.
- Telegram and Slack doorbells: the bot token and the Slack webhook are secrets that come from the environment or from your own command, and are never printed, logged or returned to the assistant. Slack accepts only an `https://hooks.slack.com/services/...` webhook (parsed, not prefix-matched: no credentials, no port) and Telegram talks only to `api.telegram.org`; neither follows redirects. The test endpoint `HANDOFF_CHAT_TEST_ENDPOINT` accepts only plain `http` to a loopback address and is for tests.
- Retry list for failed chat messages: it keeps only a pointer (note number, channels, attempt count, next try), never the message or a secret, in a folder outside the desk and its git history. Only failures that can pass (network, timeout, 429, 5xx) are retried, at most five times or three days.
- `install --client`: a dry run unless you add `--write`. It edits only the strict JSON settings file of a client under your home folder, makes a backup first, writes atomically, and refuses a symbolic link, a folder, a file with comments or one that changed meanwhile.
- `doctor`: never prints a secret and never runs a `*_COMMAND` setting; `--ping` sends one labelled test message to Telegram and Slack only, never email.
- Notes name their sender in the `from:` line (`claude-code`, `cursor`, `codex`, or the client's own name) taken from the MCP handshake and reduced to a few safe characters so it cannot add lines to a note. It is information, not proof of who sent the note.
- Supply chain: CI runs with read-only permissions and every action pinned to a commit, a dependency audit and a full-history secret scan, Dependabot, and CodeQL. Each npm release is built by GitHub Actions with provenance, and both the npm publish and the MCP Registry publish wait for a named person to approve them after the tarball is checked.

## Reporting a problem

Please do not open a public issue that describes a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). If that button is not there, open an issue that says only that you have a security report and asks for a private way to send it, with no details. Include what you did, what you expected and what happened once you have a private channel. No secrets, please.

## Good practice

- Make the desk repository private. Notes are plain text and stay in git history.
- Treat anything an agent writes into a note as untrusted input.
- Use an app password for the doorbell mailbox, never your main account password.
