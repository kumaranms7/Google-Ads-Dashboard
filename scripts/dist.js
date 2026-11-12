#!/usr/bin/env node
// Cross-platform wrapper for `npm run dist`. Previously a plain `npm run
// dist` crashed on code signing (electron-builder resolves its internal
// cscInfo to null with no CSC_LINK/CSC_KEY_PASSWORD set, then crashes deep
// in its own code trying to read `.file` off it) — you had to remember to
// run scripts\build-signed.ps1 instead, or set those env vars by hand.
//
// This reads the certificate path/password from scripts/sign-config.json
// (git-ignored — the password must never live in a tracked file like
// package.json) and sets them before invoking the normal build, so a plain
// `npm run dist` just works. Env vars already set in the shell (e.g. by
// build-signed.ps1) are left alone and take priority.
'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const configPath = path.join(__dirname, 'sign-config.json')

if (!process.env.CSC_LINK) {
  if (fs.existsSync(configPath)) {
    let config
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
      console.error(`[dist] Failed to parse ${configPath}: ${e.message}`)
      process.exit(1)
    }
    if (config.cscLink)         process.env.CSC_LINK = config.cscLink
    if (config.cscKeyPassword)  process.env.CSC_KEY_PASSWORD = config.cscKeyPassword
  } else {
    console.error(
      `[dist] No code-signing certificate configured.\n` +
      `[dist] Create scripts/sign-config.json (copy scripts/sign-config.example.json and fill in your certificate path/password) — it's git-ignored, so this never gets committed.`
    )
    process.exit(1)
  }
}

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

execSync('npx vite build && npx electron-builder', { stdio: 'inherit', cwd: path.join(__dirname, '..') })
