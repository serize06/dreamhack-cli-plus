import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { fileURLToPath } from "url"

import User from '../class/user.js'
import Docker from '../class/docker.js'
import Wargame from '../class/wargame.js'

import Log from '../util/log.js'
import downloadFile from '../util/downloadFile.js'
import getArgs from '../util/getArgs.js'

const __dirname = fileURLToPath(new URL(".", import.meta.url))
let EMAIL, PASSWORD, SESSIONID, CSRF
try {
  const data = JSON.parse(await fs.readFileSync(path.join(__dirname, '../data/user.json'), 'utf8'))
  EMAIL = data.email
  PASSWORD = data.password
  SESSIONID = data.sessionid
  CSRF = data.csrf
} catch (err) {
  Log.error('User config not found. Please run \'dh config\' to set user config.')
  process.exit(1)
}

export default async function create(wargameLink) {
  const args = getArgs()

  if (!wargameLink) {
    Log.error('Wargame link not found. Please run \'dh help\' to see usage.')
    process.exit(1)
  }

  let sessionid, csrfToken
  if (SESSIONID && CSRF) {
    sessionid = SESSIONID
    csrfToken = CSRF
    Log.success(`Using saved sessionid + csrf_token`)
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
  const isContinue = args['c'] || args['continue']

  if (isContinue) {
    await wargame.init(sessionid)
    if (!fs.existsSync(`./${wargame.name}`)) {
      Log.error(`Wargame directory './${wargame.name}' not found. Run 'dh create' (without --continue) first.`)
      process.exit(1)
    }
    Log.success(`Reusing existing './${wargame.name}' (skipping download)`)
  } else {
    await wargame.init(sessionid, csrfToken)

    await downloadFile(wargame.downloadLink, `${wargame.name}.zip`)
    Log.info('Wargame Downloaded')

    const zip = new AdmZip(`${wargame.name}.zip`)
    zip.extractAllTo(`./${wargame.name}`, true)
    Log.info('Wargame Extracted')
    await fs.unlinkSync(`${wargame.name}.zip`)
    Log.info('Wargame Zip File Removed')
  }

  if (args['d'] || args['docker']) {
    const docker = new Docker(wargame.name, `./${wargame.name}`)
    let builtOK = false
    const composeBuildSuccess = await docker.buildAndRunCompose()
    if (composeBuildSuccess) {
      Log.success('Docker Compose Build Success')
      await docker.getPort()
      builtOK = true
    } else {
      Log.error('Docker Compose Build Fail')
      const buildSuccess = await docker.build()
      if (buildSuccess) {
        Log.success('Docker Build Success')
        await docker.run()
        await docker.getPort()
        builtOK = true
      } else {
        Log.error('Docker Build Fail')
      }
    }

    if (builtOK && (args['l'] || args['libc'])) {
      await docker.copyLibc(`./${wargame.name}`)
    }
  }

  console.log()
}
