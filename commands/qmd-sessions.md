---
name: qmd-sessions
description: Convert Claude Code session transcripts to searchable markdown files for qmd indexing
disable-model-invocation: true
argument-hint: [refresh]
allowed-tools: Bash(node *), Bash(qmd *), Bash(npm *), Bash(which *), Bash(find *), Read, Edit
---

## Quick command: refresh

If `$ARGUMENTS` is `refresh`, skip all setup steps. Run:
```
node ~/.claude/skills/qmd-sessions/refresh.js
```
Present the output as conversation context — this is the last 50 exchanges from the most recent session. Then stop. Do not proceed to any other steps.

---

Convert Claude Code JSONL session transcripts into clean, searchable markdown files.

## What it does

- Reads all session JSONL files from `~/.claude/projects/`
- Extracts human-readable content: user messages + assistant text responses
- Implicitly skips tool_use, tool_result, and thinking blocks (only extracts `type: "text"` content blocks)
- Strips `<system-reminder>` tags from text content
- Converts subagent transcripts with Task/Subagent labels
- Skips compact (context compaction) files in both session and subagent directories
- Outputs organized markdown files: `{project}/{date}-{slug}-{id}.md`
- Idempotent in bulk mode — skips sessions that already have an output file. In `--session` mode, always overwrites with latest content.
- Two hooks keep indexes current (all synchronous — block until complete):
  - **PreCompact**: converts current session before context compaction, runs qmd update + embed
  - **SessionEnd**: final session conversion when session ends, runs qmd update + embed
- All hooks use `lib.isEmbedRunning()` (`pgrep -f "qmd.*embed"`) before running embed — if another session's embed is already running, skip. The next embed will catch any pending hashes.
- Shared logic lives in `lib.js`: `readConfig()`, `isEmbedRunning()` (pgrep check), `qmdAvailable()` (which qmd), `runUpdateAndEmbed()` (update then pgrep-gated embed).

## Behavior: prompt for everything

**Every single step must prompt the user and wait for explicit confirmation before proceeding.** This includes:
- Steps where something is already configured — report the status, then ask "Continue to next step?"
- Steps where an action is needed — describe what will happen, then ask for approval
- Never silently skip, auto-configure, or proceed to the next step without prompting

The user should feel in control at all times.

**Formatting rule:** Confirmation questions (e.g., "Continue?") must always be on their own line, never appended to status text.

**One exception:** The hooks (`hook.js`, shared logic in `lib.js`) run automatically — there is no user to prompt at that point. This is by design. `hook.js` handles PreCompact and SessionEnd (converts sessions, updates claude-sessions index). None of these hooks delete files.

## Steps

### Step 1: Determine output directory

Check these in order:

1. Check `~/.claude/skills/qmd-sessions/config.json` for a saved `outputDir`. If found, show it:
   > "Found saved output directory: `<path>`. Use this path?"

2. If no config exists, ask the user where to save the converted sessions. Do not assume a default.

Once confirmed, check if the directory is already saved in `~/.claude/skills/qmd-sessions/config.json`:
- If already saved with the same value: "Output directory already saved in config.json."
  > "Continue?"
- If different or not saved: "Save this directory to config.json so it's remembered next time?" Wait for confirmation before writing.

### Step 2: Run conversion

First, count the session files, subagent files, and project directories to give the user a preview:
```
find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -not -name '*compact*' | wc -l
find ~/.claude/projects -path '*/subagents/*.jsonl' -not -name '*compact*' | wc -l
ls -d ~/.claude/projects/*/ 2>/dev/null | wc -l
```

Then confirm:
> "Found N session files and S subagent files across M project directories. Ready to convert to `<output-dir>`. Proceed?"

Wait for confirmation, then run:
```
node ~/.claude/skills/qmd-sessions/convert-sessions.js <output-directory>
```

If the script exits with an error, show the full error output to the user and ask:
> "The conversion script failed. Error shown above. How would you like to proceed?"

Do not retry automatically.

If successful, report the results clearly:
> "Converted X sessions, Y continuations, Z subagents. Skipped N (already converted). Empty: M."

### Step 3: Verify output

After conversion, show the user a summary:

1. List project subdirectories and file counts per directory.
2. Always show the first 30 lines of two sample files — one session and one subagent (pick files with enough content to fill 30 lines). Present the content as text in your response — do not leave it buried in tool output blocks.

Ask:
> "Does this output look correct? Continue to setup checks?"

### Step 4: First-run setup

Check each of the following. For each item, tell the user what you found and what you'd like to do. **Wait for confirmation before making changes AND before moving to the next check.**

