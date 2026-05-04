import { execSync } from 'child_process'
import fs from "fs"
import path from "path"
import Log from '../util/log.js'

export default class Docker {
  constructor(name, path) {
    this.name = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'wargame'
    this.path = path
    this.type = '' // dockerfile, docker-compose
  }

  async build() {
    try {
      const cmd = `docker build -t ${this.name} "${this.path}"`
      Log.info(`Docker Build - ${cmd}`)
      await execSync(cmd, { stdio: 'inherit' })
      this.type = 'dockerfile'
      return true
    } catch (err) {
      Log.error(`Docker Build Error: ${err.message}`)
      return false
    }
  }

  async buildAndRunCompose(){
    const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
      .map(f => `${this.path}/${f}`)
      .find(p => fs.existsSync(p))
    if (composeFile){
      try {
        this.composeFile = composeFile
        const cmd = `docker compose -f "${composeFile}" up -d --build`
        Log.info(`Docker Compose Build - ${cmd}`)
        await execSync(cmd, { stdio: 'inherit' })
        this.type = 'docker-compose'
        return true
      } catch (err) {
        Log.error(`Docker Compose Build Error: ${err.message}`)
        return false
      }
    }
    else {
      Log.error(`Not found Docker Compose file at ${this.path}/docker-compose.yml`)
      return false
    }
  }
  
  _detectXinetdPort() {
    try {
      const deployDir = `${this.path}/deploy`
      if (!fs.existsSync(deployDir)) return null
      for (const f of fs.readdirSync(deployDir)) {
        if (f.endsWith('.xinetd') || f.toLowerCase().includes('xinetd')) {
          const content = fs.readFileSync(`${deployDir}/${f}`, 'utf8')
          const m = content.match(/^\s*port\s*=\s*(\d+)/m)
          if (m) return parseInt(m[1], 10)
        }
      }
    } catch {}
    return null
  }

  async run() {
    let portArgs = '-P'
    let cmdArg = ''

    try {
      const inspect = JSON.parse(execSync(`docker inspect ${this.name}`).toString())[0]
      const exposed = inspect?.Config?.ExposedPorts

      if (!exposed || Object.keys(exposed).length === 0) {
        const xinetdPort = this._detectXinetdPort()
        if (xinetdPort) {
          portArgs = `-p ${xinetdPort}:${xinetdPort}`
          Log.info(`No EXPOSE in image; using xinetd port ${xinetdPort}`)
        }
      }

      // Inherited CMD from base image (e.g. ubuntu's /bin/bash) doesn't help — check
      // whether the wargame's own Dockerfile sets CMD/ENTRYPOINT.
      const dockerfilePath = `${this.path}/Dockerfile`
      if (fs.existsSync(dockerfilePath)) {
        const df = fs.readFileSync(dockerfilePath, 'utf8')
        const ownCmd = /^\s*(CMD|ENTRYPOINT)\s/im.test(df)
        if (!ownCmd && fs.existsSync(`${this.path}/deploy/init.sh`)) {
          cmdArg = '/etc/init.sh'
          Log.info('Dockerfile has no CMD/ENTRYPOINT; using /etc/init.sh')
        }
      }
    } catch (err) {
      // best-effort detection; fall through to bare run
    }

    // Remove any prior container that would conflict: same image name OR same
    // published port (catches stale containers from older image digests).
    try {
      const filters = [`--filter ancestor=${this.name}`]
      const portMatch = portArgs.match(/-p\s+(\d+):/)
      if (portMatch) filters.push(`--filter publish=${portMatch[1]}`)
      const all = new Set()
      for (const f of filters) {
        const out = execSync(`docker ps -aq ${f}`).toString().trim()
        out.split('\n').filter(Boolean).forEach(id => all.add(id))
      }
      if (all.size > 0) {
        Log.info(`Removing ${all.size} conflicting container(s)`)
        execSync(`docker rm -f ${[...all].join(' ')}`, { stdio: 'pipe' })
      }
    } catch {}

    const cmd = `docker run -d ${portArgs} ${this.name}${cmdArg ? ' ' + cmdArg : ''}`
    Log.info(`Docker Run - ${cmd}`)
    try {
      this.id = execSync(cmd).toString().slice(0, 12)
      Log.info(`Docker ID - ${this.id}`)
    } catch (err) {
      const stderr = (err.stderr?.toString() || err.message).trim().split('\n').slice(0, 3).join(' | ')
      Log.error(`Docker run failed: ${stderr}`)
      process.exit(1)
    }
  }

