/**
 * End-to-end, headless. The built frontend is served by the real backend, as in the container. Own data directory and
 * own ports (the backend on 8501, the stand-in sign-in provider on 8502), so a running development server is never
 * measured.
 *
 *   npm run e2e                      build, start the backend and the stand-in, test
 */
import { defineConfig } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 8501
const PROVIDER_PORT = 8502

/** A fresh data directory per run. Made here and not in a global setup: the server starts first. The workers load
 * this file again and inherit the directory through the environment. */
function dataDir(): string {
  if (process.env.NEXCANVAS_E2E_DATA) return process.env.NEXCANVAS_E2E_DATA
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexcanvas-e2e-'))
  process.env.NEXCANVAS_E2E_DATA = dir
  return dir
}

const DATA_DIR = dataDir()
/** Where the operator's session is kept for the tests (global-setup.ts signs in once). */
export const SIGNED_IN = path.join(DATA_DIR, 'e2e-operator.json')
process.env.NEXCANVAS_E2E_STATE = SIGNED_IN
process.env.NEXCANVAS_E2E_PROVIDER = `http://127.0.0.1:${PROVIDER_PORT}`
// The project's venv on the development machines, the system Python elsewhere.
const venv = path.join('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = fs.existsSync(path.join('..', 'backend', venv)) ? venv : 'python'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    locale: 'en-US',
    storageState: SIGNED_IN,
  },
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
      cwd: path.join('..', 'backend'),
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NEXCANVAS_DATA_DIR: DATA_DIR,
        NEXCANVAS_FRONTEND_DIST: path.resolve('dist'),
        NEXCANVAS_DISABLE_BACKGROUND: '1',
        NEXCANVAS_ARGON2_TIME: '1',
        NEXCANVAS_ARGON2_MEMORY_KIB: '8192',
        NEXCANVAS_ARGON2_PARALLELISM: '1',
        // Never GitHub from a test: port 9 refuses at once.
        NEXCANVAS_UPDATE_URL: 'http://127.0.0.1:9/releases/latest',
        // The code the first account brings; global-setup.ts sends it.
        NEXCANVAS_SETUP_TOKEN: 'e2e-setup-code',
      },
    },
    // A stand-in sign-in provider (nexoidc.spec.ts): signs in at once whoever POST /oidc/next named.
    {
      command: 'node e2e/fake-provider.mjs',
      url: `http://127.0.0.1:${PROVIDER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 20_000,
      env: { FAKE_PROVIDER_PORT: String(PROVIDER_PORT) },
    },
  ],
})
