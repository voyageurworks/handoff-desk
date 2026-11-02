# Keeping the mail password out of files

The doorbell needs an app password for the sender's mailbox. Three ways to give it to handoff-desk, from simplest to safest:

1. `HANDOFF_MAIL_APP_PASSWORD` in the MCP client's config. Easy, but the password sits in a config file.
2. `HANDOFF_ENV_FILE`: a private `NAME=value` file outside any repository, readable only by you.
3. `HANDOFF_MAIL_PASSWORD_COMMAND`: a command that prints the password. It runs only when a doorbell is sent, with a 10 second limit, and nothing it prints is ever repeated in a message. No file in the project holds the password.

Use a separate sending mailbox for the doorbell if you can, so a leaked app password never reaches your main account.

## The Telegram bot token and the Slack webhook

The optional chat doorbells have two more secrets, handled the same way: put `HANDOFF_TELEGRAM_BOT_TOKEN` and `HANDOFF_SLACK_WEBHOOK_URL` in the private file named by `HANDOFF_ENV_FILE`, or set `HANDOFF_TELEGRAM_BOT_TOKEN_COMMAND` and `HANDOFF_SLACK_WEBHOOK_COMMAND` to commands that print them (the recipes below work the same). Anyone who holds a bot token can write as the bot, and anyone who holds a webhook can post to that channel, so treat both like a password. They are never printed, logged or returned in a tool result; if you pasted one anywhere by mistake, revoke it (BotFather: `/revoke`; Slack: delete the webhook) and make a new one.

## Recipes for the command

Windows, encrypted for your Windows user on this PC only (no extra software). Store it once (the prompt hides what you type):

    powershell -NoProfile -Command "Get-Credential -UserName mail | Export-Clixml $env:USERPROFILE\.handoff-mail.xml"

Then:

    HANDOFF_MAIL_PASSWORD_COMMAND=powershell -NoProfile -Command "(Import-Clixml $env:USERPROFILE\.handoff-mail.xml).GetNetworkCredential().Password"

Other tools:

- 1Password: `op read "op://Private/Doorbell/password"`
- Bitwarden: `bw get password doorbell`
- macOS keychain: `security find-generic-password -s handoff-doorbell -w`
- Linux: `secret-tool lookup service handoff-doorbell`

A command that waits for you to type or approve something is stopped after 10 seconds, so use a tool that is already unlocked.
