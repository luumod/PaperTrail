const { spawn } = require('node:child_process')
const http = require('node:http')

const isWindows = process.platform === 'win32'
const devUrl = 'http://127.0.0.1:5173'
const npmCommand = isWindows ? 'npm.cmd' : 'npm'
const npxCommand = isWindows ? 'npx.cmd' : 'npx'

const spawnCommand = (command, args, options = {}) => {
  if (!isWindows) {
    return spawn(command, args, {
      stdio: 'inherit',
      ...options,
      shell: false,
    })
  }

  return spawn('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
    stdio: 'inherit',
    ...options,
    shell: false,
  })
}

const isViteReady = () =>
  new Promise((resolve) => {
    const req = http.get(devUrl, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(500, () => {
      req.destroy()
      resolve(false)
    })
  })

const waitForVite = () =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now()

    const tryConnect = async () => {
      if (await isViteReady()) {
        resolve()
        return
      }

      if (Date.now() - startedAt > 30_000) {
        reject(new Error('Timed out waiting for Vite dev server at http://127.0.0.1:5173'))
        return
      }

      setTimeout(tryConnect, 300)
    }

    tryConnect()
  })

const start = async () => {
  let vite = null

  if (!(await isViteReady())) {
    vite = spawnCommand(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1'])
  }

  await waitForVite()

  const electron = spawnCommand(npxCommand, ['electron', '.'], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
    },
  })

  electron.on('exit', (code) => {
    if (vite) vite.kill()
    process.exit(code ?? 0)
  })

  process.on('SIGINT', () => {
    if (vite) vite.kill()
    electron.kill()
    process.exit(0)
  })
}

start().catch((error) => {
  console.error(error)
  process.exit(1)
})
