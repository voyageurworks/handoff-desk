# Keeping the mail password out of files

The doorbell needs an app password for the sender's mailbox. Three ways to give it to handoff-desk, from simplest to safest:

1. `HANDOFF_MAIL_APP_PASSWORD` in the MCP client's config. Easy, but the password sits in a config file.
2. `HANDOFF_ENV_FILE`: a private `NAME=value` file outside any repository, readable only by you.
3. `HANDOFF_MAIL_PASSWORD_COMMAND`: a command that prints the password. It runs only when a doorbell is sent, with a 10 second limit, and nothing it prints is ever repeated in a message. No file in the project holds the password.

Use a separate sending mailbox for the doorbell if you can, so a leaked app password never reaches your main account.

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
