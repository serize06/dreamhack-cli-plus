import fs from 'fs'
import path from 'path'
import { fileURLToPath } from "url"

import User from '../class/user.js'
import Wargame from '../class/wargame.js'

import Log from '../util/log.js'
import getArgs from '../util/getArgs.js'
import { updateSolveTarget } from '../util/generateSolve.js'

const __dirname = fileURLToPath(new URL(".", import.meta.url))
let EMAIL, PASSWORD, SESSIONID, CSRF, HOME
try {
  const data = JSON.parse(await fs.readFileSync(path.join(__dirname, '../data/user.json'), 'utf8'))
  EMAIL = data.email
  PASSWORD = data.password
  SESSIONID = data.sessionid
  CSRF = data.csrf
  HOME = data.home
} catch (err) {
  Log.error('User config not found. Please run \'dh config\' to set user config.')
  process.exit(1)
}

if (HOME && fs.existsSync(HOME)) process.chdir(HOME)

export default async function vm(wargameLink) {
  const args = getArgs()

  if (!wargameLink) {
    Log.error('Wargame link not found. Please run \'dh help\' to see usage.')
    process.exit(1)
  }

  let sessionid, csrfToken
  if (SESSIONID && CSRF) {
    sessionid = SESSIONID
    csrfToken = CSRF
    Log.success('Using saved sessionid + csrf_token')
  } else if (EMAIL && PASSWORD) {
    const user = new User(EMAIL, PASSWORD)
    const cookie = await user.login()
    sessionid = cookie.sessionid
    csrfToken = cookie.csrf_token
  } else {
    Log.error('No credentials configured. Set --sessionid and --csrf (or --email/--password) via \'dh config\'.')
    process.exit(1)
  }

  const wargame = new Wargame(wargameLink)
  await wargame.init(sessionid)

  if (args['c'] || args['create']) {
    await wargame.create(sessionid, csrfToken)
    const info = await wargame.get(sessionid)
    if (info?.host && info.portMap?.length) {
      const [, hostPort] = info.portMap[0]
      updateSolveTarget(wargame.name, info.host, hostPort)
    }
  } else if (args['g'] || args['get']) {
    const info = await wargame.get(sessionid)
    if (info?.host && info.portMap?.length) {
      const [, hostPort] = info.portMap[0]
      updateSolveTarget(wargame.name, info.host, hostPort)
    }
  } else if (args['d'] || args['delete']) {
    await wargame.delete(sessionid, csrfToken)
  } else {
    Log.error('Invalid option for \'dh vm\'. Use -c/--create, -g/--get, or -d/--delete.')
    process.exit(1)
  }
}
