# handoff-desk

Hand tasks from Claude Code or Cursor to a personal agent, from inside your coding session, and read the answer back.

`handoff-desk` is a small MCP server that runs on your computer. When you say "hand this to my agent", it writes a markdown note into a folder you own, optionally emails the agent a heads-up, and later reads the agent's reply from the same note. There is no hosted service, no account and no telemetry.

Status: early (0.1). Tested with the bundled stand-in agent, and on 2026-10-26 with a real cloud agent over git and email (five acceptance rounds, all passed).

## How it works

```
Claude Code / Cursor  --MCP (stdio)-->  handoff-desk  -->  <your desk folder>/Desk/<date> Item 01 - <title>.md
                                                     \-->  optional email to your agent's mailbox
your agent reads the note (or the email), does the task, writes its answer under "## Reply" and sets status: done
handoff_wait / handoff_read  <--  the reply, back in your coding session
```

Your desk folder (`HANDOFF_DIR`, default `~/handoff`):

| Path | What it is |
| --- | --- |
| `handoff.md` | Your rules for the agent: who you are, what it may do alone, what it must ask first, what it must never do |
| `Desk/` | One note per handoff |
| `Inbox/` | Notes your agent leaves for Claude; Claude answers under them |
| `mail/` | Copies of the doorbell emails |

## Install

From a clone (until it is published to npm):

```sh
pnpm install && pnpm build
```

1. **Step one: create your rules file.** Run `node dist/main.js init` (or `npx handoff-desk init` once published). It creates the folders and a `handoff.md` template. Open `handoff.md` and fill it in. Running `init` again never overwrites your edits.
2. **Add the server to your client.** For Claude Code:

   ```sh
   claude mcp add handoff -e HANDOFF_DIR="$HOME/handoff" -- node /path/to/handoff-desk/dist/main.js
   ```

   For Cursor, add the same command and environment to `mcp.json`.
3. **Connect your agent.**
   - **An agent running on the same computer** can read the `Desk/` folder directly.
   - **A cloud agent** cannot see your folder, so make the desk a **private git repository** the agent can read and push to. Put the desk folder inside a clone of that repository; syncing turns on by itself (`HANDOFF_SYNC=auto`) when the folder is a git work tree with an upstream branch. Each send is committed and pushed, each read pulls, and the agent's pushed reply shows up in `handoff_read` / `handoff_wait`. Details, the exact note format and the rules to give the agent are in [docs/cloud-agents.md](docs/cloud-agents.md).
   - Either way, the optional doorbell email carries the whole request to an agent that watches a mailbox.

## Use

Ask Claude: "Hand this to my agent: book the dentist for Friday at 3." Claude calls `handoff_send`, then `handoff_wait` or `handoff_read` to get the reply.

| Tool | What it does |
| --- | --- |
| `handoff_send` | Errand, question or status for the agent (note plus optional doorbell email) |
| `handoff_status` | One-line status update |
| `handoff_list`, `handoff_read` | See items and read one in full |
| `handoff_wait` | Wait up to 50 seconds for the agent's answer (call again to keep waiting) |
| `handoff_capabilities` | What your `handoff.md` says the agent may do alone, must ask first, or never do |
| `handoff_inbox`, `handoff_inbox_reply` | Read and answer notes the agent left for Claude |

If no doorbell is configured, `handoff_send` still writes the note and returns the email it would have sent, so Claude can send it another way.

## Settings

