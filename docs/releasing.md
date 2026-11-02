# Releasing

Maintainer notes. Releases publish to npm as `@voyageurworks/handoff-desk` from GitHub Actions, with provenance and no stored token.

## One-time setup (needs the maintainer's own npm account)

1. Create an npm account and turn on two-factor authentication.
2. Create the `voyageurworks` npm organization (free for public packages), or use a user named `voyageurworks`. The scope in `package.json` must match.
3. Publish the first version by hand, because trusted publishing is configured on an existing package:
   ```sh
   npm login
   npm publish --access public
   ```
4. On npmjs.com open the package, Settings, Trusted Publisher, and choose GitHub Actions: organization `voyageurworks`, repository `handoff-desk`, workflow `release.yml`, and tick **Allow npm publish** under Allowed actions (the workflow runs `npm publish`; leaving it unticked would make npm stage each new version for manual approval instead). Leave the environment name empty. npm asks for your two-factor method (authenticator code or security key) when you save it. From then on no npm token is needed.

The `Release` workflow skips publishing, with a notice, when npm already has the tagged version. That keeps the GitHub release for the hand-published first version from failing.

## Each release

1. Update `version` in `package.json` and the date in `CHANGELOG.md`, commit, and wait for CI to pass on `main`.
2. Create a GitHub release whose tag is `v` plus the version (for example `v1.0.1`). The `Release` workflow checks that the tag matches `package.json`, runs the checks and tests, and publishes.

## Check before publishing

`npm pack --dry-run` lists exactly what goes into the package. `npm publish --dry-run` runs the whole publish except the upload.
