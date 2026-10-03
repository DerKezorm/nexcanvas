/**
 * The templates that come with nexcanvas (block 5), in groups as Visio's: flow and process, project, rooms,
 * network, thinking, organisation. Each one builds a real board from the shapes of the shipped packages: frames as
 * scenes where a board has parts, a background that fits (squared paper for a plan, millimetres for a floor plan),
 * and words in the language of the page.
 */
import { BUILTIN } from './library/builtin'
import type { Background, Doc, Item, LineItem, NoteColor, ShapeKind } from './types'

export type Category = 'start' | 'flow' | 'project' | 'room' | 'network' | 'thinking' | 'organisation'
export const CATEGORIES: Category[] = ['start', 'flow', 'project', 'room', 'network', 'thinking', 'organisation']

const uid = () => Math.random().toString(36).slice(2, 10)

/** Builds a board: items in order, lines between them, the words in one language. */
class Sheet {
  items: Item[] = []
  lines: LineItem[] = []
  background?: Background
  constructor(readonly de: boolean) {}

  say(de: string, en: string): string {
    return this.de ? de : en
  }

  text(x: number, y: number, words: string, size: 's' | 'm' | 'l' | 'xl' = 'l', w = 300): string {
    const id = uid()
    this.items.push({ id, kind: 'text', x, y, w, h: size === 'xl' ? 60 : size === 'l' ? 40 : 30, text: words, size, color: 'auto' })
    return id
  }

  note(x: number, y: number, color: NoteColor, words = '', w = 180, h = 180): string {
    const id = uid()
    this.items.push({ id, kind: 'note', x, y, w, h, color, text: words })
    return id
  }

  frame(x: number, y: number, w: number, h: number, title: string, color = '#ff8a70'): string {
    const id = uid()
    this.items.push({ id, kind: 'frame', x, y, w, h, title, color })
    return id
  }

  shape(kind: ShapeKind, x: number, y: number, w: number, h: number, fill: string, words = '', stroke = 'none'): string {
    const id = uid()
    this.items.push({ id, kind: 'shape', x, y, w, h, shape: kind, fill, stroke, text: words })
    return id
  }

  /** A shape of a shipped package at its own size (or the one given), with its own fill unless another is given. */
  lib(key: string, x: number, y: number, words = '', size?: { w?: number; h?: number }, fill?: string): string {
    const [pkg, shape] = key.split('/')
    const def = BUILTIN.find((p) => p.id === pkg)?.shapes.find((s) => s.id === shape)
    if (!def) throw new Error('no shape ' + key)
    const id = uid()
    const w = size?.w ?? def.w ?? def.vw
    const h = size?.h ?? def.h ?? def.vh
    this.items.push({ id, kind: 'shape', x, y, w, h, shape: 'rect', lib: key, fill: fill ?? def.fill ?? '#60a5fa', stroke: 'none', text: words })
    return id
  }

  join(a: string, b: string, look: { arrow?: 'none' | 'end' | 'both'; curve?: boolean; dashed?: boolean } = {}): void {
    this.lines.push({ id: uid(), kind: 'line', a: { item: a, x: 0, y: 0 }, b: { item: b, x: 0, y: 0 }, color: 'auto', width: 2, arrow: look.arrow ?? 'end', curve: look.curve ?? false, ...(look.dashed ? { dashed: true } : {}) })
  }

  doc(): Doc {
    return { items: this.items, lines: this.lines, ...(this.background ? { background: this.background } : {}) }
  }
}

type Build = (s: Sheet) => void

// ---------- Flow and process ----------

