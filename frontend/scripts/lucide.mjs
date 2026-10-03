// The Lucide symbols (ISC licence) that nexcanvas already draws its buttons with, as data for the shape library:
// read from lucide-react's own icon files (each exports its __iconNode), every element kept as it is drawn there.
//
//   node scripts/lucide.mjs        after a new lucide-react
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ICONS = path.join(HERE, '..', 'node_modules', 'lucide-react', 'dist', 'esm', 'icons')
const OUT = path.join(HERE, '..', 'src', 'board', 'library', 'lucide.json')

const KEEP = { path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'width', 'height', 'rx'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'] }
const out = {}
for (const file of fs.readdirSync(ICONS).sort()) {
  if (!file.endsWith('.js')) continue
  const text = fs.readFileSync(path.join(ICONS, file), 'utf-8')
  const nodeMatch = /const __iconNode = (\[[\s\S]*?\]);\n/.exec(text)
  const nameMatch = /createLucideIcon\("([a-z0-9-]+)"/.exec(text)
  if (!nodeMatch || !nameMatch) continue
  const name = nameMatch[1]
  if (out[name] || name.length > 40) continue
  // The node is a plain array literal of [tag, {attributes}] with string values only: JSON once the keys are quoted.
  const json = nodeMatch[1].replace(/([{,]\s*)([a-zA-Z][a-zA-Z0-9]*)\s*:/g, '$1"$2":')
  const node = JSON.parse(json)
  const elements = []
  for (const [tag, attrs] of node) {
    if (!KEEP[tag]) continue
    const el = [tag]
    for (const key of KEEP[tag]) el.push(attrs[key] ?? null)
    elements.push(el)
  }
  if (elements.length) out[name] = elements
}
fs.writeFileSync(OUT, JSON.stringify(out))
console.log(`${Object.keys(out).length} symbols, ${Math.round(fs.statSync(OUT).size / 1024)} KB`)
