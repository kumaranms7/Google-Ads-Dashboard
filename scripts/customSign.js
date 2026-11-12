// Custom Windows signing hook for electron-builder.
//
// electron-builder normally auto-downloads a bundled winCodeSign package to
// get signtool.exe, extracting it with 7-Zip. That archive contains two
// macOS symlink entries (darwin/.../lib/*.dylib) which 7-Zip cannot recreate
// without SeCreateSymbolicLinkPrivilege (Administrator, or Developer Mode
// enabled) — so on a standard non-elevated Windows account the extraction
// always fails with exit code 2, even though the Windows binaries we
// actually need extract successfully before that error.
//
// This script bypasses that entirely: it reuses electron-builder's own
// computed signtool arguments (certificate, hash algorithm, timestamp
// server — all driven by the normal CSC_LINK/CSC_KEY_PASSWORD env vars and
// build config) but runs them against a signtool.exe we already have on
// disk in scripts/bin/, instead of the one electron-builder would otherwise
// try (and fail) to download.
const path = require('path')
const { execFileSync } = require('child_process')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function customSign(configuration) {
  // If CSC_LINK/CSC_KEY_PASSWORD aren't set (e.g. running `npm run dist`
  // directly instead of scripts\build-signed.ps1), electron-builder resolves
  // its internal cscInfo to null, and computeSignToolArgs() below throws a
  // cryptic "Cannot read properties of null (reading 'file')" deep inside
  // its own code with no indication of the real cause. Fail fast here with
  // an actionable message instead.
  if (!process.env.CSC_LINK) {
    throw new Error(
      'No code-signing certificate configured (CSC_LINK is not set). ' +
      'Run scripts\\build-signed.ps1 instead of `npm run dist` directly — ' +
      'it sets CSC_LINK/CSC_KEY_PASSWORD before building.'
    )
  }

  const signtoolPath = path.join(__dirname, 'bin', 'signtool.exe')
  const args = configuration.computeSignToolArgs(true)

  // Windows Defender (or another AV) briefly holds a freshly-written
  // installer exe open while it scans it — signtool then fails with
  // "The file is being used by another process." This is transient (the
  // lock clears in a few seconds), not a real signing failure, so retry a
  // few times with backoff instead of letting one bad-timing scan fail the
  // whole build. electron-builder's own built-in retry wraps this call too,
  // but its window is too short for a slow AV scan on a large installer.
  const maxAttempts = 6
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const output = execFileSync(signtoolPath, args, { encoding: 'utf8' })
      process.stdout.write(output)
      return
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '')
      process.stdout.write(output)
      const isFileLocked = /being used by another process/i.test(output)
      if (!isFileLocked || attempt === maxAttempts) throw err
      const delayMs = 3000 * attempt
      console.log(`[customSign] Output file locked (likely an antivirus scan) — retrying in ${delayMs / 1000}s (attempt ${attempt}/${maxAttempts})`)
      await sleep(delayMs)
    }
  }
}
