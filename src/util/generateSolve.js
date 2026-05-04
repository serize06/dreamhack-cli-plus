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