const flowchart: Build = (s) => {
  s.background = { pattern: 'dots', color: 'auto' }
  s.text(0, -100, s.say('Ablauf', 'Flowchart'), 'xl', 500)
  const start = s.lib('flow/terminator', 30, 0, s.say('Start', 'Start'))
  const input = s.lib('flow/data', 30, 120, s.say('Eingang prüfen', 'Check what came in'))
  const ask = s.lib('flow/decision', 30, 250, s.say('In Ordnung?', 'All right?'))
  const work = s.lib('flow/process', 30, 410, s.say('Bearbeiten', 'Work on it'))
  const back = s.lib('flow/process', 300, 260, s.say('Nachfragen', 'Ask back'))
  const end = s.lib('flow/terminator', 30, 540, s.say('Ende', 'End'))
  s.join(start, input)
  s.join(input, ask)
  s.join(ask, work)
  s.join(ask, back)
  s.join(back, input, { curve: true })
  s.join(work, end)
  s.text(110, 352, s.say('Ja', 'Yes'), 's', 60)
  s.text(185, 268, s.say('Nein', 'No'), 's', 60)
}

const swimlanes: Build = (s) => {
  s.text(0, -100, s.say('Prozess mit Zuständigkeiten', 'Process with responsibilities'), 'xl', 700)
  const lanes = [s.say('Kunde', 'Customer'), s.say('Vertrieb', 'Sales'), s.say('Lager', 'Warehouse')]
  lanes.forEach((name, i) => s.lib('project/lane', 0, i * 170, name, { w: 900, h: 160 }))
  const ask = s.lib('flow/terminator', 40, 70, s.say('Bestellt', 'Orders'))
  const offer = s.lib('flow/process', 240, 230, s.say('Angebot', 'Offer'))
  const ok = s.lib('flow/decision', 440, 210, s.say('Freigabe?', 'Approved?'))
  const pack = s.lib('flow/process', 640, 400, s.say('Packen', 'Pack'))
  const sent = s.lib('flow/terminator', 640, 70, s.say('Erhalten', 'Received'))
  s.join(ask, offer)
  s.join(offer, ok)
  s.join(ok, pack)
  s.join(pack, sent)
}

const decisionTree: Build = (s) => {
  s.text(0, -100, s.say('Entscheidungsbaum', 'Decision tree'), 'xl', 600)
  const root = s.lib('flow/decision', 300, 0, s.say('Frage', 'Question'))
  const a = s.lib('flow/decision', 80, 180, s.say('Option A?', 'Option A?'))
  const b = s.lib('flow/decision', 520, 180, s.say('Option B?', 'Option B?'))
  const leaves = [
    [0, a, s.say('Ergebnis 1', 'Outcome 1')],
    [170, a, s.say('Ergebnis 2', 'Outcome 2')],
    [440, b, s.say('Ergebnis 3', 'Outcome 3')],
    [610, b, s.say('Ergebnis 4', 'Outcome 4')],
  ] as const
  s.join(root, a)
  s.join(root, b)
  for (const [x, from, words] of leaves) s.join(from, s.lib('flow/terminator', x, 370, words))
}

// ---------- Project ----------

const gantt: Build = (s) => {
  s.background = { pattern: 'grid', color: 'auto' }
  s.text(0, -110, s.say('Zeitplan', 'Schedule'), 'xl', 500)
  const weeks = 8
  for (let w = 0; w < weeks; w++) s.text(240 + w * 96, -48, s.say(`KW ${w + 1}`, `Week ${w + 1}`), 'm', 90)
  const rows: [string, number, number, string][] = [
    [s.say('Planung', 'Planning'), 0, 2, '#a78bfa'],
    [s.say('Entwurf', 'Design'), 1, 3, '#60a5fa'],
    [s.say('Umsetzung', 'Build'), 3, 6, '#4ade80'],
    [s.say('Test', 'Testing'), 5, 7, '#fbbf24'],
    [s.say('Einführung', 'Launch'), 7, 8, '#ff8a70'],
  ]
  rows.forEach(([name, from, to, color], i) => {
    s.text(0, i * 72 + 4, name, 'm', 220)
    s.lib('project/bar', 240 + from * 96, i * 72, '', { w: (to - from) * 96 - 8, h: 36 }, color)
  })
  s.lib('project/milestone', 240 + 3 * 96 - 30, rows.length * 72 + 4, s.say('Abnahme', 'Sign-off'), { w: 40, h: 40 })
  s.lib('project/milestone', 240 + 8 * 96 - 30, rows.length * 72 + 4, s.say('Start', 'Go-live'), { w: 40, h: 40 })
}

