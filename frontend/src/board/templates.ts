/** Starting points for a new board. Each fills the board with a little structure and nothing else. */

import { SHIPPED, shippedDoc, type Category } from './templateCatalog'
import type { Doc, Item, LineItem, NoteColor } from './types'

export type { Category }
export { CATEGORIES } from './templateCatalog'

export type TemplateId = 'blank' | 'mood' | 'retro' | 'kanban' | 'mindmap' | 'week'

export const TEMPLATES: TemplateId[] = ['blank', 'mood', 'retro', 'kanban', 'mindmap', 'week']

const uid = () => Math.random().toString(36).slice(2, 10)

export type Say = (key: string, vars?: Record<string, unknown>) => string

export function templateDoc(id: TemplateId, t: Say): Doc {
  const items: Item[] = []
  const lines: LineItem[] = []
  const text = (x: number, y: number, words: string, size: 'l' | 'xl' = 'l', w = 260) =>
    items.push({ id: uid(), kind: 'text', x, y, w, h: size === 'xl' ? 60 : 40, text: words, size, color: 'auto' })
  const note = (x: number, y: number, color: NoteColor, words = '') => {
    const item: Item = { id: uid(), kind: 'note', x, y, w: 180, h: 180, color, text: words }
    items.push(item)
    return item.id
  }
  const frame = (x: number, y: number, w: number, h: number) =>
    items.push({ id: uid(), kind: 'shape', x, y, w, h, shape: 'round', fill: 'none', stroke: '#a1a1aa', text: '' })

  switch (id) {
    case 'blank':
      break
    case 'mood':
      text(0, -90, t('templates.mood.title'), 'xl', 520)
      for (let i = 0; i < 6; i++) frame((i % 3) * 230, Math.floor(i / 3) * 230, 210, 210)
      note(700, 0, 'yellow', t('templates.mood.note'))
      break
    case 'retro': {
      text(0, -90, t('templates.retro.title'), 'xl', 520)
      const cols: [string, NoteColor][] = [
        [t('templates.retro.good'), 'green'],
        [t('templates.retro.bad'), 'pink'],
        [t('templates.retro.next'), 'blue'],
      ]
      cols.forEach(([name, color], i) => {
        text(i * 240, 0, name)
        note(i * 240, 60, color)
      })
      break
    }
    case 'kanban': {
      text(0, -90, t('templates.kanban.title'), 'xl', 520)
      ;[t('templates.kanban.todo'), t('templates.kanban.doing'), t('templates.kanban.done')].forEach((name, i) => {
        frame(i * 260, 0, 240, 620)
        text(i * 260 + 20, 16, name, 'l', 200)
      })
      note(30, 80, 'yellow', t('templates.kanban.first'))
      break
    }
    case 'mindmap': {
      const middle: Item = { id: uid(), kind: 'shape', x: 0, y: 0, w: 220, h: 110, shape: 'ellipse', fill: '#ff8a70', stroke: 'none', text: t('templates.mindmap.topic') }
      items.push(middle)
      const spots: [number, number, NoteColor][] = [
        [-320, -200, 'yellow'],
        [320, -200, 'blue'],
        [-320, 180, 'green'],
        [320, 180, 'pink'],
      ]
      spots.forEach(([x, y, color], i) => {
        const id = note(x, y, color, t('templates.mindmap.idea', { n: i + 1 }))
        lines.push({ id: uid(), kind: 'line', a: { item: middle.id, x: 0, y: 0 }, b: { item: id, x: 0, y: 0 }, color: 'auto', width: 2, arrow: 'none', curve: true })
      })
      break
    }
    case 'week': {
      text(0, -90, t('templates.week.title'), 'xl', 520)
      const days = t('templates.week.days').split(',')
      days.forEach((day, i) => {
        frame(i * 200, 0, 185, 420)
        text(i * 200 + 16, 14, day, 'l', 150)
      })
      break
    }
  }
  return { items, lines }
}

/** A template kept by a space or the server (block 5). */
export interface OwnTemplate {
  key: number
  scope: 'space' | 'server'
  space: number | null
  name: string
  content: Doc
}

/** Every shipped template with its group: the first six as "start", then the catalogue of block 5. */
export const CATALOG: { id: string; category: Category }[] = [...TEMPLATES.map((id) => ({ id, category: 'start' as Category })), ...SHIPPED.map(({ id, category }) => ({ id, category }))]

/** The board a shipped template builds, in the language of the page. */
export function catalogDoc(id: string, t: Say, language: string): Doc {
  if ((TEMPLATES as string[]).includes(id)) return templateDoc(id as TemplateId, t)
  return shippedDoc(id, language) ?? { items: [], lines: [] }
}

/**
 * Only the frame of a board, for a template "without content": frames, shapes, texts and lines stay, notes, drawings,
 * photos, files and links go, with the lines that led to them.
 */
export function skeleton(doc: Doc): Doc {
  const items = doc.items.filter((i) => i.kind === 'frame' || i.kind === 'shape' || i.kind === 'text')
  const kept = new Set(items.map((i) => i.id))
  const lines = doc.lines.filter((l) => (!l.a.item || kept.has(l.a.item)) && (!l.b.item || kept.has(l.b.item)))
  return { ...doc, items, lines }
}
