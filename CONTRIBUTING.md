# Contributing

1. `pnpm install`
2. `pnpm check` (types) and `pnpm test` (the whole suite; it creates temporary git repositories, so allow a few minutes).
3. Write the failing test first, then the change.

Rules the tests enforce:

- No personal data or vendor names anywhere in the repo (`src/guard.test.ts`; maintainers can list extra words to ban, one per line, in an untracked `.guard-words` file).
- No secrets in notes, config or tests. Use placeholder values such as `me@example.test`.

Keep the server vendor-neutral: anything specific to one agent belongs in configuration (subject prefix, inbox folder), not in code.

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md). Report security problems as described in [SECURITY.md](SECURITY.md), not in a public issue.

Maintainers: see [docs/releasing.md](docs/releasing.md) for how releases are published.

## Testing the Telegram and Slack doorbells without the real services

`HANDOFF_CHAT_TEST_ENDPOINT=http://127.0.0.1:<port>` sends both doorbells to a program on your own computer instead of Telegram and Slack (Telegram to `/bot<token>/sendMessage`, Slack to `/slack`). Only plain `http` to `127.0.0.1`, `localhost` or `[::1]` with a port is accepted; anything else is ignored with a warning. The token and webhook are still checked first. Use fake values: the program on that port receives the bot token in the request path, exactly as Telegram would. `src/chat.e2e.test.ts` does this against the built program for success, 429, 500, a dropped connection and nothing listening. Never put this setting in a client's config; `handoff-desk doctor` warns when it is set.