const roadmap: Build = (s) => {
  s.text(0, -110, s.say('Roadmap', 'Roadmap'), 'xl', 500)
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4']
  quarters.forEach((q, i) => {
    s.frame(i * 320, 0, 300, 520, q)
    s.lib('project/phase', i * 320 + 40, 30, s.say(['Grundlagen', 'Ausbau', 'Feinschliff', 'Wachstum'][i], ['Basics', 'Build-out', 'Polish', 'Growth'][i]), { w: 220, h: 56 })
    s.lib('project/task', i * 320 + 60, 130, s.say('Vorhaben', 'Initiative'), { w: 180, h: 100 })
    s.lib('project/task', i * 320 + 60, 260, s.say('Vorhaben', 'Initiative'), { w: 180, h: 100 })
  })
}

const kanbanWip: Build = (s) => {
  s.text(0, -110, s.say('Kanban mit Grenzen', 'Kanban with limits'), 'xl', 600)
  const cols = [s.say('Vorrat', 'Backlog'), s.say('In Arbeit · max. 3', 'Doing · max 3'), s.say('Prüfen · max. 2', 'Review · max 2'), s.say('Fertig', 'Done')]
  cols.forEach((name, i) => s.lib('project/column', i * 250, 0, name, { w: 230, h: 560 }))
  s.lib('project/task', 20, 70, s.say('Aufgabe', 'Task'), { w: 190, h: 100 }, '#fde68a')
  s.lib('project/task', 20, 190, s.say('Aufgabe', 'Task'), { w: 190, h: 100 }, '#fde68a')
  s.lib('project/task', 270, 70, s.say('Aufgabe', 'Task'), { w: 190, h: 100 }, '#bfdbfe')
}

const milestones: Build = (s) => {
  s.text(0, -110, s.say('Meilensteine', 'Milestones'), 'xl', 500)
  s.shape('rect', 0, 58, 1000, 4, '#a1a1aa')
  const names = [s.say('Auftakt', 'Kick-off'), s.say('Konzept', 'Concept'), s.say('Prototyp', 'Prototype'), s.say('Abnahme', 'Sign-off'), s.say('Start', 'Launch')]
  names.forEach((name, i) => s.lib('project/milestone', i * 230 + 10, 30, name, { w: 60, h: 60 }))
}

const raci: Build = (s) => {
  s.background = { pattern: 'grid', color: 'auto' }
  s.text(0, -110, s.say('Verantwortung (RACI)', 'Responsibility (RACI)'), 'xl', 600)
  const people = [s.say('Leitung', 'Lead'), s.say('Team', 'Team'), s.say('Fachbereich', 'Business'), s.say('IT', 'IT')]
  const tasks = [s.say('Ziele festlegen', 'Set goals'), s.say('Umsetzen', 'Build'), s.say('Testen', 'Test'), s.say('Freigeben', 'Approve')]
  people.forEach((p, i) => s.shape('rect', 240 + i * 144, 0, 140, 48, '#3f3f46', p))
  tasks.forEach((task, r) => {
    s.shape('rect', 0, 52 + r * 52, 236, 48, '#3f3f46', task)
    people.forEach((_, i) => s.shape('rect', 240 + i * 144, 52 + r * 52, 140, 48, 'none', ['A', 'R', 'C', 'I'][(i + r) % 4], '#a1a1aa'))
  })
  s.text(0, 52 + tasks.length * 52 + 20, s.say('R verantwortlich · A rechenschaftspflichtig · C gefragt · I informiert', 'R responsible · A accountable · C consulted · I informed'), 's', 820)
}

