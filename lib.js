const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const CONFIG_PATH = path.join(__dirname, 'config.json')

function readConfig () {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (e) {
    return null
  }
}

function isEmbedRunning () {
  try {
    cp.execSync('pgrep -f "qmd.*embed"', { stdio: 'ignore', timeout: 5000 })
    return true
  } catch (e) {
    return false
  }
}

function qmdAvailable () {
  try {
    cp.execSync('which qmd', { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

function runUpdateAndEmbed () {
  try {
    cp.execSync('qmd update', { stdio: 'ignore', timeout: 120000 })
  } catch (e) {
    return
  }
  if (isEmbedRunning()) return
  try {
    cp.execSync('qmd embed', { stdio: 'ignore', timeout: 120000 })
  } catch (e) {}
}

function cwdToProject (cwd, outputDir) {
  if (!cwd || !outputDir) return null
  const cwdDashed = cwd.replace(/\//g, '-')
  let dirs
  try { dirs = fs.readdirSync(outputDir) } catch (e) { return null }
  for (let i = 0; i < dirs.length; i++) {
    if (cwdDashed.endsWith(dirs[i])) return dirs[i]
  }
  return null
}

function collectRecentTurns (outputDir, cwd, maxTurns, maxChars) {
  if (!maxTurns) maxTurns = 100
  if (!maxChars) maxChars = 14000

  // Find all session files (excluding subagents)
  const files = []
  function walk (dir) {
    let entries
    try { entries = fs.readdirSync(dir) } catch (e) { return }
    for (let i = 0; i < entries.length; i++) {
      const full = path.join(dir, entries[i])
      let stat
      try { stat = fs.statSync(full) } catch (e) { continue }
      if (stat.isDirectory()) {
        walk(full)
      } else if (entries[i].endsWith('.md') && entries[i].indexOf('sub') === -1) {
        files.push(full)
      }
    }
  }

  walk(outputDir)
  if (files.length === 0) return null

  // Sort: current project files first (desc), then all others (desc)
  const project = cwdToProject(cwd, outputDir)
  const projectDir = project ? path.join(outputDir, project) + path.sep : null
  const currentProject = []
  const otherProjects = []

  for (let i = 0; i < files.length; i++) {
    if (projectDir && files[i].indexOf(projectDir) === 0) {
      currentProject.push(files[i])
    } else {
      otherProjects.push(files[i])
    }
  }

  currentProject.sort().reverse()
  otherProjects.sort().reverse()
  const sorted = currentProject.concat(otherProjects)

  const collected = []
  let totalChars = 0
  let sessionsUsed = 0

  for (let s = 0; s < sorted.length; s++) {
    if (collected.length >= maxTurns) break
    if (totalChars >= maxChars) break

    const turns = extractTurnsFromFile(sorted[s])
    if (turns.length === 0) continue

    let addedFromSession = 0
    for (let t = turns.length - 1; t >= 0; t--) {
      if (collected.length >= maxTurns) break
      if (totalChars + turns[t].length > maxChars && collected.length > 0) break
      collected.unshift(turns[t])
      totalChars += turns[t].length
      addedFromSession++
    }

    if (addedFromSession > 0) sessionsUsed++
  }

  if (collected.length === 0) return null

  const exchanges = Math.floor(collected.length / 2)
  const header = '[Context restored: ~' + exchanges + ' exchanges from ' + sessionsUsed + ' session' + (sessionsUsed > 1 ? 's' : '') + ']\n\n'
  return header + collected.join('\n')
}

function extractTurnsFromFile (filePath) {
  let content
  try { content = fs.readFileSync(filePath, 'utf8') } catch (e) { return [] }
  const parts = content.split(/^(?=## )/m)
  const turns = []
  for (let i = 0; i < parts.length; i++) {
    if (/^## (User|Claude|System)/.test(parts[i])) {
      turns.push(parts[i])
    }
  }
  return turns
}

function loadClaudeMd (cwd) {
  const parts = []
  const globalPath = path.join(process.env.HOME, '.claude', 'CLAUDE.md')
  try {
    const global = fs.readFileSync(globalPath, 'utf8')
    if (global.trim()) parts.push('# Global CLAUDE.md\n\n' + global.trim())
  } catch (e) {}

  if (cwd) {
    const projectPath = path.join(cwd, 'CLAUDE.md')
    try {
      const project = fs.readFileSync(projectPath, 'utf8')
      if (project.trim()) parts.push('# Project CLAUDE.md\n\n' + project.trim())
    } catch (e) {}
  }

  if (parts.length === 0) return null
  return parts.join('\n\n---\n\n')
}

module.exports = { readConfig, isEmbedRunning, qmdAvailable, runUpdateAndEmbed, collectRecentTurns, loadClaudeMd }
