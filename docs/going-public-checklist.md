# Before making the repository public

Some GitHub protections only exist on public repositories (or a paid plan), so they can only be switched on at the moment of going public. Do these in order, then check each one.

1. Run the scans once more: `gitleaks git --redact .`, `pnpm audit`, `osv-scanner scan source -r .` and `pnpm check && pnpm test`. All must be clean.
2. Read the git history for anything personal, not only secrets: names, addresses, private notes. The guard test (`src/guard.test.ts`) bans the obvious ones in the current files only, not in old commits. If an old commit holds anything personal, publish a fresh one-commit history instead of this one: it cannot be removed from history after the repository is public.
3. Make the repository public.
4. Immediately turn on, under Settings, Code security: secret scanning, push protection, private vulnerability reporting, Dependabot alerts and security updates.
5. Add branch protection to `main`: require the CI and Security checks, block force pushes.
6. Confirm the CodeQL job ran (Actions tab, Security workflow). It is skipped while the repository is private.
7. Confirm the Security tab shows the "Report a vulnerability" button that SECURITY.md points to.
8. Review the open Dependabot pull requests and merge the safe ones after the tests pass.