const brief: Build = (s) => {
  s.text(0, -110, s.say('Projektsteckbrief', 'Project brief'), 'xl', 600)
  const parts = [
    [s.say('Ziel', 'Goal'), 'green'],
    [s.say('Umfang', 'Scope'), 'blue'],
    [s.say('Team', 'Team'), 'violet'],
    [s.say('Termine', 'Dates'), 'yellow'],
    [s.say('Risiken', 'Risks'), 'pink'],
    [s.say('Budget', 'Budget'), 'orange'],
  ] as const
  parts.forEach(([name, color], i) => {
    const x = (i % 3) * 360
    const y = Math.floor(i / 3) * 350
    s.frame(x, y, 340, 300, name)
    s.note(x + 20, y + 20, color as NoteColor, '', 150, 150)
  })
}

// ---------- Rooms (one unit is one centimetre) ----------

const flat: Build = (s) => {
  s.background = { pattern: 'mm', color: 'paper' }
  s.text(0, -110, s.say('Grundriss Wohnung', 'Floor plan flat'), 'xl', 600)
  // Outer walls 800 x 600, one inner wall with a door.
  s.lib('room/wall', 0, 0, '', { w: 800, h: 12 })
  s.lib('room/wall', 0, 588, '', { w: 800, h: 12 })
  s.lib('room/wall', 0, 0, '', { w: 12, h: 600 })
  s.lib('room/wall', 788, 0, '', { w: 12, h: 600 })
  s.lib('room/wall', 450, 0, '', { w: 10, h: 380 })
  s.lib('room/door', 455, 380, '', { w: 90, h: 90 })
  s.lib('room/window', 120, -1, '', { w: 160, h: 14 })
  s.lib('room/window', 580, -1, '', { w: 120, h: 14 })
  s.lib('room/double-bed', 560, 40)
  s.lib('room/wardrobe', 600, 520, '', { w: 160, h: 60 })
  s.lib('room/sofa', 60, 60)
  s.lib('room/table', 120, 260)
  ;[0, 1].forEach((i) => s.lib('room/chair', 135 + i * 90, 210))
  s.lib('room/counter', 20, 520, '', { w: 300, h: 60 })
  s.lib('room/stove', 340, 520)
  s.text(60, 420, s.say('Wohnen und Essen', 'Living and dining'), 'm', 300)
  s.text(560, 280, s.say('Schlafen', 'Bedroom'), 'm', 200)
  s.lib('room/dimension', 0, 620, '', { w: 800, h: 30 })
}

const office: Build = (s) => {
  s.background = { pattern: 'mm', color: 'paper' }
  s.text(0, -110, s.say('Büro mit Arbeitsplätzen', 'Office with desks'), 'xl', 600)
  s.lib('room/room', 0, 0, s.say('Büro', 'Office'), { w: 640, h: 440 })
  for (let i = 0; i < 4; i++) {
    const x = 60 + (i % 2) * 300
    const y = 80 + Math.floor(i / 2) * 190
    s.lib('room/desk', x, y)
    s.lib('room/office-chair', x + 50, y + 85)
  }
  s.lib('room/wardrobe', 520, 20, '', { w: 100, h: 50 })
  s.lib('room/plant', 20, 380)
  s.lib('room/door', 550, 350, '', { w: 90, h: 90 })
}

const meeting: Build = (s) => {
  s.background = { pattern: 'mm', color: 'paper' }
  s.text(0, -110, s.say('Besprechungsraum', 'Meeting room'), 'xl', 600)
  s.lib('room/room', 0, 0, s.say('Besprechung', 'Meeting'), { w: 520, h: 400 })
  s.lib('room/table', 140, 150, '', { w: 240, h: 100 })
  for (let i = 0; i < 4; i++) {
    s.lib('room/chair', 150 + i * 60, 100)
    s.lib('room/chair', 150 + i * 60, 255)
  }
  s.lib('network/pc', 230, 20, s.say('Bildschirm', 'Screen'), { w: 60, h: 50 })
  s.lib('room/door', 20, 310, '', { w: 90, h: 90 })
}