  static async ps() {
    const cmd = 'docker ps'
    const containers = (await execSync(cmd)).toString().split('\n').slice(1, -1).map(container => container.split(/\s{2,}/))
    return containers
  }

  async getPort() {
    if (this.type === 'docker-compose') {
      const composeFile = await fs.readFileSync(this.composeFile, 'utf8')
      let ports = composeFile.match(/ports:[\s\S]*?"(\d+:\d+)"/g)
      ports = ports.map(match => match.match(/(\d+:\d+)/)[0].split(':'))
      ports.forEach((port) => {
        Log.success(`Link\n- http://localhost:${port[0]}\n- localhost ${port[0]}`)
      })
      
    } else if (this.type === 'dockerfile') {
      try {
        const portOut = execSync(`docker port ${this.id}`).toString().trim()
        const lines = portOut.split('\n').filter(l => l.includes('->'))
        if (lines.length === 0) {
          Log.error('No published ports — container may have exited or image had no EXPOSE')
          return
        }
        const ports = [...new Set(lines.map(l => {
          const m = l.match(/->\s*(?:\[?[\d.:a-fA-F]+\]?):(\d+)/)
          return m ? m[1] : null
        }).filter(Boolean))]
        ports.forEach((port) => {
          Log.success(`Link\n- http://localhost:${port}\n- localhost ${port}`)
        })
        return ports[0]
      } catch (err) {
        Log.error(`getPort failed: ${err.message}`)
      }
    }
  }

  async copyLibc(outDir) {
    const absOut = path.resolve(outDir)
    const targets = [
      '/lib/x86_64-linux-gnu/libc.so.6',
      '/lib/i386-linux-gnu/libc.so.6',
      '/lib64/ld-linux-x86-64.so.2',
      '/lib/ld-linux.so.2',
      '/lib/aarch64-linux-gnu/libc.so.6',
      '/lib/ld-linux-aarch64.so.1',
    ]
    const inner = `for f in ${targets.join(' ')}; do [ -f $f ] && cp -L $f /out/ && echo "copied $f" || true; done; exit 0`
    const cmd = `docker run --rm -v "${absOut}:/out" --entrypoint sh ${this.name} -c '${inner}'`
    Log.info(`Copy libc from image '${this.name}'`)
    try {
      execSync(cmd, { stdio: 'inherit' })
      Log.success(`libc artifacts saved to ${absOut}/`)
      return true
    } catch (err) {
      Log.error(`Failed to copy libc: ${err.message}`)
      return false
    }
  }

  static applyDockerfileChmods(wargameDir) {
    const dfPath = `${wargameDir}/Dockerfile`
    if (!fs.existsSync(dfPath)) return

    const df = fs.readFileSync(dfPath, 'utf8')

    // Map container destination paths back to local source paths.
    const dstToSrc = new Map()
    const addRe = /^\s*(?:ADD|COPY)\s+(?:--[\w=:.-]+\s+)*(\S+)\s+(\S+)/img
    let m
    while ((m = addRe.exec(df)) !== null) {
      const [, src, dst] = m
      dstToSrc.set(dst, src)
    }

    const chmodRe = /^\s*RUN\s+chmod\s+(?:-R\s+)?([0-7]{3,4})\s+([^\n#]+)/img
    let applied = 0
    while ((m = chmodRe.exec(df)) !== null) {
      const mode = parseInt(m[1], 8)
      const targets = m[2].trim().split(/\s+/)
      for (const dst of targets) {
        const src = dstToSrc.get(dst)
        if (!src) continue
        const localPath = path.join(wargameDir, src)
        try {
          fs.chmodSync(localPath, mode)
          Log.info(`chmod ${m[1]} ${src}`)
          applied++
        } catch {
          // local file may not exist (e.g. dst was a generated path); skip
        }
      }
    }
    if (applied === 0) {
      // Defensive fallback: any extracted ELF binary gets +x so user can `gdb ./binary`.
      Docker._chmodElfFiles(wargameDir)
    }
  }

  static _chmodElfFiles(dir) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          Docker._chmodElfFiles(full)
        } else if (entry.isFile()) {
          try {
            const fd = fs.openSync(full, 'r')
            const buf = Buffer.alloc(4)
            fs.readSync(fd, buf, 0, 4, 0)
            fs.closeSync(fd)
            if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
              fs.chmodSync(full, 0o755)
              Log.info(`chmod 755 ${path.relative(dir, full)} (ELF)`)
            }
          } catch {}
        }
      }
    } catch {}
  }

  static async getDockerfile() {
    /* 1. traverse all files in wargame directory
     * 2. if there is Dockerfiles(They can be multiple), return paths of all Dockerfiles */
  }
}
