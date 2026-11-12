'use strict'

// Shared "recent changes" log used by both the RSA Builder and Campaign Manager
// write actions. Flat JSON file in Electron's userData dir, most-recent-first,
// capped at 200 entries. Entries carry a `type` field ('rsa' | 'campaign') so a
// single timeline can show every live change made to an account, and rollback
// handlers can filter by type before acting on an entry.

const { app } = require('electron')
const path = require('path')
const fs   = require('fs')

// Keeps the original filename (predates the `type` field) so existing users'
// change history isn't silently orphaned by a rename.
function changelogPath() {
  return path.join(app.getPath('userData'), 'rsa-changelog.json')
}

async function readChangelog() {
  try { return JSON.parse(await fs.promises.readFile(changelogPath(), 'utf8')) } catch { return [] }
}

async function appendChangelog(entry) {
  const entries = await readChangelog()
  entries.unshift(entry)
  await fs.promises.writeFile(changelogPath(), JSON.stringify(entries.slice(0, 200), null, 2))
  return entry
}

async function patchChangelogEntry(id, patch) {
  const entries = await readChangelog()
  const idx = entries.findIndex(e => e.id === id)
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...patch }
    await fs.promises.writeFile(changelogPath(), JSON.stringify(entries, null, 2))
  }
  return entries[idx]
}

function makeChangelogId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

module.exports = { readChangelog, appendChangelog, patchChangelogEntry, makeChangelogId }
