import { execSync } from 'child_process'
import http from 'http'
import path from 'path'
import { URL } from 'url'

const repoRoot = path.resolve(__dirname, '..', '..')

function waitForHealth(url: string, timeoutMs: number) {
  const start = Date.now()

  return new Promise<void>((resolve, reject) => {
    const tryOnce = () => {
      const elapsed = Date.now() - start
      if (elapsed > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }

      const target = new URL(url)
      const req = http.request(
        {
          hostname: target.hostname,
          port: target.port || 80,
          path: target.pathname,
          method: 'GET',
        },
        (res) => {
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 500
          if (ok) {
            resolve()
            return
          }
          setTimeout(tryOnce, 2000)
        },
      )

      req.on('error', () => setTimeout(tryOnce, 2000))
      req.end()
    }

    tryOnce()
  })
}

export default async function globalSetup() {
  const skipDocker = process.env.E2E_SKIP_DOCKER === '1'
  if (!skipDocker) {
    execSync('docker compose up -d --build --remove-orphans', {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  }

  const healthUrl = process.env.E2E_HEALTH_URL || 'http://localhost/health'
  const timeoutMs = Number(process.env.E2E_DOCKER_TIMEOUT_MS || 180_000)
  await waitForHealth(healthUrl, timeoutMs)
}
