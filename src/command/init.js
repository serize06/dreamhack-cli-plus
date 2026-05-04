import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import Log from '../util/log.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const USER_JSON = path.join(__dirname, '../data/user.json')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(USER_JSON, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(USER_JSON, JSON.stringify(cfg))
}

export default async function init(arg) {
  const cfg = loadConfig()

  if (!arg) {
    if (cfg.home) {
      Log.info(`Current wargame home: ${cfg.home}`)
      Log.info(`(All 'dh create / vm / analyze' will use this dir regardless of cwd.)`)
      Log.info(`Run 'dh init <path>' to change, or 'dh init .' to use cwd.`)
    } else {
      Log.info(`No wargame home set. 'dh' uses cwd as default.`)
      Log.info(`Run 'dh init <path>' (or 'dh init .') to fix a working directory.`)
    }
    return
  }

  const resolved = path.resolve(arg)
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true })
    Log.info(`Created ${resolved}`)
  } else if (!fs.statSync(resolved).isDirectory()) {
    Log.error(`Not a directory: ${resolved}`)
    process.exit(1)
  }

  cfg.home = resolved
  saveConfig(cfg)
  Log.success(`Wargame home set to ${resolved}`)
}
