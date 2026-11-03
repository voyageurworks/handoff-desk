# Setting up the Telegram and Slack doorbells

Both are optional and send one short message when a note is created ([README, Chat doorbells](../README.md#chat-doorbells-telegram-and-slack)). Nothing typed into the chat is read back. This page is the full setup, step by step. It was followed end to end with a new bot and a new Slack workspace on Windows 11 and Linux (version 1.2.1); the Slack screens may change over time.

Keep the bot token and the webhook URL secret. Anyone who has them can post as your bot or to your channel.

## 1. Keep the secrets in a private file

Make a plain text file outside any repository, readable only by you, with one `NAME=value` per line:

```
HANDOFF_TELEGRAM_BOT_TOKEN=<token from BotFather>
HANDOFF_TELEGRAM_CHAT_ID=<your chat id>
HANDOFF_SLACK_WEBHOOK_URL=<webhook url from Slack>
```

Point `HANDOFF_ENV_FILE` at it in your MCP client's config (the path only, never the secrets). On Windows, for example `C:\Users\you\.handoff-secrets.env`; to lock it to your user: `icacls "C:\Users\you\.handoff-secrets.env" /inheritance:r /grant:r "%USERNAME%:(R,W)"`. On macOS and Linux: `chmod 600 ~/.handoff-secrets.env`. For no file at all, use the `*_COMMAND` settings in [keeping-secrets.md](keeping-secrets.md).

## 2. Telegram

1. In Telegram, open a chat with **@BotFather** and send `/newbot`. Pick a name and a username that ends in `bot`. BotFather replies with a token that looks like `123456789:ABC...`.
2. Open your new bot (the `t.me/<username>` link BotFather gives you), tap **Start**, and send it any message such as `hi`. A bot cannot message you until you have written to it first. (For a group, add the bot to the group and send a message there.)
3. Find your chat id. In a browser, open `https://api.telegram.org/bot<TOKEN>/getUpdates` with your own token in place of `<TOKEN>` and read `message.chat.id` in the answer. A private chat is a positive number; a group's starts with `-`. This page contains your token in its address, so do not paste it or its address into an issue, a chat or an AI assistant.
4. Put the token and the id in the private file (step 1).

## 3. Slack

1. If you do not have a workspace, create a free one at `slack.com/get-started`. Slack emails you a code to sign in. Create a channel for the messages, for example a private `#handoff`.
2. Go to `api.slack.com/apps`, choose **Create New App**, then **Blank app** (not the AI agent or starter templates), name it `handoff-desk` and pick your workspace.
3. On the "What it can do" and "What it can respond to" screens, add nothing: click **Continue** on both, then **Create** on the review screen. An incoming webhook needs no scopes or events of its own.
4. In the app's left menu open **Incoming Webhooks**, switch **Activate Incoming Webhooks** on, then click **Add New Webhook to Workspace**, pick the channel and click **Allow**.
5. Copy the webhook URL. It starts with `https://hooks.slack.com/services/`. Put it in the private file (step 1). Only that address form is accepted.

## 4. Check it

Run this in a terminal where the settings are available (the same `HANDOFF_ENV_FILE`):

```
npx -y @voyageurworks/handoff-desk doctor --ping
```

You should see `Set.` for each service and `Sent; look for it in the chat` (or channel). Then ask your assistant to send a handoff; `handoff_send` returns `notified` with `telegram` and `slack` in it.

If something is refused, `doctor` says why:

- `Telegram answered 401`: the token is wrong or was revoked; copy it again from BotFather.
- `Telegram answered 400` or `403` (not seen in our tests): usually the chat id is wrong, or you have not written to the bot yet (step 2).
- `Slack answered 404`: the webhook was deleted or mistyped; make a new one.
- `must be a Slack incoming webhook`: the address is not a `https://hooks.slack.com/services/...` one.
- `does not look like a bot token`: stray characters around the value; when you store it in another system (for example a CI secret), make sure no line break was added after it.

To retire a bot or a webhook: BotFather `/revoke`, or delete the webhook in the Slack app's Incoming Webhooks page.
