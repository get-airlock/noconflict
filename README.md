# ☠ noconflict

Murder your merge conflicts. Ship without the pain.

`nc push` instead of `git push`. That's it.

## Install

```bash
npm install -g noconflict
```

## Quick Start

```bash
nc init          # paste your OpenRouter key, set up identity
nc push          # push with conflict detection + AI resolution
```

## Commands

### Free

| Command | What it does |
|---------|-------------|
| `nc init` | Set up noconflict in a repo |
| `nc status` | Current state in plain english |
| `nc check` | Readiness scan — are you ship-ready? |
| `nc fix` | Auto-fix what check found (3 free, then Pro) |

### Pro — $29/mo

| Command | What it does |
|---------|-------------|
| `nc push` | Push with conflict detection + AI resolution |
| `nc sync` | Pull + rebase without the pain |
| `nc swap <branch>` | Switch branches without losing work |
| `nc undo` | Revert last mistake |
| `nc review` | Pre-push sanity check |
| `nc env` | Configure deploy platform |
| `nc ship` | Deploy to production |
| `nc preview` | Spin up preview environment |
| `nc health` | Production health status |
| `nc logs` | Tail production logs |
| `nc rollback` | Roll back to last healthy deploy |

## How It Works

1. You run `nc push`
2. NoConflict scans for conflicts against remote and other branches
3. If clean (green) — pushes silently
4. If risky (yellow/red) — explains what's happening in plain english, lets you chat about it, then push when ready

## Bring Your Own Key

NoConflict uses [OpenRouter](https://openrouter.ai) for AI. You bring your own API key — your data stays on your machine. We only read diffs. Nothing else.

## Upgrade

```bash
nc upgrade
```

14-day free trial. No credit card required.

## License

MIT