Set these as environment variables in your MCP client's config.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HANDOFF_DIR` | `~/handoff` | Desk folder |
| `HANDOFF_MAIL_USER` | none | Sender address for the doorbell |
| `HANDOFF_MAIL_APP_PASSWORD` | none | App password for that sender (never your normal password) |
| `HANDOFF_MAIL_PASSWORD_COMMAND` | none | A command that prints the app password, run only when a doorbell is sent, so no file holds it (password manager, encrypted store; see docs). Used when `HANDOFF_MAIL_APP_PASSWORD` is not set |
| `HANDOFF_ENV_FILE` | none | Path to a private file of `NAME=value` lines (any setting in this table). Keeps the app password out of your MCP client's config. Real environment values win over the file. Keep the file outside the desk repository and readable only by you |
| `HANDOFF_MAIL_TO` | none | The agent's mailbox |
| `HANDOFF_SMTP_HOST`, `HANDOFF_SMTP_PORT` | `smtp.gmail.com`, `465` | Mail server |
| `HANDOFF_MAIL_DIR` | `<HANDOFF_DIR>/mail` | Where email copies go |
| `HANDOFF_TZ` | system zone | Time zone for timestamps |
| `HANDOFF_SYNC` | `auto` | `auto`: sync through git when `HANDOFF_DIR` is a work tree with an upstream. `git`: require it (an error otherwise). `off`: local folder only |
| `HANDOFF_REMOTE` | none | Clone this repository into `HANDOFF_DIR` the first time a desk tool is used |
| `HANDOFF_GIT_NAME`, `HANDOFF_GIT_EMAIL` | the repository's git config, else `handoff-desk` | Identity for the desk's commits |
| `HANDOFF_INBOX_DIR` | `Inbox` | Folder where the agent leaves notes for Claude |
| `HANDOFF_SUBJECT_PREFIX` | `Handoff` | Subject of the doorbell email: `[<prefix> errand #3] ...` |

## Try it without a real agent

```sh
node dist/main.js stand-in        # answers every waiting item with a fixed line
```

Run it in a second terminal, hand something over from your client, and watch the note flip to `done`. `stand-in --once` answers what is waiting and exits.

To rehearse the cloud path, clone your private desk repository a second time, set `HANDOFF_DIR` to that second clone and run `node dist/main.js stand-in --git`. It reaches the desk only through the git remote, like a cloud agent would.

## Safety

- Anything that looks like a password, code, token or key is refused before it is written or emailed. This is pattern matching, not a guarantee: do not put secrets in requests.
- Use a **private** repository for a git-synced desk. Every task and reply is pushed to its remote and kept in its history.
- Do not put an access token inside `HANDOFF_REMOTE` (a URL like `https://token@host/...`): git stores the URL in plain text in the clone's config. Use your normal git credential helper or an SSH key instead.
- Your agent acts with your authority, and some agents act on your behalf in ways that bind you. Read `handoff.md` before relying on it, and keep the "ask first" and "never" lists honest.
- Text from web pages or emails is not your instruction. Say so in your `handoff.md` (the template does).
- Check your agent's own terms of service before you automate anything around it: many restrict automation, minimum age or commercial use.

## Limits

- There is no hosted mode and no push notification in 0.1. A cloud agent reaches the desk through git (see above); nothing else carries its reply back.
- The agent must be able to read the desk (folder, or git repository) or the doorbell email, and to write its reply into the note (and push it, for a cloud agent). If it cannot, `handoff_wait` times out.
- Nothing here is instant: the agent has to notice the note or email, do the task, and push.
- One real cloud agent has been tried so far (five rounds on 2026-10-26: an errand, a question, a status line, a request that needed approval and was declined, and a page with an injected instruction that was ignored). Other agents are untested. [docs/live-acceptance.md](docs/live-acceptance.md) is the checklist for trying yours.
- On a network that swallows packets, one git step can take up to a minute before it gives up, so a call can run longer than your client allows. Run it again: nothing is lost, and a note that was committed goes up with the next call.
- If two senders file the same item number at the same moment, the one that pushes second renames its own note. For a short time the remote can hold both under one number; `handoff_read` then shows the older note with a `warning`.
- Notes are plain text on your disk and, with git, in your repository's history; anyone with access can read them.

## Development

`pnpm test` runs the suite, including an end-to-end test over real stdio and a guard that fails if personal data lands in the repo. `pnpm check` type-checks.

## License

MIT
