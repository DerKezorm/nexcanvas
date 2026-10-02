/**
 * Made-up boards, spaces and people for the mock. Nothing here is real; addresses use example.com.
 * The texts come in the language the mock was first opened in.
 */

import { photo } from './photos'
import type { Board, InkItem, Item, LineItem, Person } from './types'

export interface Space {
  id: string
  name: string
  color: string
  /** The role of the signed-in account in this space, as in nexlore. */
  role: 'manage' | 'write' | 'read'
  members: { person: string; role: 'manage' | 'write' | 'read' }[]
}

export const ME = 'p-vera'

export const PEOPLE: Person[] = [
  { id: 'p-vera', name: 'Vera Lind', email: 'vera@example.com', color: '#ff8a70' },
  { id: 'p-jonas', name: 'Jonas Keller', email: 'jonas@example.com', color: '#60a5fa' },
  { id: 'p-mia', name: 'Mia Brandt', email: 'mia@example.com', color: '#f472b6' },
  { id: 'p-tom', name: 'Tom Ruiz', email: 'tom@example.com', color: '#4ade80' },
]

let counter = 0
const id = (prefix: string) => `${prefix}-${++counter}`

/** A freehand stroke from board points: the box is fitted around them, with room for the pen. */
export function inkFrom(points: number[][], color: string, size: number, marker = false): InkItem {
  const pad = size * 1.5
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  const w = Math.max(...xs) - x + pad
  const h = Math.max(...ys) - y + pad
  return {
    id: id('ink'),
    kind: 'ink',
    x,
    y,
    w,
    h,
    ow: w,
    oh: h,
    points: points.map((p) => [p[0] - x, p[1] - y, p[2] ?? 0.5]),
    color,
    size,
    marker,
  }
}

function oval(cx: number, cy: number, rx: number, ry: number, turns = 1.08): number[][] {
  const pts: number[][] = []
  const steps = 60
  for (let i = 0; i <= steps * turns; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2
    const wobble = 1 + Math.sin(i * 0.7) * 0.025
    pts.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble, 0.4 + 0.2 * Math.sin(i / 9)])
  }
  return pts
}

function wave(x: number, y: number, length: number, height = 6, step = 8): number[][] {
  const pts: number[][] = []
  for (let d = 0; d <= length; d += step) pts.push([x + d, y + Math.sin(d / 18) * height, 0.5])
  return pts
}

function line(a: string, b: string, extra: Partial<LineItem> = {}): LineItem {
  return {
    id: id('line'),
    kind: 'line',
    a: { item: a, x: 0, y: 0 },
    b: { item: b, x: 0, y: 0 },
    color: 'auto',
    width: 2,
    arrow: 'end',
    curve: true,
    ...extra,
  }
}

export interface Seed {
  spaces: Space[]
  boards: Board[]
}