const seating: Build = (s) => {
  s.background = { pattern: 'none', color: 'cream' }
  s.text(0, -110, s.say('Sitzplan', 'Seating plan'), 'xl', 500)
  for (let t = 0; t < 4; t++) {
    const cx = 160 + (t % 2) * 360
    const cy = 160 + Math.floor(t / 2) * 340
    s.lib('room/round-table', cx - 60, cy - 60, s.say(`Tisch ${t + 1}`, `Table ${t + 1}`))
    for (let c = 0; c < 6; c++) {
      const a = (c / 6) * Math.PI * 2
      s.lib('room/chair', cx + Math.cos(a) * 95 - 22, cy + Math.sin(a) * 95 - 22)
    }
  }
}

// ---------- Network ----------

const homeNet: Build = (s) => {
  s.text(0, -110, s.say('Heimnetz', 'Home network'), 'xl', 500)
  const net = s.lib('network/internet', 300, 0, s.say('Internet', 'Internet'))
  const modem = s.lib('network/modem', 310, 150, s.say('Modem', 'Modem'))
  const router = s.lib('network/router', 315, 280, s.say('Router', 'Router'))
  const sw = s.lib('network/switch', 305, 430, s.say('Switch', 'Switch'))
  // Names stand right of the symbols: the row below keeps room for them.
  const nas = s.lib('network/nas', 0, 590, s.say('NAS', 'NAS'))
  const server = s.lib('network/server', 250, 580, s.say('Server', 'Server'))
  const pc = s.lib('network/pc', 480, 590, s.say('PC', 'PC'))
  const ap = s.lib('network/access-point', 720, 420, s.say('WLAN', 'Wi-Fi'))
  const laptop = s.lib('network/laptop', 700, 600, s.say('Laptop', 'Laptop'))
  const phone = s.lib('network/phone', 940, 590, s.say('Handy', 'Phone'))
  s.join(net, modem, { arrow: 'none' })
  s.join(modem, router, { arrow: 'none' })
  s.join(router, sw, { arrow: 'none' })
  for (const device of [nas, server, pc]) s.join(sw, device, { arrow: 'none' })
  s.join(router, ap, { arrow: 'none' })
  s.join(ap, laptop, { arrow: 'none', dashed: true })
  s.join(ap, phone, { arrow: 'none', dashed: true })
}

const rack: Build = (s) => {
  s.background = { pattern: 'grid', color: 'auto' }
  s.text(0, -110, s.say('Rack-Belegung', 'Rack layout'), 'xl', 500)
  s.lib('network/rack', 0, 0, s.say('Rack 1', 'Rack 1'), { w: 300, h: 660 })
  s.lib('network/patch-panel', 25, 40, '', { w: 250, h: 30 })
  s.lib('network/switch', 25, 80, '', { w: 250, h: 30 })
  s.lib('network/patch-panel', 25, 120, '', { w: 250, h: 30 })
  for (let i = 0; i < 3; i++) s.lib('flow/process', 25, 200 + i * 70, s.say(`Server ${i + 1} · 2 HE`, `Server ${i + 1} · 2U`), { w: 250, h: 60 }, '#3f3f46')
  s.lib('flow/process', 25, 430, s.say('NAS · 2 HE', 'NAS · 2U'), { w: 250, h: 60 }, '#3f3f46')
  s.lib('flow/process', 25, 560, s.say('USV · 2 HE', 'UPS · 2U'), { w: 250, h: 60 }, '#3f3f46')
  s.note(360, 0, 'yellow', s.say('Strom, Lüftung und Kabelwege hier notieren.', 'Note power, cooling and cable runs here.'))
}

