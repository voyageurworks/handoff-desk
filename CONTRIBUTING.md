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
