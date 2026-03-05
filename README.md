# qmd-sessions

Claude Code skill that converts JSONL session transcripts into searchable markdown and indexes them in [qmd](https://github.com/tobi/qmd).

## Installation

1. Copy the skill directory to your Claude Code skills folder:

```bash
cp -r . ~/.claude/skills/qmd-sessions/
```

2. Start a new Claude Code session and run:

```
/qmd-sessions
```

The skill walks through all setup interactively — output directory, conversion, qmd collection, embeddings, MCP server, hooks, and CLAUDE.md guidance. Each step prompts for confirmation.

## What it does

1. Reads session JSONL files from `~/.claude/projects/`
2. Extracts user messages + assistant text responses (skips tool_use, tool_result, thinking blocks)
3. Outputs organized markdown: `{project}/{date}-{slug}-{id}.md`
4. Indexes in qmd for semantic + keyword search via MCP

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Skill definition — step-by-step setup with user prompts |
| `convert-sessions.js` | Conversion script (bulk + `--session` modes) |
| `hook.js` | PreCompact/SessionEnd/SessionStart hook — converts session, restores context, updates qmd index |
| `lib.js` | Shared utilities: config, pgrep guard, qmd update+embed, session file lookup, turn extraction |
| `refresh.js` | Outputs CLAUDE.md files + recent turns from multiple sessions to stdout |
| `config.json` | Persisted output directory + `loadContextOnStartup` flag |

## Usage

```
/qmd-sessions           # Full setup wizard
/qmd-sessions refresh   # Load CLAUDE.md files + last ~50 exchanges into context
```

`refresh` outputs both CLAUDE.md files and the last ~50 exchanges (100 turns, capped at 14,000 characters) collected from recent sessions into context. Useful for manually restoring context in a fresh session.

The setup wizard walks through interactively: output directory, conversion, verification, then checks for Bun, qmd, collection, embeddings, MCP server, hooks, and CLAUDE.md guidance.

## Hooks

Four Claude Code hooks keep the index current and restore context (configured in `~/.claude/settings.json`):

- **PreCompact** — converts session before context compaction, runs `qmd update && qmd embed`
- **SessionEnd** — converts session on exit, runs `qmd update && qmd embed`
- **SessionStart (compact/resume/clear)** — converts the session, then outputs both CLAUDE.md files and the last ~50 exchanges (from multiple recent sessions, sorted by cwd match, capped at 14,000 characters) to stdout so Claude receives instructions and conversation context after compaction.
- **SessionStart (startup)** — outputs CLAUDE.md files to stdout. If `loadContextOnStartup` is enabled in config.json, also outputs the last ~50 exchanges (same as compact/resume/clear, but without session conversion).

All hooks use `pgrep -f "qmd.*embed"` to skip embed if another session's embed is already running.

## Prerequisites

- [Bun](https://bun.sh/) (qmd runtime)
- Node >= 22 (Metal GPU acceleration)
- [qmd](https://github.com/tobi/qmd) >= 1.0.0 (`npm install -g @tobilu/qmd`)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ~/.claude/settings.json                         │
│                                                                        │
│  hooks:                                                                │
│    PreCompact:    [{ command: "node ~/.claude/skills/qmd-sessions/hook.js" }]
│    SessionEnd:    [{ command: "node ~/.claude/skills/qmd-sessions/hook.js" }]
│    SessionStart:                                                       │
│      matcher: "compact"  → [{ command: "node ...hook.js" }]            │
│      matcher: "resume"   → [{ command: "node ...hook.js" }]            │
│      matcher: "clear"    → [{ command: "node ...hook.js" }]            │
│      matcher: "startup"  → [{ command: "node ...hook.js" }]            │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                Claude Code fires hook
                stdin: { session_id, hook_event_name, source, cwd }
                             │
                             ▼
                ┌────────────────────────────┐
                │         hook.js            │
                │                            │
                │  reads stdin JSON          │
                │  reads config.json         │
                │    → { outputDir,          │
                │        loadContextOnStartup│
                │      }                     │
                │                            │
                │  branches on               │
                │  hook_event_name           │
                └───────┬────────┬───────────┘
                        │        │
        ┌───────────────┘        └───────────────┐
        │                                        │
        ▼                                        ▼
┌─────────────────────┐              ┌──────────────────────────┐
│ PreCompact/SessionEnd│              │ SessionStart             │
│ handlePreCompactOrEnd│              │ handleSessionStart       │
└─────────┬───────────┘              └────────────┬─────────────┘
          │                                       │
          ▼                                       ▼
┌─────────────────────┐              ┌──────────────────────────┐
│ 1. convertSession() │              │ 1. loadClaudeMd(cwd)     │
│    node convert-     │              │    reads:                │
│    sessions.js       │              │    ~/.claude/CLAUDE.md   │
│    <outputDir>       │              │    {cwd}/CLAUDE.md       │
│    --session <id>    │              │                          │
└─────────┬───────────┘              │    → stdout (ALL sources │
          │                          │    including startup)     │
          ▼                          └────────────┬─────────────┘
┌─────────────────────┐                          │
│ 2. updateQmd()      │               ┌──────────┴──────────┐
│                     │               │                     │
│  a. which qmd       │               ▼                     ▼
│  b. qmd collection  │  ┌─────────────────────┐ ┌──────────────────────┐
│     list (check     │  │ compact/resume/clear │ │ startup              │
│     claude-sessions)│  │                      │ │ (if loadContext-     │
│  c. qmd update      │  │ 2. convertSession() │ │  OnStartup=true)     │
│  d. pgrep qmd embed │  │    node convert-     │ │                      │
│     (skip if running)│  │    sessions.js       │ │ (no convertSession)  │
│  e. qmd embed       │  │    <outputDir>       │ │                      │
└─────────────────────┘  │    --session <id>    │ │ 2. collectRecentTurns│
                          │                      │ │    → stdout          │
                          │ 3. collectRecentTurns│ └──────────────────────┘
                          │    → stdout          │
                          └──────────────────────┘

collectRecentTurns():
  walks outputDir, finds *.md
  (no subagents), sorts:
  cwd-matching project first
  (desc), then others (desc).
  Collects turns from multiple
  sessions until 100 turns
  (50 exchanges) or 14,000 chars.


/qmd-sessions refresh
──────────────────────
┌──────────────────────────┐
│ refresh.js               │
│                          │
│ 1. readConfig()          │
│    → { outputDir }       │
│                          │
│ 2. loadClaudeMd(cwd)     │
│    → stdout              │
│                          │
│ 3. collectRecentTurns()  │
│    cwd-prioritized sort  │
│    → stdout              │
└──────────────────────────┘
Same output as SessionStart hook.
Used to manually load context
in a fresh session (startup).
```