const vlans: Build = (s) => {
  s.text(0, -110, s.say('Netzplan mit VLANs', 'Network plan with VLANs'), 'xl', 600)
  const fw = s.lib('network/firewall', 420, 0, s.say('Firewall', 'Firewall'))
  const zones = [
    [s.say('VLAN 10 · Büro', 'VLAN 10 · Office'), 'network/pc'],
    [s.say('VLAN 20 · Gäste', 'VLAN 20 · Guests'), 'network/laptop'],
    [s.say('VLAN 30 · IoT', 'VLAN 30 · IoT'), 'network/camera'],
  ] as const
  zones.forEach(([name, device], i) => {
    s.lib('network/zone', i * 340, 180, name, { w: 320, h: 220 })
    for (const x of [60, 190]) s.join(fw, s.lib(device, i * 340 + x, 260), { arrow: 'none' })
  })
}

const homelab: Build = (s) => {
  s.text(0, -110, s.say('Homelab', 'Homelab'), 'xl', 500)
  const host = s.lib('network/zone', 0, 0, s.say('Proxmox-Host', 'Proxmox host'), { w: 520, h: 300 })
  const vms = [s.say('Docker', 'Docker'), s.say('Home Assistant', 'Home Assistant'), s.say('Datenbank', 'Database'), s.say('Test', 'Test')]
  vms.forEach((name, i) => s.lib('basic/frame-round', 30 + (i % 2) * 250, 60 + Math.floor(i / 2) * 110, name, { w: 220, h: 70 }, '#a78bfa'))
  const sw = s.lib('network/switch', 600, 120, s.say('Switch', 'Switch'))
  const nas = s.lib('network/nas', 800, 110, s.say('NAS', 'NAS'))
  s.join(host, sw, { arrow: 'none' })
  s.join(sw, nas, { arrow: 'none' })
}

// ---------- Thinking ----------

const mindmapLarge: Build = (s) => {
  const middle = s.shape('ellipse', 0, 0, 240, 120, '#ff8a70', s.say('Thema', 'Topic'))
  const branches: [number, number, NoteColor][] = [
    [-420, -260, 'yellow'],
    [420, -260, 'blue'],
    [-420, 240, 'green'],
    [420, 240, 'pink'],
  ]
  branches.forEach(([x, y, color], i) => {
    const branch = s.shape('round', x, y, 200, 80, color === 'yellow' ? '#fde68a' : color === 'blue' ? '#bfdbfe' : color === 'green' ? '#4ade80' : '#f472b6', s.say(`Zweig ${i + 1}`, `Branch ${i + 1}`))
    s.join(middle, branch, { arrow: 'none', curve: true })
    for (let k = 0; k < 2; k++) {
      const leaf = s.note(x + (x < 0 ? -230 : 230), y - 80 + k * 200, color, s.say('Gedanke', 'Thought'), 160, 160)
      s.join(branch, leaf, { arrow: 'none', curve: true })
    }
  })
}

const quadrants = (s: Sheet, title: string, names: string[], colors: NoteColor[]) => {
  s.text(0, -110, title, 'xl', 700)
  names.forEach((name, i) => {
    const x = (i % 2) * 520
    const y = Math.floor(i / 2) * 450
    s.frame(x, y, 500, 400, name)
    s.note(x + 24, y + 24, colors[i], '', 150, 150)
  })
}

const swot: Build = (s) =>
  quadrants(s, s.say('SWOT-Analyse', 'SWOT analysis'), [s.say('Stärken', 'Strengths'), s.say('Schwächen', 'Weaknesses'), s.say('Chancen', 'Opportunities'), s.say('Risiken', 'Threats')], ['green', 'pink', 'blue', 'orange'])

