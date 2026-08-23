# dropley

Publish files and static sites to [Dropley](https://dropley.app) from your terminal — no browser, no account.

`dropley` wraps the [Dropley public API](https://dropley.app/api/v1/openapi.json) so agents and humans can publish artifacts and manage them with four commands. Every published artifact gets a shareable URL and a token for later update/delete.

## Install

```sh
npm install -g dropley
# or run without installing:
npx dropley publish ./dist
```

Requires Node.js ≥ 20. Zero runtime dependencies.

## Quickstart

```sh
# Publish a directory (static site) — uploads each file, skipping OS junk (.DS_Store, .git, …)
dropley publish ./dist --expiry 7d
# url: https://preview.dropley.app/p/aB3cD5eF
# token: tok_a1b2c3…   ← keep this; needed to update/delete

# A single file is published as the site entry (index.html)
dropley publish report.html

# Show metadata (public without a token)
dropley status https://preview.dropley.app/p/aB3cD5eF

# Change expiry (needs the artifact token)
dropley update aB3cD5eF --expiry 30d

# Delete permanently
dropley delete aB3cD5eF
```

## Agent usage

`dropley` is designed for agents: quiet, machine-parsable output on stdout, progress on stderr.

```sh
# JSON mode — everything needed in one object
dropley publish ./out --json
# {
#   "shortId": "aB3cD5eF",
#   "url": "https://preview.dropley.app/p/aB3cD5eF",
#   "expiresAt": "2026-08-30T12:00:00.000Z",
#   "artifactToken": "tok_a1b2c3…"
# }
```

- Exit codes: `0` success, `1` failure (API/network errors), `2` usage error.
- API errors surface the server's `error`/`code`/`hint` verbatim on stderr, including `RATE_LIMITED` 429 responses with their `Retry-After`.
- The token returned by `publish` is saved locally (per artifact ID, `0600` perms, `~/.config/dropley/tokens.json` or `$XDG_CONFIG_HOME`/`$DROPLEY_CONFIG_DIR`) and reused by `status`/`update`/`delete` automatically.

See also the Dropley [agent skills](https://github.com/dropley) collection — `npx skills@latest add dropley/docs` for docs on publishing via agents.

## Commands

| Command | Description |
| --- | --- |
| `dropley publish <path> [--expiry <t>]` | Publish a file or directory; prints URL + token |
| `dropley status <url-or-shortId>` | Show artifact metadata |
| `dropley update <url-or-shortId> --expiry <t>` | Change an artifact's expiry |
| `dropley delete <url-or-shortId>` | Permanently delete an artifact |
| `dropley pack <dir> [--out archive.zip]` | Create a byte-reproducible zip (auxiliary; see below) |

### Global options

| Option | Description |
| --- | --- |
| `--json` | Machine-readable JSON output on stdout |
| `--api <url>` | API base URL (default `https://dropley.app`; env `DROPLEY_API` for local previews) |
| `--token <tok>` | Artifact token (env `DROPLEY_TOKEN`); precedence: `--token` > `DROPLEY_TOKEN` > saved token |
| `--expiry <t>` | `1d` `3d` `7d` `15d` `30d` `1h`… — server-validated |

### Notes

- **Directory publishes** upload every file as an individual part with its relative path (Dropley requires the site entry to be `index.html` at the root). OS metadata (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`), VCS internals (`.git`, `.hg`, `.svn`) and `node_modules` are skipped.
- **`dropley pack`** writes a byte-for-byte reproducible zip archive (sorted entries, fixed timestamps, no junk). Dropley serves uploads as-is and does not expand archives, so publish directories directly for hosting — `pack` is for archiving and reproducible builds.
- 50MB total / 1000 files per artifact (checked locally before upload).

## Development

```sh
npm install
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest (mocked fetch, no network)
npm run build       # tsc → dist/
```

## Release

Pushing a `v*` tag runs the release workflow: lint, typecheck, tests, then `npm publish --provenance` with the `NPM_TOKEN` secret. The job runs in the `npm` GitHub environment, which requires maintainer approval before the publish step executes — releases are human-gated, never automated.

Release checklist:

1. Bump the version: `npm version <minor|patch> --no-git-tag-version`, commit, push.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` — the workflow starts, runs checks, and pauses at the `npm` environment.
3. Approve the deployment (Actions → Review deployments). The package publishes with SLSA provenance.

Setup (once, by a maintainer): a granular npm token with read/write on the `dropley` package and **bypass 2FA enabled**, stored as the `NPM_TOKEN` repository secret. The package's Publishing access must allow bypass-2FA tokens (or set the token accordingly).

## License

MIT