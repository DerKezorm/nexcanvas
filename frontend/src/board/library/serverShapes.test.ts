/**
 * The server draws boards as small pictures for programs (`/api/v1/boards/{id}/picture.svg`). It cannot read the
 * shipped packages, they live here, so it keeps a copy of their drawings: `backend/app/data/shipped_shapes.json`.
 * This test keeps the copy current; `UPDATE_SERVER_SHAPES=1 npx vitest run serverShapes` writes it anew.
 */
import { BUILTIN } from './builtin'

/** From the frontend folder, where the tests run. */
const FILE = '../backend/app/data/shipped_shapes.json'

type Files = { readFileSync: (file: string, encoding: string) => string; writeFileSync: (file: string, text: string) => void }

function drawings(): string {
  const out: Record<string, { vw: number; vh: number; elements: unknown[] }> = {}
  for (const pkg of BUILTIN) for (const shape of pkg.shapes) if (!shape.native) out[`${pkg.id}/${shape.id}`] = { vw: shape.vw, vh: shape.vh, elements: shape.elements }
  return JSON.stringify(out) + '\n'
}

it('the server has the drawings of the shipped shapes as they are here', async () => {
  // Node's own modules, without their types in the app's build (the tests run in Node).
  const name = 'node:fs'
  const files = (await import(/* @vite-ignore */ name)) as Files
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
  const now = drawings()
  if (env.UPDATE_SERVER_SHAPES) files.writeFileSync(FILE, now)
  expect(files.readFileSync(FILE, 'utf-8')).toBe(now)
})
