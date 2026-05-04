import axios from 'axios'

import DREAMHACK from '../data/dreamhack.js'
import Log from '../util/log.js'

export default class Wargame {
  constructor(link) {
    const cleanLink = link.replace(/\/$/, '')
    const wargameURL = new URL(cleanLink)
    const baseAPI = DREAMHACK.api + wargameURL.pathname

    this.pageUrl = cleanLink
    this.link = baseAPI + '/'
    this.vmLink = baseAPI + '/live/'
    this.submitLink = baseAPI + '/auth/'
    this.downloadEndpoint = baseAPI + '/download/'
  }

  async init(sessionid, csrfToken) {
    const wargamePage = await axios.get(this.link, {
      headers: { Cookie: `sessionid=${sessionid}` }
    })
    const wargameJSON = wargamePage.data

    this.name = wargameJSON.title
    Log.info(`Wargame Name - ${this.name}`)

    if (csrfToken) {
      try {
        const downloadResp = await axios.post(this.downloadEndpoint, null, {
          headers: {
            Cookie: `sessionid=${sessionid}; csrf_token=${csrfToken}`,
            'x-csrftoken': csrfToken,
            'Referer': this.pageUrl,
            'Origin': DREAMHACK.url,
            'Accept': 'application/json',
          }
        })
        this.downloadLink = downloadResp.data
      } catch (err) {
        // Not fatal — only `dh create` needs the download URL.
      }
    }
  }

  async create(sessionid, csrfToken) {
    try {
      const result = await axios.post(this.vmLink, {}, {
        headers: {
          Cookie: `sessionid=${sessionid}; csrf_token=${csrfToken}`,
          'x-csrftoken': csrfToken,
          'Referer': this.pageUrl,
          'Origin': DREAMHACK.url,
        }
      })
      Log.success(`VM created - vmid=${result.data?.vmid ?? 'unknown'}`)
    } catch (err) {
      Log.error(`VM create failed (${err.response?.status || err.code}): ${JSON.stringify(err.response?.data) || err.message}`)
      process.exit(1)
    }
  }

  async get(sessionid) {
    try {
      const VMPage = await axios.get(this.vmLink, {
        headers: { Cookie: `sessionid=${sessionid}` }
      })

      const host = VMPage.data.host
      const portMap = VMPage.data.port_mappings

      if (host && portMap) {
        Log.success(`VM is running`)
        Log.info(`Host: ${host}`)
        Log.info(`Port: ${portMap
          .map((val) => `${val[1]}/${val[0]} -> ${val[2]}/${val[0]}`)
          .reduce((prev, curr, idx) => (idx === 0 ? curr : `${prev}, ${curr}`))
        }`)
        Log.info(`pwnable: ${portMap
          .map((val) => `nc ${host} ${val[1]}`)
          .reduce((prev, curr, idx) => (idx === 0 ? curr : `${prev}, ${curr}`))
        }`)
        Log.info(`web: ${portMap
          .map((val) => `https://${host}:${val[1]}/`)
          .reduce((prev, curr, idx) => (idx === 0 ? curr : `${prev}, ${curr}`))
        }`)
      } else {
        Log.error(`VM is not running`)
      }
    } catch (err) {
      Log.error(`VM get failed (${err.response?.status || err.code})`)
    }
  }

  async delete(sessionid, csrfToken) {
    try {
      await axios.delete(this.vmLink, {
        headers: {
          Cookie: `sessionid=${sessionid}; csrf_token=${csrfToken}`,
          'x-csrftoken': csrfToken,
          'Referer': this.pageUrl,
          'Origin': DREAMHACK.url,
        }
      })
      Log.success('VM deleted')
    } catch (err) {
      Log.error(`VM delete failed (${err.response?.status || err.code})`)
    }
  }

  async submit(flag, sessionid, csrfToken) {
    await axios.post(this.submitLink, { flag }, {
      headers: {
        Cookie: `sessionid=${sessionid}; csrf_token=${csrfToken}`,
        'x-csrftoken': csrfToken,
        'Referer': this.pageUrl,
        'Origin': DREAMHACK.url,
      }
    }).then(() => {
      Log.success('Correct!')
    }).catch((err) => {
      if (err.response?.status === 400) {
        Log.error(`Wrong: ${err.response?.data?.flag?.[0] || JSON.stringify(err.response?.data)}`)
        Log.info(`Submitted flag: ${flag}`)
      } else {
        Log.error(`Submit failed (${err.response?.status || err.code}): ${JSON.stringify(err.response?.data) || err.message}`)
      }
    })
  }
}
