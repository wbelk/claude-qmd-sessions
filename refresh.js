#!/usr/bin/env node

// Outputs CLAUDE.md files + recent session turns to stdout.
// Used by /qmd-sessions refresh to manually load context in a fresh session.

const lib = require('./lib')

const config = lib.readConfig()
if (!config || !config.outputDir) {
  console.error('No output directory configured. Run /qmd-sessions first.')
  process.exit(1)
}

// Output CLAUDE.md files
const claudeMd = lib.loadClaudeMd(process.cwd())
if (claudeMd) {
  process.stdout.write(claudeMd + '\n\n---\n\n')
}

// Output recent turns from last N sessions
const context = lib.collectRecentTurns(config.outputDir, process.cwd())
if (context) {
  process.stdout.write(context)
} else {
  console.error('No turns found in recent sessions')
  process.exit(1)
}