**Important: Later steps depend on earlier ones.** If a prerequisite is not met (Bun missing, qmd not working, collection not created), stop and report the error clearly. Do not silently skip steps. Tell the user what was completed, what failed, and what remains.

#### 4a. Bun runtime
Check: `which bun` or `~/.bun/bin/bun --version`
- If found at either location: "Bun is installed at `<path>`."
  > "Continue to next check?"
- If not: "Bun is not installed. qmd requires Bun as its runtime. Install it with `curl -fsSL https://bun.sh/install | bash`? This installs to `~/.bun/bin/bun`." (Note: curl is not in the skill's pre-approved tools — the user will get a separate permission prompt from Claude Code for this command.)
- If user declines: "Bun is required for all remaining setup steps (qmd installation, collections, embeddings, MCP server, SessionEnd hook). Setup cannot continue without it. Completed: Steps 1-3 (conversion). Not completed: Steps 4a-4g (qmd integration)." Stop here.

#### 4b. qmd installation
**If Bun is not installed, stop and report:** "Bun is required but not available. Cannot continue setup. Run the skill again after installing Bun."

First check the active Node version: `node --version`
- qmd v1.0+ requires Node ≥22 for Metal GPU acceleration and correct index schema.
- If Node < 22:
  Check if Node ≥22 is available via nvm: `ls ~/.nvm/versions/node/ | grep -E '^v2[2-9]'`
  - If a version ≥22 exists (e.g., `v22.22.0`):
    > "Your active Node is `<active-version>`, but qmd requires Node ≥22. Node `<available-version>` is available via nvm."
    > "Would you like to switch your nvm default to `<available-version>`? This runs `nvm alias default <available-version>`."
    If user approves, run: `nvm alias default <available-version>`
    Then tell the user:
    > "Default Node switched to `<available-version>`. Please open a new terminal tab, run `nvm use <available-version>`, and re-run `/qmd-sessions` to continue setup."
    Stop here.
  - If no version ≥22 exists:
    > "Your active Node is `<active-version>`, but qmd requires Node ≥22. No Node ≥22 found via nvm."
    > "Would you like to install it? This runs `nvm install 22`."
    If user approves, run: `nvm install 22`
    Then check the exact version installed: `ls ~/.nvm/versions/node/ | grep -E '^v2[2-9]' | tail -1`
    > "Node `<installed-version>` installed. Would you like to set it as your nvm default? This runs `nvm alias default <installed-version>`."
    If user approves, run: `nvm alias default <installed-version>`
    Then tell the user:
    > "Default Node switched to `<installed-version>`. Please open a new terminal tab, run `nvm use <installed-version>`, and re-run `/qmd-sessions` to continue setup."
    Stop here.

Check: `which qmd`
- If installed, verify it runs: `qmd --version`
  - If it works and version is ≥1.0.0: "qmd `<version>` is installed at `<path>`."
    > "Continue to next check?"
  - If version is < 1.0.0: "qmd `<version>` is installed but outdated. Install latest with `npm install -g @tobilu/qmd`?"
  - If it errors: "qmd is installed but can't run. Error: `<error message>`. This usually means Bun isn't available."
    > "Continue to next check?"
- If not installed: "qmd is not installed. Install with `npm install -g @tobilu/qmd`? Note: requires Bun runtime."
- If user declines: "qmd is required for all remaining setup steps (collections, embeddings, MCP server, SessionEnd hook). Setup cannot continue without it. Completed: Steps 1-3 (conversion), 4a (Bun). Not completed: Steps 4b-4g (qmd integration)." Stop here.

#### 4c. Session transcript collection
**If qmd is not installed or not working, stop and report:** "qmd is required but not available. Cannot continue setup. Completed: Steps 1-3, 4a-4b. Not completed: Steps 4c-4g."
Check: `qmd collection list`
- If claude-sessions collection exists: "qmd collection `claude-sessions` already configured, pointing at `<path>`."
  > "Continue to next check?"
- If not: "I'd like to add your output directory as a qmd collection so sessions are searchable. This will run:"
  ```
  qmd collection add <output-directory> --name claude-sessions --mask "**/*.md"
  qmd context add qmd://claude-sessions "Claude Code session transcripts — conversations, subagent research, architectural decisions"
  ```
  "OK to proceed?"

#### 4d. Generate embeddings
**If no qmd collections were created, stop and report:** "No collections to embed. Setup cannot continue."

First run `qmd update` to scan all collection files into the index:
> "`qmd update` will scan all collection files into the index. Then `qmd embed` will generate vector embeddings. On first embed, this downloads the embedding model (~300MB) to `~/.cache/qmd/models/`. Additional models (~640MB reranker, ~1.1GB query expansion) are downloaded later when you first use `qmd query`. First run can take up to 20 minutes. Run `qmd update && qmd embed` now?"

After embed completes successfully:
> "Initial embed complete. The PreCompact and SessionEnd hooks will keep the index current as you use Claude Code."
> "Continue to next check?"

#### 4e. qmd MCP server
**If qmd is not installed or not working, stop and report:** "qmd is required but not available. Cannot continue setup."
Read `~/.claude.json` and check for `mcpServers.qmd`.
- If configured: "qmd MCP server already configured in `~/.claude.json`."
  > "Continue to next check?"
- If not: "I'd like to add qmd as an MCP server so Claude Code can search your sessions. This adds to `~/.claude.json`:"
  ```json
  { "mcpServers": { "qmd": { "command": "qmd", "args": ["mcp"], "type": "stdio" } } }
  ```
  "This will be merged with your existing MCP servers. OK?"

#### 4f. Session conversion hooks
Read `~/.claude/settings.json` and check for PreCompact and SessionEnd hooks that run `hook.js`.

Two hooks work together to keep the claude-sessions index current (all synchronous):
- **PreCompact** → converts current session to markdown before context compaction, runs qmd update, then checks `pgrep -f "qmd.*embed"` and runs embed if none running
- **SessionEnd** → final conversion when session ends, runs qmd update, then checks pgrep and runs embed if none running

Check each hook:
- If both configured: "Both hooks already configured (PreCompact, SessionEnd). Sessions will be auto-indexed."
  > "Continue to next check?"
- If any missing: "I'd like to add hooks so sessions are automatically converted and indexed. This adds to `~/.claude/settings.json`:"
  ```json
  {
    "hooks": {
      "PreCompact": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/qmd-sessions/hook.js" }] }],
      "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/skills/qmd-sessions/hook.js" }] }]
    }
  }
  ```
  "This will be merged with your existing hooks. OK?"

#### 4g. CLAUDE.md qmd search guidance
Read `~/.claude/CLAUDE.md` and check for a "Session Search" section.
- If present: "qmd search guidance already in CLAUDE.md."
  > "Continue to next check?"

#### 4h. Load context on startup
Ask: "Would you like to automatically load the last ~50 exchanges when starting a new session? This outputs recent conversation context to Claude on every fresh startup, similar to what `/qmd-sessions refresh` does manually."

Read `~/.claude/skills/qmd-sessions/config.json` and check for a `loadContextOnStartup` key.
- If user says yes:
  - If already set to `true`: "`loadContextOnStartup` is already enabled in config.json. All setup checks complete."
  - Otherwise: set `"loadContextOnStartup": true` in config.json. "Enabled. All setup checks complete."
- If user says no:
  - Set `"loadContextOnStartup": false` in config.json. "Disabled. All setup checks complete."

Wait for user acknowledgement before ending.
- If not: "I'd like to add qmd search guidance to `~/.claude/CLAUDE.md` so Claude uses qmd for session search. This appends:"
  ```markdown
  ## Session Search (qmd)

  qmd is installed as an MCP server. Use qmd MCP tools for **session history search**. qmd returns ranked snippets, saving tokens vs reading whole files. If qmd returns 0 results, fall back to Grep/Glob.

  ### qmd MCP tools
  - `mcp__qmd__deep_search` — best quality, auto-expands query variations, use by default
  - `mcp__qmd__search` — keyword-only BM25 search (fast, exact terms)
  - `mcp__qmd__get` — retrieve a full session document by path or docid

  ### Available collections
  - `claude-sessions` — past Claude Code session transcripts (conversations, subagent research, architectural decisions)

  ### When to search (do this proactively, don't wait to be asked)
  - At session start — search for prior work on the current task before diving in
  - Before investigating a bug — check if it was discussed or fixed before
  - Before proposing an architecture or approach — check what was tried previously
  - After receiving a correction — search for whether this mistake pattern exists
  - When the user references past work — "we discussed", "last time", "remember when"

  ### Query strategies
  - **Date-based queries** ("what did we discuss today", "sessions from last week"): Use `mcp__qmd__multi_get` with a date glob pattern. BM25 tokenizes dates on hyphens, so `search("2026-03-03")` returns nothing. Instead: `multi_get(pattern: "project-name/2026-03-03*.md")`. This lists all sessions and subagents for that date. Then use `mcp__qmd__get` to read specific ones.
  - **Content-based queries** ("that crawler bug", "billing discussion"): Use `mcp__qmd__deep_search` as normal.
  - **Known session lookup**: Use `mcp__qmd__get` with the file path or docid.
  ```
  "OK to append?"
