# GitHub Repository Scorecard

Grade any GitHub repository across **security** (OpenSSF Scorecard) and
**AI-readiness** (ai-harness), get an overall A–F grade, a **radar chart** of every
dimension, and **prioritized, actionable recommendations** — from three surfaces
that all share one scoring engine:

- **`gh` CLI extension** — `gh scorecard <owner/repo>`
- **Browser extension** — adds an inline **Scorecard** tab on any github.com repo
- **MCP server** — so coding agents can score repos programmatically

> [!WARNING]
> This repository was vibecoded using Claude Code and should be considered ALPHA quality.

## What it measures

| Dimension | Source | Weight\* |
|---|---|---|
| Architecture Docs | ai-harness | 15% |
| Mechanical Constraints | ai-harness | 20% |
| Testing & Stability | ai-harness | 20% |
| Review & Drift | ai-harness | 15% |
| AI Safeguards | ai-harness | 10% |
| Security (OpenSSF) | OpenSSF Scorecard | 20% |

\* Relative weights within the harness half; the harness/OpenSSF split defaults to
**50/50** and is configurable. When OpenSSF is unavailable, its weight is
redistributed across the harness dimensions.

- **OpenSSF**: consumed from the hosted `api.scorecard.dev` when the repo has been
  scanned; otherwise the server falls back to the `scorecard` binary (needs Docker/CLI
  + a token) for arbitrary or private repos.
- **ai-harness**: a deterministic TypeScript port of
  [ai-harness-scorecard](https://github.com/markmishaev76/ai-harness-scorecard) that
  reads through a `RepoDataSource` — the GitHub API remotely, or a local checkout.

## Architecture

```
apps/cli (gh ext)   apps/extension (WXT)   apps/mcp        ← thin clients
        └──────────────────┬──────────────────┘
                    apps/server (Hono + SQLite cache)      ← computes & caches
                           │  uses ↓
   packages/core (scoring)  packages/report (radar/HTML/terminal/md/badge)
                    packages/schema (canonical zod types)
```

A pnpm + Turborepo monorepo. The **core engine and renderers run server-side**; the
CLI, browser extension, and MCP server call the service (the CLI and MCP can also
compute directly). See [the design doc](#) or the packages below.

## Quick start

```bash
pnpm install
pnpm build

# 1. Run the backend (computes + caches scorecards)
GITHUB_TOKEN=$(gh auth token) pnpm --filter @scorecard/server dev
#   → http://localhost:8787

# 2a. CLI
SCORECARD_SERVER=http://localhost:8787 node apps/cli/dist/index.js facebook/react
node apps/cli/dist/index.js --local            # score the current checkout, no server

# 2b. Browser extension (Chrome)
pnpm --filter @scorecard/extension dev         # loads an unpacked dev build
#   Set the service URL in the extension options, then open any github.com repo.

# 2c. MCP server (standalone or via the service)
GITHUB_TOKEN=$(gh auth token) node apps/mcp/dist/index.js
```

## Surfaces

### CLI (`gh` extension)
`gh scorecard [<owner/repo>] [--json|--markdown|--open|--local|--refresh|--server|--token]`.
Prints a colorized grade + per-dimension bars + top recommendations; `--open` opens the
full visual report in a browser. Packaged as a `gh-scorecard` executable (interpreted
Node shim by default; compile to standalone binaries with Bun + `gh-extension-precompile`
for release).

### Browser extension (WXT, MV3 + Firefox)
Injects a **Scorecard** tab into GitHub's repo nav. Clicking opens a shadow-DOM modal
with the radar report — fetched from the service, so there are no client-side rate
limits. Configure the service URL and an optional private-repo token in the options page.

### MCP server
Tools: `score_repository(owner, repo)` → grade + dimensions + top recommendations +
report URL; `get_recommendations(owner, repo)` → ranked fixes. Uses `SCORECARD_SERVER`
if set, otherwise computes directly with `GITHUB_TOKEN`.

## Development

```bash
pnpm test            # vitest across packages
pnpm typecheck       # tsc --noEmit everywhere
pnpm build           # turbo build (respects the dependency graph)
pnpm --filter @scorecard/core test:watch   # auto-run tests on change
```

## License

MIT
