const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const CONFIG_PATH = path.join(__dirname, 'config.json')

function readConfig () {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return Object.assign({
      qmdCollectionName: 'claude-sessions',
      loadContextOnStartup: true
    }, raw)
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

function qmdExecFile (args, options) {
  return cp.execFileSync('qmd', args, Object.assign({
    encoding: 'utf8',
    timeout: 10000
  }, options || {}))
}

function listQmdCollections () {
  try {
    return cp.execSync('qmd collection list', { encoding: 'utf8', timeout: 10000 })
  } catch (e) {
    return ''
  }
}

function qmdCollectionExists (collectionName) {
  if (!collectionName) return true
  const collections = listQmdCollections()
  const matcher = new RegExp('^' + escapeRegExp(collectionName) + '\\s+\\(qmd://', 'm')
  return matcher.test(collections)
}

function parseQmdDocumentUris (output, collectionName) {
  const matches = String(output || '').match(/qmd:\/\/[^\s)]+\.md\b/g) || []
  const allowedPrefix = collectionName ? 'qmd://' + collectionName + '/' : null
  const seen = new Set()
  const uris = []

  for (let i = 0; i < matches.length; i++) {
    const uri = matches[i]
    if (allowedPrefix && uri.indexOf(allowedPrefix) !== 0) continue
    if (seen.has(uri)) continue
    seen.add(uri)
    uris.push(uri)
  }

  return uris
}

function qmdListUris (collectionName, subpath) {
  if (!collectionName) return []
  const target = subpath ? collectionName + '/' + subpath : collectionName
  try {
    return parseQmdDocumentUris(qmdExecFile(['ls', target]), collectionName)
  } catch (e) {
    return []
  }
}

function qmdSearchUris (collectionName, query, limit) {
  if (!collectionName || !query) return []
  try {
    return parseQmdDocumentUris(
      qmdExecFile(['search', query, '-c', collectionName, '--files', '-n', String(limit || 24)]),
      collectionName
    )
  } catch (e) {
    return []
  }
}

function qmdGetDocument (uri) {
  try {
    return qmdExecFile(['get', uri], { timeout: 15000 })
  } catch (e) {
    return ''
  }
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

function extractTurnsFromMarkdown (content) {
  const parts = String(content || '').split(/^(?=## )/m)
  const turns = []
  for (let i = 0; i < parts.length; i++) {
    if (/^## (User|Claude|Codex|System)/.test(parts[i])) {
      turns.push(parts[i])
    }
  }
  return turns
}

function collectRecentTurnsFromFiles (outputDir, cwd, maxTurns, maxChars) {
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
  return extractTurnsFromMarkdown(content)
}

function collectRecentTurnsFromQmd (outputDir, cwd, maxTurns, maxChars, collectionName) {
  if (!qmdAvailable() || !qmdCollectionExists(collectionName)) return null

  const project = cwdToProject(cwd, outputDir)
  const candidateUris = []
  const seen = new Set()

  function appendUris (uris) {
    const ordered = uris.slice().sort().reverse()
    for (let i = 0; i < ordered.length; i++) {
      const uri = ordered[i]
      if (seen.has(uri)) continue
      seen.add(uri)
      candidateUris.push(uri)
    }
  }

  if (project) appendUris(qmdListUris(collectionName, project))
  if (candidateUris.length === 0 && project) appendUris(qmdSearchUris(collectionName, project.replace(/-/g, ' '), 24))
  if (candidateUris.length === 0) appendUris(qmdListUris(collectionName))
  if (candidateUris.length === 0) return null

  const collected = []
  let totalChars = 0
  let sessionsUsed = 0

  for (let s = 0; s < candidateUris.length; s++) {
    if (collected.length >= maxTurns) break
    if (totalChars >= maxChars) break

    const turns = extractTurnsFromMarkdown(qmdGetDocument(candidateUris[s]))
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
  const header = '[Context restored via QMD: ~' + exchanges + ' exchanges from ' + sessionsUsed + ' session' + (sessionsUsed > 1 ? 's' : '') + ']\n\n'
  return header + collected.join('\n')
}

function collectRecentTurns (outputDir, cwd, maxTurns, maxChars, collectionName) {
  if (!maxTurns) maxTurns = 100
  if (!maxChars) maxChars = 14000

  const qmdContext = collectRecentTurnsFromQmd(outputDir, cwd, maxTurns, maxChars, collectionName || 'claude-sessions')
  if (qmdContext) return qmdContext

  return collectRecentTurnsFromFiles(outputDir, cwd, maxTurns, maxChars)
}

function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

module.exports = {
  readConfig,
  isEmbedRunning,
  qmdAvailable,
  qmdCollectionExists,
  runUpdateAndEmbed,
  collectRecentTurns,
  loadClaudeMd
}
