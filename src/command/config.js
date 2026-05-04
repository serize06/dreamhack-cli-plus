import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { fileURLToPath } from "url"

import Log from '../util/log.js'
import getArgs from '../util/getArgs.js'

const __dirname = fileURLToPath(new URL(".", import.meta.url))

export default async function config() {
  const args = getArgs()

  let EMAIL = ''
  let PASSWORD = ''
  let SESSIONID = ''
  let CSRF = ''
  try {
    const data = JSON.parse(await fs.readFileSync(path.join(__dirname, '../data/user.json')))
    EMAIL = data.email || ''
    PASSWORD = data.password || ''
    SESSIONID = data.sessionid || ''
    CSRF = data.csrf || ''
  } catch (err) {
    // console.log(err)
  }
  if (args['email'] !== undefined) EMAIL = args['email']
  if (args['password'] !== undefined) PASSWORD = args['password']
  if (args['sessionid'] !== undefined) SESSIONID = args['sessionid']
  if (args['csrf'] !== undefined) CSRF = args['csrf']

  if (args['email'] !== undefined || args['password'] !== undefined || args['sessionid'] !== undefined || args['csrf'] !== undefined) {
    await fs.writeFileSync(path.join(__dirname, '../data/user.json'), JSON.stringify({ email: EMAIL, password: PASSWORD, sessionid: SESSIONID, csrf: CSRF }))
  }

  const mask = v => v ? v.slice(0, 4) + '*'.repeat(Math.max(0, v.length - 4)) : ''

  Log.print(chalk.blue('[User Config]'))
  Log.info(`email - ${EMAIL}`)
  Log.info(`password - ${'*'.repeat(PASSWORD.length)}`)
  Log.info(`sessionid - ${mask(SESSIONID)}`)
  Log.info(`csrf - ${mask(CSRF)}`)
}