const eisenhower: Build = (s) =>
  quadrants(
    s,
    s.say('Eisenhower-Matrix', 'Eisenhower matrix'),
    [s.say('Wichtig und dringend: sofort', 'Important and urgent: do now'), s.say('Wichtig, nicht dringend: planen', 'Important, not urgent: plan'), s.say('Dringend, nicht wichtig: abgeben', 'Urgent, not important: hand on'), s.say('Weder noch: streichen', 'Neither: drop')],
    ['pink', 'green', 'yellow', 'gray'],
  )

const empathy: Build = (s) => {
  quadrants(s, s.say('Empathy Map', 'Empathy map'), [s.say('Sagt', 'Says'), s.say('Denkt', 'Thinks'), s.say('Tut', 'Does'), s.say('Fühlt', 'Feels')], ['blue', 'violet', 'green', 'pink'])
  s.lib('project/person', 470, 355, s.say('Person', 'Persona'), { w: 80, h: 120 })
}

const businessModel: Build = (s) => {
  s.text(0, -110, s.say('Business Model Canvas', 'Business model canvas'), 'xl', 700)
  // Columns 260 wide; 40 between rows for the names above the frames.
  const W = 260
  const half = 250
  const parts: [string, number, number, number, number][] = [
    [s.say('Partner', 'Partners'), 0, 0, W, 2 * half + 40],
    [s.say('Aktivitäten', 'Activities'), W, 0, W, half],
    [s.say('Ressourcen', 'Resources'), W, half + 40, W, half],
    [s.say('Wertangebot', 'Value proposition'), 2 * W, 0, W, 2 * half + 40],
    [s.say('Kundenbeziehung', 'Customer relations'), 3 * W, 0, W, half],
    [s.say('Kanäle', 'Channels'), 3 * W, half + 40, W, half],
    [s.say('Kundensegmente', 'Customer segments'), 4 * W, 0, W, 2 * half + 40],
    [s.say('Kosten', 'Costs'), 0, 2 * half + 80, 2.5 * W, 200],
    [s.say('Einnahmen', 'Revenue'), 2.5 * W, 2 * half + 80, 2.5 * W, 200],
  ]
  parts.forEach(([name, x, y, w, h]) => s.frame(x, y, w - 10, h, name))
}

const ishikawa: Build = (s) => {
  s.text(0, -110, s.say('Ursache und Wirkung (Ishikawa)', 'Cause and effect (Ishikawa)'), 'xl', 700)
  s.lib('flow/process', 880, 210, s.say('Wirkung', 'Effect'), { w: 180, h: 80 }, '#ff8a70')
  s.shape('rect', 0, 248, 880, 4, '#a1a1aa')
  const causes = [s.say('Mensch', 'People'), s.say('Maschine', 'Machine'), s.say('Methode', 'Method'), s.say('Material', 'Material'), s.say('Messung', 'Measurement'), s.say('Mitwelt', 'Environment')]
  causes.forEach((name, i) => {
    const up = i % 2 === 0
    const x = 120 + Math.floor(i / 2) * 260
    const box = s.lib('flow/process', x, up ? 0 : 420, name, { w: 160, h: 60 }, '#bfdbfe')
    const foot = s.shape('rect', x + 150, 246, 8, 8, '#a1a1aa')
    s.join(box, foot, { arrow: 'none' })
  })
}

const startStop: Build = (s) => {
  s.text(0, -110, s.say('Retro: Start, Stop, Weiter', 'Retro: start, stop, continue'), 'xl', 700)
  const cols: [string, NoteColor][] = [
    [s.say('Anfangen', 'Start'), 'green'],
    [s.say('Aufhören', 'Stop'), 'pink'],
    [s.say('Weitermachen', 'Continue'), 'blue'],
  ]
  cols.forEach(([name, color], i) => {
    s.frame(i * 360, 0, 340, 560, name)
    s.note(i * 360 + 24, 30, color)
  })
}

