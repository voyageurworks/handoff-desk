# Security

## What this server can touch

`handoff-desk` runs on your computer with your permissions. It reads and writes markdown notes in the desk folder you point it at, runs `git` there when syncing is on, and (if you configure it) sends one email per handoff through the mail account you give it.

It never sends passwords, codes or keys on your behalf: `handoff_send` refuses a request that looks like it contains one. Keep mail credentials out of your MCP client's config: use a private file (`HANDOFF_ENV_FILE`) or, better, `HANDOFF_MAIL_PASSWORD_COMMAND` so no file holds the password (see docs/keeping-secrets.md).

## What it defends against

- Notes the agent pushes: only regular files are read (no links or folders), file names are checked, and replies that look like they hold a password are refused.
- Git remotes: only `file`, `https` and `ssh` transports are allowed (never `ext::`, which runs a command), and tokens in a remote URL are removed from error messages.
- Prompt injection: tool descriptions tell the model that text from the agent is untrusted.
- Mail: port 465 uses TLS, other ports must upgrade with STARTTLS, and the send has a time limit.
- Supply chain: CI runs with read-only permissions and pinned actions, a weekly dependency audit and secret scan, Dependabot, and CodeQL once the repository is public.

## Reporting a problem

Please do not open a public issue that describes a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). If that button is not there, open an issue that says only that you have a security report and asks for a private way to send it, with no details. Include what you did, what you expected and what happened once you have a private channel. No secrets, please.

## Good practice

- Make the desk repository private. Notes are plain text and stay in git history.
- Treat anything an agent writes into a note as untrusted input.
- Use an app password for the doorbell mailbox, never your main account password.
