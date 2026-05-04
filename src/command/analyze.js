import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

import User from '../class/user.js'
import Wargame from '../class/wargame.js'

import Log from '../util/log.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let EMAIL, PASSWORD, SESSIONID, CSRF
try {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/user.json'), 'utf8'))
  EMAIL = data.email
  PASSWORD = data.password
  SESSIONID = data.sessionid
  CSRF = data.csrf
} catch {
  // analyze can run offline against a dir, so missing config is non-fatal
}

function findWargameDirByName(name) {
  const cwd = process.cwd()
  const checks = (dir) =>
    fs.existsSync(path.join(dir, 'Dockerfile')) ||
    fs.existsSync(path.join(dir, 'deploy'))

  const tried = [
    path.join(cwd, name),
    cwd,
    path.dirname(cwd),
    path.join(path.dirname(cwd), name),
  ]
  for (const t of tried) {
    if (fs.existsSync(t) && checks(t)) return t
  }
  return null
}

async function resolveDir(arg) {
  if (!arg) {
    // No arg: use cwd
    if (fs.existsSync(path.join(process.cwd(), 'Dockerfile')) ||
        fs.existsSync(path.join(process.cwd(), 'deploy'))) {
      return process.cwd()
    }
    Log.error('Pass a wargame URL or path, or run from inside a wargame directory.')
    process.exit(1)
  }

  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    let sessionid
    if (SESSIONID) {
      sessionid = SESSIONID
    } else if (EMAIL && PASSWORD) {
      const cookie = await new User(EMAIL, PASSWORD).login()
      sessionid = cookie.sessionid
    } else {
      Log.error('No credentials configured. Pass a directory path instead, or run dh config.')
      process.exit(1)
    }
    const wargame = new Wargame(arg)
    await wargame.init(sessionid)
    const dir = findWargameDirByName(wargame.name)
    if (!dir) {
      Log.error(`Couldn't find directory for '${wargame.name}' near cwd. Run 'dh create' first or cd into it.`)
      process.exit(1)
    }
    return dir
  }

  const resolved = path.resolve(arg)
  if (!fs.existsSync(resolved)) {
    Log.error(`Directory not found: ${resolved}`)
    process.exit(1)
  }
  return resolved
}

function hex(n) {
  return '0x' + n.toString(16)
}

