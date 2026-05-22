/**
 * Clears ELECTRON_RUN_AS_NODE (and ELECTRON_NO_ATTACH_CONSOLE) before
 * spawning Electron so it starts as a full GUI app.
 *
 * Claude Code CLI sets ELECTRON_RUN_AS_NODE=1 in its own shell because it
 * itself is an Electron app running in headless Node mode. Every child
 * process inherits that variable, which causes `electron .` to launch as
 * plain Node.js — no BrowserWindow, no electron API. This launcher unsets
 * those variables before spawning so the Electron runtime initialises
 * normally (process.type === 'browser', require('electron') returns the API).
 */
'use strict'

const { spawn } = require('child_process')
const path      = require('path')

const electronBin = require('electron')      // resolves to the binary path string
const appDir      = path.resolve(__dirname, '..')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const child = spawn(electronBin, [appDir], { stdio: 'inherit', env })
child.on('close', code => process.exit(code ?? 0))
