import { execSync } from 'child_process'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')

export default async function globalTeardown() {
  const skipDocker = process.env.E2E_SKIP_DOCKER === '1'
  const keepDocker = process.env.E2E_KEEP_DOCKER === '1'

  if (skipDocker || keepDocker) {
    return
  }

  execSync('docker compose down', {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