const fourL: Build = (s) =>
  quadrants(s, s.say('Retro: 4L', 'Retro: 4L'), [s.say('Gemocht', 'Liked'), s.say('Gelernt', 'Learned'), s.say('Gefehlt', 'Lacked'), s.say('Gewünscht', 'Longed for')], ['green', 'blue', 'pink', 'yellow'])

// ---------- Organisation ----------

const orgChart: Build = (s) => {
  s.text(0, -110, s.say('Organigramm', 'Org chart'), 'xl', 500)
  const top = s.lib('flow/process', 380, 0, s.say('Geschäftsführung', 'Management'), { w: 200, h: 70 }, '#ff8a70')
  const heads = [s.say('Vertrieb', 'Sales'), s.say('Technik', 'Engineering'), s.say('Verwaltung', 'Operations')]
  heads.forEach((name, i) => {
    const head = s.lib('flow/process', 60 + i * 320, 160, name, { w: 200, h: 70 }, '#bfdbfe')
    s.join(top, head, { arrow: 'none' })
    let above = head
    for (let k = 0; k < 2; k++) {
      const team = s.lib('flow/process', 60 + i * 320, 300 + k * 100, s.say(`Team ${k + 1}`, `Team ${k + 1}`), { w: 200, h: 60 }, '#e4e4e7')
      s.join(above, team, { arrow: 'none' })
      above = team
    }
  })
}

const month: Build = (s) => {
  s.background = { pattern: 'none', color: 'auto' }
  s.text(0, -110, s.say('Monatsplan', 'Month plan'), 'xl', 500)
  const days = s.de ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  days.forEach((d, i) => s.text(i * 170 + 8, -46, d, 'm', 150))
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) s.shape('round', c * 170, r * 150, 160, 140, 'none', String(r * 7 + c + 1), '#a1a1aa')
  }
}

export interface Shipped {
  id: string
  category: Category
  build: Build
}

/** The new templates of block 5 by group; the first ones of the app (blank, mood, retro …) stay in `templates.ts`. */
export const SHIPPED: Shipped[] = [
  { id: 'flowchart', category: 'flow', build: flowchart },
  { id: 'swimlanes', category: 'flow', build: swimlanes },
  { id: 'decision', category: 'flow', build: decisionTree },
  { id: 'gantt', category: 'project', build: gantt },
  { id: 'roadmap', category: 'project', build: roadmap },
  { id: 'kanbanWip', category: 'project', build: kanbanWip },
  { id: 'milestones', category: 'project', build: milestones },
  { id: 'raci', category: 'project', build: raci },
  { id: 'brief', category: 'project', build: brief },
  { id: 'flat', category: 'room', build: flat },
  { id: 'office', category: 'room', build: office },
  { id: 'meeting', category: 'room', build: meeting },
  { id: 'seating', category: 'room', build: seating },
  { id: 'homeNet', category: 'network', build: homeNet },
  { id: 'rack', category: 'network', build: rack },
  { id: 'vlans', category: 'network', build: vlans },
  { id: 'homelab', category: 'network', build: homelab },
  { id: 'mindmapLarge', category: 'thinking', build: mindmapLarge },
  { id: 'swot', category: 'thinking', build: swot },
  { id: 'businessModel', category: 'thinking', build: businessModel },
  { id: 'empathy', category: 'thinking', build: empathy },
  { id: 'ishikawa', category: 'thinking', build: ishikawa },
  { id: 'eisenhower', category: 'thinking', build: eisenhower },
  { id: 'startStop', category: 'thinking', build: startStop },
  { id: 'fourL', category: 'thinking', build: fourL },
  { id: 'orgChart', category: 'organisation', build: orgChart },
  { id: 'month', category: 'organisation', build: month },
]

export function shippedDoc(id: string, language: string): Doc | null {
  const entry = SHIPPED.find((t) => t.id === id)
  if (!entry) return null
  const sheet = new Sheet(language.startsWith('de'))
  entry.build(sheet)
  return sheet.doc()
}
