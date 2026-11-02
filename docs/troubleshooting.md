# Troubleshooting and FAQ

## The client shows no handoff tools

- Did you build? Run `npm install && npm run build` (or the pnpm equivalent) and check that `dist/main.js` exists.
- Is the path in the config **absolute** and correct? Relative paths break when the client starts from another folder. On Windows use forward slashes.
- Is Node 22 or newer on the client's `PATH`? Run `node --version`. A client started from a launcher may not see the Node you use in a terminal; put the full path to `node` in the command if needed.
- Restart the client after editing its config. Claude Code: `claude mcp list` shows whether the server connected.

## `claude mcp add` says "missing required argument"

You are probably in Windows PowerShell 5.1, which drops a bare `--`. Write it in quotes: `claude mcp add handoff -e HANDOFF_DIR="$HOME/handoff" '--' node C:/path/to/handoff-desk/dist/main.js`. On macOS and Linux shells the bare `--` is fine.

## A folder named `~` appeared

PowerShell, Command Prompt and JSON client configs do not expand a leading `~`. `handoff-desk` expands it itself in `HANDOFF_DIR`, `HANDOFF_MAIL_DIR`, `HANDOFF_ENV_FILE` and the `init` argument, so a stray `~` folder usually came from another tool. Delete it and use an absolute path there.

## `handoff_wait` times out

This is normal when the agent has not answered yet: the call waits up to 50 seconds. Call it again, or read the item later with `handoff_read`.

If the answer never comes, the agent probably has not noticed the note. Nothing here is instant: the agent has to see the note or email, do the task and write its reply. Check that:

1. The agent can read the desk (the folder, or the private git repository) and can write its reply back (and push it, for a cloud agent).
2. The doorbell is configured if your agent only reacts to email. Without it, an agent that checks the desk on a schedule only notices notes on its own schedule.
3. With git sync, the note actually reached the remote: `git log origin/main` in the desk folder shows a `Handoff:` commit.

To rule out the agent, run the stand-in (`node dist/main.js stand-in`) and hand it a question.

## "Refused: this item looks like it contains a password"

`handoff_send` and the agent's replies are checked for passwords, codes, tokens and keys before anything is written or emailed. It is pattern matching and can be wrong. Remove the secret from the request and describe it instead ("use the card on file"). Never paste credentials into a request.

## The doorbell does not ring

- **Telegram or Slack:** the `chat` part of the result names the problem without printing any secret. Telegram `401` is a wrong or revoked bot token; `400` or `403` usually means the bot has not been written to or added to that chat; Slack `404` or `410` means the webhook was deleted. A value that is not a bot token or a Slack incoming webhook is refused before anything is sent.

- `handoff_send` reports who was told in `notified` (`email`, `telegram`, `slack`) and why anyone was not: `ring` for the email, `chat` for Telegram and Slack. An empty `notified` means nobody has been told yet. "Doorbell not configured" means `HANDOFF_MAIL_USER`, `HANDOFF_MAIL_TO` and a password (`HANDOFF_MAIL_APP_PASSWORD` or `HANDOFF_MAIL_PASSWORD_COMMAND`) are not all set.
- With Gmail you need 2-Step Verification on and an **app password** from your Google account's security settings. Your normal password will not work and should never be used.
- Port 465 uses TLS. Any other port must support STARTTLS or the send is refused. The whole send is capped at 45 seconds.
- The note is always written even when the email fails; the result also includes the email so you can send it another way. A local copy goes to `mail/` (the result says if that copy could not be saved).

## Git sync

- **Sync did not turn on.** It needs the desk folder to be inside a git work tree whose branch has an upstream. Set `HANDOFF_SYNC=git` to turn a silent local-only desk into a clear error.
- **"Push failed" or the push is refused.** Your note is kept as a local commit and goes up with the next call (`handoff_send`, `handoff_read` or `handoff_wait`). Check your network and that your git credentials can push to the desk repository.
- **No commit identity.** If git has no name or email, the desk commits as `handoff-desk`. Set `HANDOFF_GIT_NAME` and `HANDOFF_GIT_EMAIL` to change it.
- **Your own edits ended up in `git stash`.** If your unsaved edits clashed with a new change, they are kept in `git stash` and the error says so. Run `git stash pop` to get them back.
- **A call took a minute.** On a network that swallows packets one git step can wait up to a minute. Run the call again; nothing is lost.

## `handoff_read` shows a warning about another note with the same number

Two senders filed the same item number at the same moment. The one that pushes second renames its own note on its next sync. Until then `handoff_read` shows the older note and names the other.

## FAQ

**Is anything sent to a server?** No. The only network traffic is what you configure: git pushes to your own private repository, and the optional email to your own mail server.

**Do I need git or email?** No. A plain local folder works. Git is for cloud agents, email is an optional doorbell.

**Can I use it with an agent that is not listed?** Probably. The contract is plain markdown: the agent reads a note with `status: waiting`, writes its answer under `## Reply` and sets `status: done`. See [cloud-agents.md](cloud-agents.md) and the [live acceptance checklist](live-acceptance.md).

**Where are my notes?** In the `Desk/` folder under `HANDOFF_DIR` (default `~/handoff`). They are plain text; delete a note to delete the item. With git, old versions stay in the repository history.

**Is it safe to point at a public repository?** No. Every task and reply is pushed to the remote. Use a **private** repository.

**How do I report a security problem?** See [SECURITY.md](../SECURITY.md).