function renderMarkdown(d) {
  const lines = []
  lines.push(`# Analysis — \`${path.basename(d.wargame_dir)}\``)
  lines.push('')

  if (d.binary) {
    const b = d.binary
    lines.push(`## Binary: \`${b.path}\``)
    lines.push('')
    lines.push('| Field | Value |')
    lines.push('|---|---|')
    lines.push(`| Arch | ${b.arch} ${b.bits}-bit |`)
    lines.push(`| RELRO | ${b.relro} |`)
    lines.push(`| Stack | ${b.canary ? 'Canary found' : 'No canary'} |`)
    lines.push(`| NX | ${b.nx ? 'Enabled' : 'Disabled'} |`)
    lines.push(`| PIE | ${b.pie ? 'Enabled' : 'Disabled'} |`)
    if (b.buildid) lines.push(`| BuildID | \`${b.buildid}\` |`)
    lines.push('')

    if (Object.keys(b.symbols || {}).length) {
      lines.push('### Interesting symbols')
      lines.push('')
      for (const [s, addr] of Object.entries(b.symbols)) {
        lines.push(`- \`${s}\` @ ${hex(addr)}`)
      }
      lines.push('')
    }

    if (Object.keys(b.plt || {}).length) {
      lines.push('### PLT entries')
      lines.push('')
      for (const [s, addr] of Object.entries(b.plt)) {
        lines.push(`- \`${s}@plt\` @ ${hex(addr)}`)
      }
      lines.push('')
    }

    if (Object.keys(b.got || {}).length) {
      lines.push('### GOT entries (leak targets)')
      lines.push('')
      for (const [s, addr] of Object.entries(b.got)) {
        lines.push(`- \`${s}@got\` @ ${hex(addr)}`)
      }
      lines.push('')
    }

    if (Object.keys(b.gadgets || {}).length) {
      lines.push('### ROP gadgets')
      lines.push('')
      lines.push('```')
      for (const [g, addr] of Object.entries(b.gadgets)) {
        lines.push(`${hex(addr).padEnd(12)} ${g}`)
      }
      lines.push('```')
      lines.push('')
    }
  } else if (d.binary_error) {
    lines.push(`> binary: ${d.binary_error}`)
    lines.push('')
  }

  if (d.libc) {
    const l = d.libc
    lines.push(`## Libc: \`${l.path}\``)
    lines.push('')
    if (l.version) lines.push(`- Version: **${l.version}**`)
    if (l.ubuntu) lines.push(`- Ubuntu build: \`${l.ubuntu}\``)
    if (l.buildid) lines.push(`- BuildID: \`${l.buildid}\` — paste into https://libc.rip if version unknown`)
    lines.push('')

    if (Object.keys(l.symbols || {}).length) {
      lines.push('### Symbol offsets')
      lines.push('')
      for (const [s, addr] of Object.entries(l.symbols)) {
        lines.push(`- \`${s}\` @ ${hex(addr)}`)
      }
      lines.push('')
    }

    if (Object.keys(l.strings || {}).length) {
      lines.push('### String offsets')
      lines.push('')
      for (const [s, addr] of Object.entries(l.strings)) {
        lines.push(`- \`${s}\` @ ${hex(addr)}`)
      }
      lines.push('')
    }

    if (Object.keys(l.leak_offsets || {}).length) {
      lines.push('### Leak → libc_base offsets')
      lines.push('')
      lines.push('Whatever address you leak, find which symbol it corresponds to and subtract:')
      lines.push('')
      lines.push('```python')
      for (const [s, addr] of Object.entries(l.leak_offsets)) {
        lines.push(`# if leak == ${s}:`)
        lines.push(`libc_base = leak - ${hex(addr)}   # libc.sym['${s}']`)
      }
      lines.push('```')
      lines.push('')
    }
  }

  if (d.one_gadget && d.one_gadget.length) {
    lines.push('## one_gadget candidates')
    lines.push('')
    lines.push('```python')
    lines.push('# After computing libc_base:')
    for (const o of d.one_gadget) {
      lines.push(`one_gadget = libc_base + ${hex(o)}`)
    }
    lines.push('```')
    lines.push('Constraints vary per gadget — run `one_gadget <libc>` to see them, then test in gdb.')
    lines.push('')
  }

  lines.push('## Heap base recovery patterns')
  lines.push('')
  lines.push('```python')
  lines.push('# Safe-linking unmangle (glibc 2.32+):')
  lines.push('def unmangle(mangled):')
  lines.push('    return ((mangled >> 12) ^ mangled) & ((1 << 64) - 1)')
  lines.push('heap_addr = unmangle(leak)')
  lines.push('heap_base = heap_addr & ~0xfff   # if leak was a heap pointer near the base')
  lines.push('')
  lines.push('# Pre-2.32 (no mangling): leak is a raw heap pointer')
  lines.push('heap_base = leak & ~0xfff')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}

export default async function analyze(arg) {
  const wargameDir = await resolveDir(arg)
  Log.info(`Analyzing ${wargameDir}`)

  const helperPath = path.join(__dirname, '../util/analyze.py')
  let raw
  try {
    raw = execSync(`python3 "${helperPath}" "${wargameDir}"`, {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    })
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message).trim().split('\n').slice(-3).join('\n')
    Log.error(`Helper failed:\n${msg}`)
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    Log.error(`Invalid JSON from helper:\n${raw.slice(0, 400)}`)
    process.exit(1)
  }

  if (data.error) {
    Log.error(data.error)
    process.exit(1)
  }

  const md = renderMarkdown(data)

  const solveDir = path.join(wargameDir, 'solve')
  fs.mkdirSync(solveDir, { recursive: true })
  const outPath = path.join(solveDir, 'analysis.md')
  fs.writeFileSync(outPath, md)
  Log.success(`Wrote ${outPath}`)

  console.log()
  console.log(md)
}
