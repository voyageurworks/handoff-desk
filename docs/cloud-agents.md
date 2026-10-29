# Working with a cloud agent

A cloud agent cannot see a folder on your computer. `handoff-desk` therefore uses a **private git repository** as the shared desk: your computer pushes each task as a note, the agent reads it, writes its answer into the same note, and pushes. Your next `handoff_read` or `handoff_wait` pulls the answer.

```
your computer (handoff-desk)  --push-->  private repo  <--pull/push--  cloud agent
                                    note: status: waiting           answers, status: done
```

## Setup

1. Create a **private** repository (for example on GitHub) and clone it on your computer. Notes are pushed to its remote, so a public repository would publish your tasks.
2. Run `handoff-desk init <path to the clone>` and edit `handoff.md`. Commit and push it.
3. In your MCP client, set `HANDOFF_DIR` to the clone. With the default `HANDOFF_SYNC=auto`, syncing turns on by itself when that folder is a git work tree with an upstream branch. Use `HANDOFF_SYNC=git` to make a missing repository an error instead of a silent local-only desk.
4. Give the agent read and write access to the same repository, and tell it the rules below.

Optional: set `HANDOFF_REMOTE` to a repository URL and the server clones it into `HANDOFF_DIR` the first time a desk tool is used (useful in a cloud session).

## What the agent must do

For each note in `Desk/` whose front matter says `status: waiting`:

1. Read the request under `## Request`.
2. Write the answer under `## Reply`.
3. Change `status: waiting` to `status: done` (or `declined` if it will not do it, or `info` for a status line).
4. Set `answered:` to the time it finished.
5. Commit only that note and push.

It may also leave notes for Claude in the inbox folder (`Inbox/` by default, `HANDOFF_INBOX_DIR` to change it). Claude answers under them with `handoff_inbox_reply`.

It must never write passwords, codes or keys into a note.

## The note format

```markdown
---
id: 7
type: errand
from: claude-code
status: waiting
created: 2026-01-15T12:00:00-05:00
answered:
tags: [handoff]
---

# Book the dentist

## Request

Friday at 3, any clinic near the office.

Reply by: Thursday

## Reply

```

After the agent answers, `status` is `done`, `answered` has a time, and the text under `## Reply` is the answer. The reader accepts any capitalisation of the status, CRLF line endings, a byte-order mark, sub-headings and rules inside the reply, and trailing spaces. These cases are pinned by `src/contract.test.ts`.

File names look like `2026-01-15 Item 07 - Book the dentist.md`. The agent should not rename or move notes.

## The email heads-up

If you configure the doorbell (`HANDOFF_MAIL_USER`, `HANDOFF_MAIL_APP_PASSWORD`, `HANDOFF_MAIL_TO`), every send also emails the agent. The subject is `[Handoff errand #7] Book the dentist` (`HANDOFF_SUBJECT_PREFIX` changes the word `Handoff`), and the body carries the whole request and the note's path, ending with the instruction to answer under `## Reply`, set the status, then commit and push. An agent that watches a mailbox can act on the email alone, then write its reply into the note.

Tell the agent to act only on emails sent from your own address, and to treat anything else as untrusted.

## When things go wrong

| Situation | What happens |
| --- | --- |
| The remote cannot be reached when you send | The send is refused and nothing is written. |
| The remote disappears between the pull and the push | The note stays committed on your computer, you are told so, and the next call delivers it. |
| The remote cannot be reached when you read | You get the local copy with a `stale` message saying why. |
| You and the agent edit the same lines of one note at once | Your change is dropped with a message to read the note again and redo it. Nothing is left half-merged. |
| You have uncommitted edits to a tracked file (say `handoff.md`) | They are stashed around each pull and put back. Only if they conflict with what was just pulled does the call stop; the edits then wait in `git stash`, nothing is lost, and the next call works. |
| Two sessions use the same clone | A lock inside `.git` makes them take turns, so item numbers never collide. |

## Timing

Nothing here is instant. The agent has to notice the note or the email, do the task, and push. Use `handoff_wait` (up to 50 seconds a call; call it again to keep waiting), or come back later and `handoff_read`.
