import fs from 'fs'
import path from 'path'
import Log from './log.js'

function isElf(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46
  } catch {
    return false
  }
}

function findBinary(deployDir) {
  if (!fs.existsSync(deployDir)) return null
  for (const f of fs.readdirSync(deployDir)) {
    if (/\.so($|\.\d)/.test(f)) continue       // shared libs
    if (/^libc(-|\.)/.test(f)) continue         // libc copies
    if (/\.(sh|xinetd|conf|cfg)$/.test(f)) continue
    if (isElf(path.join(deployDir, f))) return f
  }
  return null
}

function findXinetdPort(deployDir) {
  if (!fs.existsSync(deployDir)) return null
  try {
    for (const f of fs.readdirSync(deployDir)) {
      if (f.endsWith('.xinetd') || f.toLowerCase().includes('xinetd')) {
        const m = fs.readFileSync(path.join(deployDir, f), 'utf8').match(/^\s*port\s*=\s*(\d+)/m)
        if (m) return parseInt(m[1], 10)
      }
    }
  } catch {}
  return null
}

function findSolvePy(wargameName) {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, wargameName, 'solve', 'solve.py'),       // cwd is parent of wargame dir
    path.join(cwd, 'solve', 'solve.py'),                    // cwd is the wargame dir
    path.join(cwd, '..', 'solve', 'solve.py'),              // cwd is the solve dir itself
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  // Walk up a few levels in case cwd is deeper inside the wargame tree
  let dir = cwd
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir)
    if (dir === '/' || dir === '.') break
    const p = path.join(dir, wargameName, 'solve', 'solve.py')
    if (fs.existsSync(p)) return p
  }
  return null
}

export function updateSolveTarget(wargameName, host, port) {
  const solvePath = findSolvePy(wargameName)
  if (!solvePath) {
    Log.info(`No solve/solve.py found near cwd (run 'dh create' first)`)
    return
  }
  const original = fs.readFileSync(solvePath, 'utf8')
  const updated = original.replace(
    /^HOST,\s*PORT\s*=.*$/m,
    `HOST, PORT = '${host}', ${port}`
  )
  if (updated === original) {
    Log.info(`solve.py has no 'HOST, PORT = ...' line; left unchanged`)
    return
  }
  fs.writeFileSync(solvePath, updated)
  Log.success(`solve.py target → ${host}:${port}  (${solvePath})`)
}

export default function generateSolve(wargameDir) {
  const solveDir = path.join(wargameDir, 'solve')
  if (fs.existsSync(solveDir)) {
    Log.info(`solve/ already exists, leaving it alone`)
    return
  }

  fs.mkdirSync(solveDir, { recursive: true })

  const deployDir = path.join(wargameDir, 'deploy')
  const binary = findBinary(deployDir) || 'chall'
  const port = findXinetdPort(deployDir) || 9001

  const template = `#!/usr/bin/env python3
from pwn import *

BINARY = '../deploy/${binary}'
HOST, PORT = 'localhost', ${port}

context.binary = BINARY
context.log_level = 'info'

def conn(remote_=False):
    return remote(HOST, PORT) if remote_ else process(BINARY)

io = conn(remote_=False)

# exploit here

io.interactive()
`
  fs.writeFileSync(path.join(solveDir, 'solve.py'), template)
  fs.chmodSync(path.join(solveDir, 'solve.py'), 0o755)
  Log.success(`solve/solve.py created (binary=${binary}, port=${port})`)
}
