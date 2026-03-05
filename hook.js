#!/usr/bin/env node

// PreCompact + SessionEnd + SessionStart hook
// PreCompact/SessionEnd: converts session to markdown and updates qmd index.
// SessionStart (compact/resume/clear): converts session, extracts last turns to stdout, updates qmd index.

const path = require('path')
const cp = require('child_process')
const lib = require('./lib')

const SCRIPT_PATH = path.join(__dirname, 'convert-sessions.js')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', function (chunk) { input += chunk })
process.stdin.on('end', function () {
  let data
  try { data = JSON.parse(input) } catch (e) { process.exit(0) }

  const sessionId = data.session_id
  if (!sessionId) process.exit(0)

  const config = lib.readConfig()
  if (!config) process.exit(0)
  if (!config.outputDir) process.exit(0)

  const eventName = data.hook_event_name

  if (eventName === 'SessionStart') {
    handleSessionStart(data, config, sessionId)
  } else {
    handlePreCompactOrEnd(config, sessionId)
  }
})

function convertSession (config, sessionId) {
  const convertCmd = 'node ' + JSON.stringify(SCRIPT_PATH) + ' ' + JSON.stringify(config.outputDir) + ' --session ' + JSON.stringify(sessionId)
  try {
    cp.execSync(convertCmd, {
      stdio: 'inherit',
      timeout: 60000
    })
    return true
  } catch (e) {
    return false
  }
}

function updateQmd () {
  if (!lib.qmdAvailable()) return
  try {
    const collections = cp.execSync('qmd collection list', { encoding: 'utf8', timeout: 10000 })
    if (collections.indexOf('claude-sessions') === -1) return
  } catch (e) {
    return
  }
  lib.runUpdateAndEmbed()
}

function handleSessionStart (data, config, sessionId) {
  const source = data.source
  // Output CLAUDE.md files for all sources
  const cwd = data.cwd || process.cwd()
  const claudeMd = lib.loadClaudeMd(cwd)
  if (claudeMd) {
    process.stdout.write(claudeMd)
  }

  // For compact/resume/clear: convert session and output recent turns
  if (source === 'compact' || source === 'resume' || source === 'clear') {
    convertSession(config, sessionId)

    if (claudeMd) process.stdout.write('\n\n---\n\n')

    const context = lib.collectRecentTurns(config.outputDir, cwd)
    if (context) {
      process.stdout.write(context)
    }
  } else if (source === 'startup' && config.loadContextOnStartup) {
    if (claudeMd) process.stdout.write('\n\n---\n\n')

    const context = lib.collectRecentTurns(config.outputDir, cwd)
    if (context) {
      process.stdout.write(context)
    }
  }
}

function handlePreCompactOrEnd (config, sessionId) {
  convertSession(config, sessionId)
  updateQmd()
}