export function seed(lang: string): Seed {
  const de = lang.startsWith('de')
  const L = (german: string, english: string) => (de ? german : english)
  const now = Date.now()
  const hour = 3600_000
  const day = 24 * hour

  const spaces: Space[] = [
    {
      id: 's-home',
      name: L('Zuhause', 'Home'),
      color: '#ff8a70',
      role: 'manage',
      members: [{ person: ME, role: 'manage' }],
    },
    {
      id: 's-lab',
      name: 'Homelab',
      color: '#60a5fa',
      role: 'manage',
      members: [
        { person: ME, role: 'manage' },
        { person: 'p-jonas', role: 'write' },
        { person: 'p-tom', role: 'read' },
      ],
    },
    {
      id: 's-family',
      name: L('Familie', 'Family'),
      color: '#4ade80',
      role: 'write',
      members: [
        { person: 'p-mia', role: 'manage' },
        { person: ME, role: 'write' },
      ],
    },
  ]

  // Living room: a mood board with photos, notes, a link, swatches and a circle drawn around the plant.
  const room = { id: id('img'), kind: 'image' as const, x: 0, y: 0, w: 330, h: 227, src: photo('room') }
  const plant = { id: id('img'), kind: 'image' as const, x: 350, y: -10, w: 170, h: 216, src: photo('plant') }
  const kitchen = { id: id('img'), kind: 'image' as const, x: 0, y: 250, w: 250, h: 172, src: photo('kitchen'), caption: L('Küche kommt später', 'Kitchen comes later') }
  const sofa = { id: id('note'), kind: 'note' as const, x: 580, y: 0, w: 190, h: 190, color: 'yellow' as const, text: L('Sofa in Grün, Cord?\nHöchstens 2,20 m breit', 'Green sofa, corduroy?\n2.2 m wide at most') }
  const plants = { id: id('note'), kind: 'note' as const, x: 580, y: 215, w: 190, h: 190, color: 'pink' as const, text: L('Mehr Pflanzen ans Fenster 🌿', 'More plants by the window 🌿') }
  const living: Item[] = [
    { id: id('text'), kind: 'text', x: 0, y: -110, w: 520, h: 60, text: L('Wohnzimmer neu', 'New living room'), size: 'xl', color: 'auto' },
    room,
    plant,
    kitchen,
    sofa,
    plants,
    { id: id('note'), kind: 'note', x: 280, y: 255, w: 170, h: 170, color: 'blue', text: L('Budget: 2.500 €', 'Budget: 2,500 €') },
    { id: id('link'), kind: 'link', x: 800, y: 0, w: 240, h: 200, url: 'https://moebel.example.com/cord-sofa', title: L('Cordsofa, drei Sitze, salbeigrün', 'Corduroy sofa, three seats, sage'), site: 'moebel.example.com', hue: 96 },
    { id: id('text'), kind: 'text', x: -250, y: -10, w: 200, h: 34, text: L('Farben', 'Colours'), size: 'l', color: 'auto' },
    { id: id('shape'), kind: 'shape', x: -250, y: 40, w: 80, h: 80, shape: 'ellipse', fill: '#6b8a62', stroke: 'none', text: '' },
    { id: id('shape'), kind: 'shape', x: -150, y: 40, w: 80, h: 80, shape: 'ellipse', fill: '#e7e1d8', stroke: 'none', text: '' },
    { id: id('shape'), kind: 'shape', x: -250, y: 140, w: 80, h: 80, shape: 'ellipse', fill: '#b08968', stroke: 'none', text: '' },
    { id: id('shape'), kind: 'shape', x: -150, y: 140, w: 80, h: 80, shape: 'ellipse', fill: '#c2410c', stroke: 'none', text: '' },
    inkFrom(oval(435, 98, 112, 132), '#ff8a70', 5),
    inkFrom(wave(0, -42, 300, 4), '#ff8a70', 6),
  ]
  const livingLines = [line(plants.id, plant.id, { color: '#ff8a70' })]

  // Homelab: a diagram from shapes and lines, a PDF and two notes.
  const shape = (text: string, x: number, y: number, fill: string, kind: 'round' | 'diamond' | 'hexagon' = 'round') =>
    ({ id: id('shape'), kind: 'shape' as const, x, y, w: kind === 'round' ? 170 : 150, h: kind === 'round' ? 70 : 110, shape: kind, fill, stroke: 'none', text })
  const router = shape('Router', 0, 0, '#60a5fa')
  const sw = shape('Switch 10G', 0, 150, '#60a5fa')
  const pve = shape('Proxmox', -230, 300, '#a78bfa')
  const nas = shape('NAS', 230, 300, '#4ade80')
  const vm1 = shape('VM: nexcanvas', -340, 450, '#3f3f46')
  const vm2 = shape('VM: Home Assistant', -130, 450, '#3f3f46')
  const backup = shape(L('Backup offsite?', 'Offsite backup?'), 240, 440, '#fbbf24', 'diamond')
  const lab: Item[] = [
    { id: id('text'), kind: 'text', x: -340, y: -120, w: 520, h: 60, text: L('Homelab 2027', 'Homelab 2027'), size: 'xl', color: 'auto' },
    router,
    sw,
    pve,
    nas,
    vm1,
    vm2,
    backup,
    { id: id('note'), kind: 'note', x: 470, y: 120, w: 180, h: 180, color: 'yellow', text: L('10G zwischen NAS und Proxmox reicht?', 'Is 10G between NAS and Proxmox enough?') },
    { id: id('note'), kind: 'note', x: 470, y: -90, w: 180, h: 180, color: 'green', text: L('USV ist da ✔', 'UPS is in ✔') },
    { id: id('file'), kind: 'file', x: -620, y: 60, w: 200, h: 240, name: L('Netzplan.pdf', 'Network plan.pdf'), ext: 'pdf', sizeLabel: '1,2 MB', pages: 4 },
  ]
  const labLines = [
    line(router.id, sw.id, { curve: false }),
    line(sw.id, pve.id),
    line(sw.id, nas.id),
    line(pve.id, vm1.id, { arrow: 'none', curve: false }),
    line(pve.id, vm2.id, { arrow: 'none', curve: false }),
    line(nas.id, backup.id, { dashed: true, color: '#fbbf24' }),
    line(pve.id, nas.id, { arrow: 'both', color: '#4ade80', curve: false, dashed: true }),
  ]

  // Holiday: photos, a plan as notes, a booking, a link and a drawn route.
  const fjord = { id: id('img'), kind: 'image' as const, x: 0, y: 0, w: 360, h: 248, src: photo('fjord'), caption: 'Geirangerfjord' }
  const trip: Item[] = [
    { id: id('text'), kind: 'text', x: 0, y: -100, w: 520, h: 60, text: L('Norwegen im Sommer', 'Norway in summer'), size: 'xl', color: 'auto' },
    fjord,
    { id: id('img'), kind: 'image', x: 380, y: 40, w: 260, h: 179, src: photo('sunset') },
    { id: id('img'), kind: 'image', x: 140, y: 280, w: 240, h: 165, src: photo('forest') },
    { id: id('note'), kind: 'note', x: -230, y: 0, w: 200, h: 200, color: 'orange', text: L('Tag 1: Fähre ab Kiel\nTag 2: Oslo\nTag 3–5: Fjorde', 'Day 1: ferry from Kiel\nDay 2: Oslo\nDays 3–5: fjords') },
    { id: id('note'), kind: 'note', x: -230, y: 225, w: 200, h: 200, color: 'violet', text: L('Regenjacken nicht vergessen!', "Don't forget rain jackets!") },
    { id: id('file'), kind: 'file', x: 680, y: 30, w: 190, h: 230, name: L('Fähre Buchung.pdf', 'Ferry booking.pdf'), ext: 'pdf', sizeLabel: '240 KB', pages: 2 },
    { id: id('link'), kind: 'link', x: 680, y: 290, w: 230, h: 190, url: 'https://ferry.example.com/kiel-oslo', title: L('Kiel–Oslo, Kabine außen', 'Kiel–Oslo, outside cabin'), site: 'ferry.example.com', hue: 205 },
    { id: id('shape'), kind: 'shape', x: 420, y: 260, w: 120, h: 120, shape: 'star', fill: '#fbbf24', stroke: 'none', text: L('Muss!', 'Must!') },
    inkFrom([[560, 420, 0.5], [600, 440, 0.5], [640, 430, 0.5], [660, 400, 0.5], [665, 360, 0.5]], '#60a5fa', 4),
  ]

  // Retro: three columns of notes under a heading.
  const column = (x: number, title: string, color: 'green' | 'pink' | 'blue', texts: string[]): Item[] => [
    { id: id('text'), kind: 'text', x, y: 0, w: 220, h: 40, text: title, size: 'l', color: 'auto' },
    ...texts.map((text, i): Item => ({ id: id('note'), kind: 'note', x: x + (i % 2) * 10, y: 60 + i * 175, w: 200, h: 160, color, text })),
  ]
  const retro: Item[] = [
    { id: id('text'), kind: 'text', x: 0, y: -90, w: 600, h: 60, text: L('Retro: Umzug der Dienste', 'Retro: moving the services'), size: 'xl', color: 'auto' },
    ...column(0, L('Lief gut', 'Went well'), 'green', [L('Backups vorher getestet', 'Tested backups first'), L('Doku in nexlore', 'Docs in nexlore')]),
    ...column(260, L('Lief schlecht', 'Went badly'), 'pink', [L('DNS-Cache vergessen', 'Forgot the DNS cache'), L('Zwei Stunden ohne Licht 😅', 'Two hours without lights 😅'), L('Zertifikate abgelaufen', 'Certificates expired')]),
    ...column(520, L('Nächstes Mal', 'Next time'), 'blue', [L('Checkliste vorher', 'Checklist up front'), L('Wartungsfenster ansagen', 'Announce the window')]),
  ]

  const sketch: Item[] = [
    inkFrom(oval(0, 0, 60, 60), 'auto', 4),
    inkFrom([[-40, 90, 0.5], [0, 140, 0.6], [40, 90, 0.5]], 'auto', 4),
    inkFrom(wave(-120, 220, 240, 10, 6), '#ff8a70', 8, true),
    { id: id('note'), kind: 'note', x: 120, y: -60, w: 170, h: 170, color: 'yellow', text: L('Logo-Ideen …', 'Logo ideas …') },
  ]

  const board = (
    over: Partial<Board> & Pick<Board, 'id' | 'title' | 'items' | 'lines' | 'space'>,
  ): Board => ({
    created: now - 20 * day,
    updated: now - 2 * hour,
    opened: now - 3 * hour,
    favorite: false,
    publicLink: false,
    ...over,
  })

  const boards: Board[] = [
    board({ id: 'b-living', title: L('Wohnzimmer neu', 'New living room'), space: 's-home', items: living, lines: livingLines, favorite: true, updated: now - 25 * 60_000, opened: now - 20 * 60_000 }),
    board({ id: 'b-lab', title: 'Homelab 2027', space: 's-lab', items: lab, lines: labLines, favorite: true, updated: now - 3 * hour, opened: now - 2 * hour }),
    board({ id: 'b-trip', title: L('Norwegen im Sommer', 'Norway in summer'), space: 's-family', items: trip, lines: [], updated: now - 1 * day, opened: now - 26 * hour, publicLink: true }),
    board({ id: 'b-retro', title: L('Retro: Umzug der Dienste', 'Retro: moving the services'), space: 's-lab', items: retro, lines: [], updated: now - 4 * day, opened: now - 4 * day }),
    board({ id: 'b-sketch', title: L('Skizzen', 'Sketches'), space: 's-home', items: sketch, lines: [], updated: now - 9 * day, opened: now - 9 * day }),
    board({ id: 'b-empty', title: L('Geschenkideen', 'Gift ideas'), space: 's-family', items: [], lines: [], updated: now - 12 * day, opened: now - 12 * day }),
    board({ id: 'b-old', title: L('Alter Grundriss', 'Old floor plan'), space: 's-home', items: [{ id: id('shape'), kind: 'shape', x: 0, y: 0, w: 300, h: 200, shape: 'rect', fill: 'none', stroke: 'auto', text: '' }], lines: [], deleted: now - 3 * day }),
  ]

  return { spaces, boards }
}
