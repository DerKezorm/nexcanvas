/**
 * The packages that come with nexcanvas. All symbols are drawn for nexcanvas in the line style of its basic shapes;
 * none is taken from a maker's icon set. In the floor plan one unit is one centimetre, so a bed placed with a click is
 * as large next to a door as it is in a room.
 */
import { circle, ellipse, line, lines, outline, path, rect, stroke } from './draw'
import type { ShapeDef, ShapePackage } from './types'

const META = { version: '1.0.0', author: 'nexcanvas', license: 'AGPL-3.0', builtin: true, scope: 'builtin' as const, enabled: true }
const BLUE = '#60a5fa'
const LIGHT = '#bfdbfe'

// ---------- Basic shapes ----------

const basic: ShapeDef[] = [
  { id: 'parallelogram', name: { de: 'Parallelogramm', en: 'Parallelogram' }, vw: 120, vh: 80, elements: [path('M24 0H120L96 80H0Z')], outline: outline(120, 80, [[24, 0], [120, 0], [96, 80], [0, 80]]), text: { x: 0.18, y: 0, w: 0.64, h: 1 }, fill: BLUE },
  { id: 'trapezoid', name: { de: 'Trapez', en: 'Trapezoid' }, vw: 120, vh: 80, elements: [path('M24 0H96L120 80H0Z')], outline: outline(120, 80, [[24, 0], [96, 0], [120, 80], [0, 80]]), text: { x: 0.18, y: 0, w: 0.64, h: 1 }, fill: BLUE },
  { id: 'pentagon', name: { de: 'Fünfeck', en: 'Pentagon' }, vw: 100, vh: 96, elements: [path('M50 0L100 36L81 96H19L0 36Z')], outline: outline(100, 96, [[50, 0], [100, 36], [81, 96], [19, 96], [0, 36]]), text: { x: 0.2, y: 0.3, w: 0.6, h: 0.6 }, fill: BLUE },
  { id: 'octagon', name: { de: 'Achteck', en: 'Octagon' }, vw: 100, vh: 100, elements: [path('M29 0H71L100 29V71L71 100H29L0 71V29Z')], outline: outline(100, 100, [[29, 0], [71, 0], [100, 29], [100, 71], [71, 100], [29, 100], [0, 71], [0, 29]]), text: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }, fill: BLUE },
  { id: 'cross', name: { de: 'Kreuz', en: 'Cross' }, words: ['plus'], vw: 100, vh: 100, elements: [path('M35 0H65V35H100V65H65V100H35V65H0V35H35Z')], outline: outline(100, 100, [[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]]), text: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }, fill: BLUE },
  {
    id: 'cylinder', name: { de: 'Zylinder', en: 'Cylinder' }, words: ['datenbank', 'database', 'tonne'], vw: 100, vh: 120,
    elements: [path('M0 14A50 14 0 0 1 100 14V106A50 14 0 0 1 0 106Z'), ellipse(50, 14, 50, 14)], text: { x: 0.05, y: 0.28, w: 0.9, h: 0.62 }, fill: BLUE,
  },
  {
    id: 'cloud', name: { de: 'Wolke', en: 'Cloud' }, vw: 140, vh: 90,
    elements: [path('M36 82C14 82 2 68 7 54C-1 43 8 25 27 28C31 9 56 3 69 16C81 1 110 6 111 27C131 27 141 45 133 59C141 75 124 88 107 81C97 91 72 92 62 82C53 88 43 87 36 82Z')],
    text: { x: 0.18, y: 0.28, w: 0.64, h: 0.5 }, fill: LIGHT,
  },
  { id: 'document', name: { de: 'Dokument', en: 'Document' }, vw: 100, vh: 120, elements: [path('M0 0H100V104C75 92 50 122 25 112C14 108 6 106 0 108Z')], text: { x: 0.06, y: 0.06, w: 0.88, h: 0.76 }, fill: BLUE },
  { id: 'double-arrow', name: { de: 'Doppelpfeil', en: 'Double arrow' }, vw: 140, vh: 70, elements: [path('M0 35L30 0V18H110V0L140 35L110 70V52H30V70Z')], outline: outline(140, 70, [[0, 35], [30, 0], [30, 18], [110, 18], [110, 0], [140, 35], [110, 70], [110, 52], [30, 52], [30, 70]]), text: { x: 0.2, y: 0.25, w: 0.6, h: 0.5 }, fill: BLUE },
  { id: 'chevron', name: { de: 'Winkelpfeil', en: 'Chevron' }, words: ['phase', 'schritt', 'step'], vw: 120, vh: 70, elements: [path('M0 0H90L120 35L90 70H0L30 35Z')], outline: outline(120, 70, [[0, 0], [90, 0], [120, 35], [90, 70], [0, 70], [30, 35]]), text: { x: 0.25, y: 0, w: 0.55, h: 1 }, fill: BLUE },
  { id: 'heart', name: { de: 'Herz', en: 'Heart' }, vw: 100, vh: 92, elements: [path('M50 92C20 70 0 52 0 28C0 12 12 0 28 0C38 0 46 6 50 14C54 6 62 0 72 0C88 0 100 12 100 28C100 52 80 70 50 92Z')], text: { x: 0.2, y: 0.15, w: 0.6, h: 0.5 }, fill: '#f472b6' },
  { id: 'cube', name: { de: 'Würfel', en: 'Cube' }, words: ['box', 'kiste'], vw: 100, vh: 100, elements: [path('M0 25L25 0H100V75L75 100H0Z'), stroke('M0 25H75V100M75 25L100 0')], outline: outline(100, 100, [[0, 25], [25, 0], [100, 0], [100, 75], [75, 100], [0, 100]]), text: { x: 0.04, y: 0.3, w: 0.66, h: 0.66 }, fill: BLUE },
  { id: 'folder', name: { de: 'Ordner', en: 'Folder' }, vw: 120, vh: 90, elements: [path('M0 10Q0 0 10 0H44L54 12H110Q120 12 120 22V80Q120 90 110 90H10Q0 90 0 80Z')], text: { x: 0.06, y: 0.2, w: 0.88, h: 0.75 }, fill: '#fbbf24' },
  { id: 'right-triangle', name: { de: 'Rechtwinkliges Dreieck', en: 'Right triangle' }, vw: 100, vh: 100, elements: [path('M0 0L100 100H0Z')], outline: outline(100, 100, [[0, 0], [100, 100], [0, 100]]), text: { x: 0.05, y: 0.5, w: 0.5, h: 0.45 }, fill: BLUE },
  { id: 'half-circle', name: { de: 'Halbkreis', en: 'Half circle' }, vw: 120, vh: 60, elements: [path('M0 60A60 60 0 0 1 120 60Z')], text: { x: 0.2, y: 0.35, w: 0.6, h: 0.6 }, fill: BLUE },
  { id: 'frame-round', name: { de: 'Pille', en: 'Pill' }, words: ['button', 'knopf'], vw: 140, vh: 56, elements: [rect(0, 0, 140, 56, { rx: 28 })], text: { x: 0.12, y: 0, w: 0.76, h: 1 }, fill: BLUE },
]

// ---------- Flowchart ----------

const flow: ShapeDef[] = [
  { id: 'terminator', name: { de: 'Start und Ende', en: 'Start and end' }, words: ['terminator', 'anfang', 'begin'], vw: 140, vh: 60, elements: [rect(0, 0, 140, 60, { rx: 30 })], text: { x: 0.12, y: 0, w: 0.76, h: 1 }, fill: LIGHT },
  { id: 'process', name: { de: 'Prozess', en: 'Process' }, words: ['schritt', 'step', 'aktion'], vw: 140, vh: 70, elements: [rect(0, 0, 140, 70, { rx: 4 })], fill: LIGHT },
  { id: 'decision', name: { de: 'Entscheidung', en: 'Decision' }, words: ['frage', 'question', 'wenn', 'if'], vw: 140, vh: 90, elements: [path('M70 0L140 45L70 90L0 45Z')], outline: outline(140, 90, [[70, 0], [140, 45], [70, 90], [0, 45]]), text: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fill: '#fde68a' },
  { id: 'data', name: { de: 'Daten', en: 'Data' }, words: ['eingabe', 'ausgabe', 'input', 'output'], vw: 140, vh: 70, elements: [path('M28 0H140L112 70H0Z')], outline: outline(140, 70, [[28, 0], [140, 0], [112, 70], [0, 70]]), text: { x: 0.2, y: 0, w: 0.6, h: 1 }, fill: LIGHT },
  { id: 'predefined', name: { de: 'Unterprozess', en: 'Subprocess' }, words: ['vordefiniert', 'predefined'], vw: 140, vh: 70, elements: [rect(0, 0, 140, 70), line(14, 0, 14, 70), line(126, 0, 126, 70)], text: { x: 0.12, y: 0, w: 0.76, h: 1 }, fill: LIGHT },
  { id: 'document', name: { de: 'Dokument', en: 'Document' }, vw: 140, vh: 84, elements: [path('M0 0H140V72C105 60 70 92 35 80C20 75 9 74 0 76Z')], text: { x: 0.05, y: 0.05, w: 0.9, h: 0.75 }, fill: LIGHT },
  {
    id: 'documents', name: { de: 'Mehrere Dokumente', en: 'Documents' }, vw: 140, vh: 92,
    elements: [path('M12 0H140V66H128'), path('M6 6H134V72H122'), path('M0 12H128V80C96 70 64 98 32 88C18 84 8 83 0 85Z')],
    text: { x: 0.04, y: 0.18, w: 0.84, h: 0.62 }, fill: LIGHT,
  },
  { id: 'manual-input', name: { de: 'Manuelle Eingabe', en: 'Manual input' }, vw: 140, vh: 70, elements: [path('M0 22L140 0V70H0Z')], outline: outline(140, 70, [[0, 22], [140, 0], [140, 70], [0, 70]]), text: { x: 0.05, y: 0.3, w: 0.9, h: 0.7 }, fill: LIGHT },
  { id: 'preparation', name: { de: 'Vorbereitung', en: 'Preparation' }, vw: 140, vh: 70, elements: [path('M24 0H116L140 35L116 70H24L0 35Z')], outline: outline(140, 70, [[24, 0], [116, 0], [140, 35], [116, 70], [24, 70], [0, 35]]), text: { x: 0.17, y: 0, w: 0.66, h: 1 }, fill: LIGHT },
  { id: 'database', name: { de: 'Datenbank', en: 'Database' }, vw: 120, vh: 90, elements: [path('M0 12A60 12 0 0 1 120 12V78A60 12 0 0 1 0 78Z'), ellipse(60, 12, 60, 12)], text: { x: 0.05, y: 0.3, w: 0.9, h: 0.6 }, fill: LIGHT },
  { id: 'connector', name: { de: 'Verbinder', en: 'Connector' }, words: ['kreis', 'circle'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30)], text: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, fill: LIGHT },
  { id: 'off-page', name: { de: 'Seitenverbinder', en: 'Off-page connector' }, vw: 80, vh: 80, elements: [path('M0 0H80V52L40 80L0 52Z')], outline: outline(80, 80, [[0, 0], [80, 0], [80, 52], [40, 80], [0, 52]]), text: { x: 0.1, y: 0.05, w: 0.8, h: 0.6 }, fill: LIGHT },
  { id: 'delay', name: { de: 'Verzögerung', en: 'Delay' }, words: ['warten', 'wait'], vw: 120, vh: 70, elements: [path('M0 0H85A35 35 0 0 1 85 70H0Z')], text: { x: 0.05, y: 0, w: 0.8, h: 1 }, fill: LIGHT },
  { id: 'display', name: { de: 'Anzeige', en: 'Display' }, words: ['bildschirm', 'screen'], vw: 140, vh: 70, elements: [path('M0 35L30 0H110A30 35 0 0 1 110 70H30Z')], text: { x: 0.2, y: 0, w: 0.65, h: 1 }, fill: LIGHT },
  { id: 'manual-operation', name: { de: 'Manueller Vorgang', en: 'Manual operation' }, vw: 140, vh: 70, elements: [path('M0 0H140L115 70H25Z')], outline: outline(140, 70, [[0, 0], [140, 0], [115, 70], [25, 70]]), text: { x: 0.18, y: 0, w: 0.64, h: 1 }, fill: LIGHT },
  { id: 'merge', name: { de: 'Zusammenführen', en: 'Merge' }, vw: 100, vh: 80, elements: [path('M0 0H100L50 80Z')], outline: outline(100, 80, [[0, 0], [100, 0], [50, 80]]), text: { x: 0.25, y: 0.05, w: 0.5, h: 0.45 }, fill: LIGHT },
  { id: 'stored-data', name: { de: 'Gespeicherte Daten', en: 'Stored data' }, vw: 140, vh: 70, elements: [path('M20 0H140A20 35 0 0 0 140 70H20A20 35 0 0 1 20 0Z')], text: { x: 0.15, y: 0, w: 0.7, h: 1 }, fill: LIGHT },
  { id: 'loop-limit', name: { de: 'Schleifengrenze', en: 'Loop limit' }, words: ['schleife', 'loop'], vw: 140, vh: 70, elements: [path('M20 0H120L140 20V70H0V20Z')], outline: outline(140, 70, [[20, 0], [120, 0], [140, 20], [140, 70], [0, 70], [0, 20]]), text: { x: 0.05, y: 0.15, w: 0.9, h: 0.85 }, fill: LIGHT },
  { id: 'annotation', hollow: true, name: { de: 'Anmerkung', en: 'Annotation' }, words: ['kommentar', 'comment', 'notiz'], vw: 120, vh: 80, elements: [rect(0, 0, 120, 80, { f: 'none', s: 'none' }), stroke('M24 0H0V80H24', 2)], text: { x: 0.12, y: 0, w: 0.86, h: 1 }, fill: 'none' },
]

// ---------- Floor plan (1 unit = 1 cm) ----------

const stairSteps = 10
const room: ShapeDef[] = [
  { id: 'wall', name: { de: 'Wand', en: 'Wall' }, words: ['mauer'], vw: 300, vh: 12, w: 300, h: 12, quiet: true, elements: [rect(0, 0, 300, 12, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'wall-thin', name: { de: 'Trennwand', en: 'Partition wall' }, words: ['wand', 'wall', 'trockenbau'], vw: 300, vh: 8, w: 300, h: 8, quiet: true, elements: [rect(0, 0, 300, 8, { f: 'soft', s: 'line', w: 1.5 })], fill: 'none' },
  {
    id: 'door', name: { de: 'Tür', en: 'Door' }, words: ['tuer'], vw: 90, vh: 90, w: 90, h: 90, keep: true, quiet: true,
    elements: [rect(0, 86, 90, 4, { f: 'paper', s: 'none' }), stroke('M0 90V0', 3), stroke('M0 0A90 90 0 0 1 90 90', 1.2, true)], fill: 'none',
  },
  {
    id: 'double-door', name: { de: 'Doppeltür', en: 'Double door' }, words: ['fluegeltuer'], vw: 160, vh: 80, w: 160, h: 80, keep: true, quiet: true,
    elements: [rect(0, 76, 160, 4, { f: 'paper', s: 'none' }), stroke('M0 80V0M160 80V0', 3), stroke('M0 0A80 80 0 0 1 80 80M160 0A80 80 0 0 0 80 80', 1.2, true)], fill: 'none',
  },
  { id: 'sliding-door', name: { de: 'Schiebetür', en: 'Sliding door' }, vw: 100, vh: 16, w: 100, h: 16, quiet: true, elements: [rect(0, 0, 60, 6, { f: 'paper' }), rect(40, 10, 60, 6, { f: 'paper' })], fill: 'none' },
  { id: 'window', name: { de: 'Fenster', en: 'Window' }, vw: 120, vh: 14, w: 120, h: 14, quiet: true, elements: [rect(0, 0, 120, 14, { f: 'paper' }), line(0, 7, 120, 7, 1.2)], fill: 'none' },
  {
    id: 'stairs', name: { de: 'Treppe', en: 'Stairs' }, words: ['stufen', 'steps'], vw: 100, vh: 280, w: 100, h: 280, quiet: true,
    elements: [rect(0, 0, 100, 280), ...lines(stairSteps - 1, (i) => [0, 28 * (i + 1), 100, 28 * (i + 1)], 1.2), stroke('M50 260V24M40 38L50 22L60 38', 1.5)], fill: 'none',
  },
  {
    id: 'bed', name: { de: 'Bett', en: 'Bed' }, words: ['einzelbett', 'single bed'], vw: 90, vh: 200, w: 90, h: 200, keep: true, quiet: true,
    elements: [rect(0, 0, 90, 200, { rx: 4 }), rect(10, 8, 70, 32, { rx: 8, f: 'paper' }), stroke('M0 60H90', 1.2)], fill: 'none',
  },
  {
    id: 'double-bed', name: { de: 'Doppelbett', en: 'Double bed' }, words: ['bett', 'bed'], vw: 180, vh: 200, w: 180, h: 200, keep: true, quiet: true,
    elements: [rect(0, 0, 180, 200, { rx: 4 }), rect(10, 8, 74, 32, { rx: 8, f: 'paper' }), rect(96, 8, 74, 32, { rx: 8, f: 'paper' }), stroke('M0 60H180', 1.2)], fill: 'none',
  },
  {
    id: 'sofa', name: { de: 'Sofa', en: 'Sofa' }, words: ['couch'], vw: 200, vh: 90, w: 200, h: 90, quiet: true,
    elements: [rect(0, 0, 200, 90, { rx: 10 }), rect(0, 0, 200, 22, { rx: 8, f: 'soft' }), rect(0, 0, 22, 90, { rx: 8, f: 'soft' }), rect(178, 0, 22, 90, { rx: 8, f: 'soft' }), line(100, 22, 100, 90, 1.2)], fill: 'none',
  },
  { id: 'armchair', name: { de: 'Sessel', en: 'Armchair' }, vw: 80, vh: 80, w: 80, h: 80, keep: true, quiet: true, elements: [rect(0, 0, 80, 80, { rx: 10 }), rect(0, 0, 80, 20, { rx: 8, f: 'soft' }), rect(0, 0, 16, 80, { rx: 6, f: 'soft' }), rect(64, 0, 16, 80, { rx: 6, f: 'soft' })], fill: 'none' },
  { id: 'table', name: { de: 'Tisch', en: 'Table' }, words: ['esstisch'], vw: 160, vh: 90, w: 160, h: 90, elements: [rect(0, 0, 160, 90, { rx: 4 })], fill: 'none' },
  { id: 'round-table', name: { de: 'Runder Tisch', en: 'Round table' }, vw: 120, vh: 120, w: 120, h: 120, keep: true, elements: [circle(60, 60, 60)], text: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, fill: 'none' },
  { id: 'chair', name: { de: 'Stuhl', en: 'Chair' }, vw: 45, vh: 45, w: 45, h: 45, keep: true, quiet: true, elements: [rect(2, 8, 41, 37, { rx: 6 }), rect(0, 0, 45, 8, { rx: 3, f: 'soft' })], fill: 'none' },
  { id: 'desk', name: { de: 'Schreibtisch', en: 'Desk' }, words: ['arbeitsplatz', 'workplace'], vw: 160, vh: 80, w: 160, h: 80, elements: [rect(0, 0, 160, 80, { rx: 3 }), rect(55, 6, 50, 6, { rx: 2, f: 'soft' })], fill: 'none' },
  { id: 'office-chair', name: { de: 'Bürostuhl', en: 'Office chair' }, vw: 60, vh: 60, w: 60, h: 60, keep: true, quiet: true, elements: [circle(30, 32, 26), rect(8, 0, 44, 10, { rx: 5, f: 'soft' })], fill: 'none' },
  { id: 'wardrobe', name: { de: 'Schrank', en: 'Wardrobe' }, words: ['kleiderschrank', 'cupboard'], vw: 120, vh: 60, w: 120, h: 60, quiet: true, elements: [rect(0, 0, 120, 60), line(60, 0, 60, 60, 1.2), stroke('M0 0L60 60M60 0L0 60M60 0L120 60M120 0L60 60', 0.8, true)], fill: 'none' },
  { id: 'counter', name: { de: 'Küchenzeile', en: 'Kitchen counter' }, words: ['kueche', 'arbeitsplatte', 'kitchen'], vw: 240, vh: 60, w: 240, h: 60, elements: [rect(0, 0, 240, 60), ...lines(3, (i) => [60 * (i + 1), 0, 60 * (i + 1), 60], 0.8)], fill: 'none' },
  { id: 'stove', name: { de: 'Herd', en: 'Stove' }, words: ['kochfeld', 'cooktop'], vw: 60, vh: 60, w: 60, h: 60, keep: true, quiet: true, elements: [rect(0, 0, 60, 60), circle(17, 17, 10, { f: 'none' }), circle(43, 17, 8, { f: 'none' }), circle(17, 43, 8, { f: 'none' }), circle(43, 43, 10, { f: 'none' })], fill: 'none' },
  { id: 'sink', name: { de: 'Spüle', en: 'Kitchen sink' }, words: ['spuele', 'becken'], vw: 80, vh: 60, w: 80, h: 60, quiet: true, elements: [rect(0, 0, 80, 60), rect(8, 10, 64, 44, { rx: 10, f: 'paper' }), circle(40, 32, 3, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'fridge', name: { de: 'Kühlschrank', en: 'Fridge' }, words: ['kuehlschrank'], vw: 60, vh: 65, w: 60, h: 65, quiet: true, elements: [rect(0, 0, 60, 65), stroke('M0 55H60', 1.2), stroke('M8 60H24', 2)], fill: 'none' },
  { id: 'bathtub', name: { de: 'Badewanne', en: 'Bathtub' }, words: ['wanne', 'bad'], vw: 170, vh: 75, w: 170, h: 75, quiet: true, elements: [rect(0, 0, 170, 75, { rx: 8 }), rect(10, 10, 150, 55, { rx: 26, f: 'paper' }), circle(30, 37, 4, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'shower', name: { de: 'Dusche', en: 'Shower' }, vw: 90, vh: 90, w: 90, h: 90, keep: true, quiet: true, elements: [rect(0, 0, 90, 90), stroke('M0 0L90 90M90 0L0 90', 0.8), circle(45, 45, 5, { f: 'paper' })], fill: 'none' },
  { id: 'toilet', name: { de: 'WC', en: 'Toilet' }, words: ['toilette', 'klo'], vw: 40, vh: 65, w: 40, h: 65, keep: true, quiet: true, elements: [rect(0, 0, 40, 18, { rx: 3 }), ellipse(20, 42, 17, 22)], fill: 'none' },
  { id: 'washbasin', name: { de: 'Waschbecken', en: 'Washbasin' }, words: ['becken', 'sink'], vw: 60, vh: 45, w: 60, h: 45, keep: true, quiet: true, elements: [rect(0, 0, 60, 45, { rx: 4 }), ellipse(30, 25, 22, 15, { f: 'paper' }), circle(30, 8, 2.5, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'plant', name: { de: 'Pflanze', en: 'Plant' }, words: ['blume', 'topf'], vw: 50, vh: 50, w: 50, h: 50, keep: true, quiet: true, elements: [circle(25, 25, 24, { f: 'none', s: 'soft' }), path('M25 25C14 6 6 14 2 22C10 22 18 24 25 25ZM25 25C36 6 44 14 48 22C40 22 32 24 25 25ZM25 25C14 44 6 36 2 28C10 28 18 26 25 25ZM25 25C36 44 44 36 48 28C40 28 32 26 25 25Z', { f: 'fill' })], fill: '#4ade80' },
  {
    id: 'dimension', name: { de: 'Maß', en: 'Dimension' }, words: ['bemassung', 'messen', 'measure', 'laenge', 'length'], vw: 200, vh: 30, w: 200, h: 30, measure: true,
    elements: [rect(0, 0, 200, 30, { f: 'none', s: 'none' }), line(0, 22, 200, 22, 1.2), line(0, 14, 0, 30, 1.2), line(200, 14, 200, 30, 1.2), stroke('M8 18L0 22L8 26M192 18L200 22L192 26', 1.2)],
    text: { x: 0, y: 0, w: 1, h: 0.62 }, fill: 'none',
  },
  { id: 'room', hollow: true, name: { de: 'Raum', en: 'Room' }, words: ['zimmer', 'flaeche', 'area'], vw: 400, vh: 300, w: 400, h: 300, elements: [rect(0, 0, 400, 300, { f: 'soft', s: 'line', w: 1 })], text: { x: 0.05, y: 0.05, w: 0.9, h: 0.25 }, fill: 'none' },
]

// ---------- Project management ----------

const person = (x: number, y: number, s: number) => [circle(x + 20 * s, y + 13 * s, 12 * s), path(`M${x} ${y + 60 * s}C${x} ${y + 36 * s} ${x + 9 * s} ${y + 28 * s} ${x + 20 * s} ${y + 28 * s}C${x + 31 * s} ${y + 28 * s} ${x + 40 * s} ${y + 36 * s} ${x + 40 * s} ${y + 60 * s}Z`)]
const below = { x: -0.4, y: 1.04, w: 1.8, h: 0.42 }
/** Beside the symbol on the right: network plans run top to bottom, their lines would cross words below. */
const beside = { x: 1.04, y: 0.15, w: 1.15, h: 0.7 }

const project: ShapeDef[] = [
  { id: 'task', name: { de: 'Aufgabe', en: 'Task' }, words: ['karte', 'card', 'todo'], vw: 180, vh: 110, elements: [rect(0, 0, 180, 110, { rx: 10 }), rect(0, 0, 180, 24, { rx: 10, f: 'soft', s: 'none' }), line(0, 24, 180, 24, 1)], text: { x: 0.05, y: 0.26, w: 0.9, h: 0.7 }, fill: '#fde68a' },
  { id: 'milestone', name: { de: 'Meilenstein', en: 'Milestone' }, vw: 60, vh: 60, keep: true, elements: [path('M30 0L60 30L30 60L0 30Z')], outline: outline(60, 60, [[30, 0], [60, 30], [30, 60], [0, 30]]), text: below, fill: '#ff8a70' },
  { id: 'bar', name: { de: 'Balken', en: 'Bar' }, words: ['gantt', 'zeitraum', 'dauer', 'duration'], vw: 240, vh: 36, elements: [rect(0, 0, 240, 36, { rx: 8 })], text: { x: 0.03, y: 0, w: 0.94, h: 1 }, fill: BLUE },
  { id: 'phase', name: { de: 'Phase', en: 'Phase' }, words: ['schritt', 'stufe', 'stage'], vw: 200, vh: 60, elements: [path('M0 0H170L200 30L170 60H0L22 30Z')], outline: outline(200, 60, [[0, 0], [170, 0], [200, 30], [170, 60], [0, 60], [22, 30]]), text: { x: 0.14, y: 0, w: 0.7, h: 1 }, fill: '#a78bfa' },
  { id: 'lane', hollow: true, name: { de: 'Schwimmbahn', en: 'Swimlane' }, words: ['bahn', 'lane', 'zustaendig'], vw: 600, vh: 160, elements: [rect(0, 0, 600, 160, { f: 'none' }), rect(0, 0, 600, 30, { f: 'soft', s: 'line' })], text: { x: 0.01, y: 0, w: 0.98, h: 0.19 }, fill: 'none' },
  { id: 'column', hollow: true, name: { de: 'Kanban-Spalte', en: 'Kanban column' }, words: ['kanban', 'spalte', 'column'], vw: 220, vh: 420, elements: [rect(0, 0, 220, 420, { rx: 12, f: 'soft', s: 'line', w: 1 }), line(0, 44, 220, 44, 1)], text: { x: 0.06, y: 0, w: 0.88, h: 0.1 }, fill: 'none' },
  { id: 'person', name: { de: 'Person', en: 'Person' }, words: ['mensch', 'rolle', 'role', 'user', 'nutzer'], vw: 40, vh: 60, keep: true, elements: person(0, 0, 1), text: below, fill: BLUE },
  { id: 'team', name: { de: 'Team', en: 'Team' }, words: ['gruppe', 'group', 'leute', 'people'], vw: 70, vh: 60, keep: true, elements: [...person(30, 0, 1), ...person(0, 6, 0.9)], text: below, fill: BLUE },
  { id: 'flag', name: { de: 'Fahne', en: 'Flag' }, words: ['ziel', 'goal'], vw: 60, vh: 80, keep: true, elements: [line(6, 0, 6, 80, 3), path('M6 4H58L46 20L58 36H6Z')], text: below, fill: '#f87171' },
  { id: 'done', name: { de: 'Erledigt', en: 'Done' }, words: ['haken', 'check', 'ok'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), stroke('M16 31L26 41L45 20', 4)], text: below, fill: '#4ade80' },
  { id: 'risk', name: { de: 'Risiko', en: 'Risk' }, words: ['warnung', 'warning', 'achtung'], vw: 70, vh: 62, keep: true, elements: [path('M35 0L70 62H0Z'), line(35, 20, 35, 42, 4), circle(35, 51, 3, { f: 'line', s: 'none' })], outline: outline(70, 62, [[35, 0], [70, 62], [0, 62]]), text: below, fill: '#fbbf24' },
  { id: 'deadline', name: { de: 'Termin', en: 'Deadline' }, words: ['uhr', 'clock', 'zeit', 'time'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), stroke('M30 12V30L42 38', 3)], text: below, fill: LIGHT },
  { id: 'calendar', name: { de: 'Kalender', en: 'Calendar' }, words: ['datum', 'date'], vw: 60, vh: 60, keep: true, elements: [rect(0, 6, 60, 54, { rx: 6 }), rect(0, 6, 60, 14, { rx: 6, f: 'line', s: 'none' }), line(16, 0, 16, 12, 3), line(44, 0, 44, 12, 3), ...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => circle(15 + c * 15, 30 + r * 10, 2.5, { f: 'line', s: 'none' })))], text: below, fill: 'none' },
  { id: 'goal', name: { de: 'Zielscheibe', en: 'Target' }, words: ['ziel', 'goal', 'okr'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), circle(30, 30, 20, { f: 'paper' }), circle(30, 30, 10)], text: below, fill: '#f87171' },
  { id: 'idea', name: { de: 'Idee', en: 'Idea' }, words: ['gluehbirne', 'lightbulb', 'einfall'], vw: 46, vh: 66, keep: true, elements: [path('M23 0C36 0 46 10 46 23C46 33 39 38 36 44V52H10V44C7 38 0 33 0 23C0 10 10 0 23 0Z'), rect(12, 56, 22, 10, { rx: 3, f: 'soft' })], text: below, fill: '#fde68a' },
  { id: 'meeting', name: { de: 'Besprechung', en: 'Meeting' }, words: ['termin', 'treffen', 'sprechblasen', 'talk'], vw: 80, vh: 60, keep: true, elements: [path('M0 6Q0 0 6 0H44Q50 0 50 6V28Q50 34 44 34H18L8 44V34H6Q0 34 0 28Z'), path('M30 22Q30 16 36 16H74Q80 16 80 22V44Q80 50 74 50H72V60L62 50H36Q30 50 30 44Z', { f: 'soft' })], text: below, fill: BLUE },
]

// ---------- Network ----------

const net: ShapeDef[] = [
  {
    id: 'router', name: { de: 'Router', en: 'Router' }, words: ['gateway'], vw: 90, vh: 56, keep: true,
    elements: [path('M0 14A45 14 0 0 1 90 14V42A45 14 0 0 1 0 42Z'), ellipse(45, 14, 45, 14), stroke('M26 8L36 13M36 13L33 7M36 13L30 14M64 20L54 15M54 15L57 21M54 15L60 14M58 6L48 11M48 11L54 12M48 11L51 5M32 22L42 17M42 17L36 16M42 17L39 23', 1.6)],
    text: beside, fill: BLUE,
  },
  {
    id: 'switch', name: { de: 'Switch', en: 'Switch' }, words: ['netzwerkswitch', 'hub'], vw: 110, vh: 44, keep: true,
    elements: [rect(0, 0, 110, 44, { rx: 6 }), stroke('M20 14H70M62 9L70 14L62 19M90 30H40M48 25L40 30L48 35', 1.8)], text: beside, fill: BLUE,
  },
  {
    id: 'firewall', name: { de: 'Firewall', en: 'Firewall' }, words: ['mauer', 'wall', 'sicherheit', 'security'], vw: 90, vh: 64, keep: true,
    elements: [rect(0, 0, 90, 64, { rx: 3 }), ...lines(3, (i) => [0, 16 * (i + 1), 90, 16 * (i + 1)], 1.2), stroke('M30 0V16M60 0V16M15 16V32M45 16V32M75 16V32M30 32V48M60 32V48M15 48V64M45 48V64M75 48V64', 1.2)], text: beside, fill: '#f87171',
  },
  {
    id: 'server', name: { de: 'Server', en: 'Server' }, words: ['rechner', 'host'], vw: 56, vh: 84, keep: true,
    elements: [rect(0, 0, 56, 84, { rx: 6 }), line(0, 28, 56, 28, 1.2), line(0, 56, 56, 56, 1.2), ...[14, 42, 70].map((y) => circle(44, y, 3, { f: 'paper', s: 'none' })), ...[14, 42, 70].map((y) => line(10, y, 30, y, 2))], text: beside, fill: BLUE,
  },
  {
    id: 'nas', name: { de: 'NAS', en: 'NAS' }, words: ['speicher', 'storage', 'synology', 'festplatten'], vw: 80, vh: 66, keep: true,
    elements: [rect(0, 0, 80, 66, { rx: 6 }), ...[0, 1, 2, 3].map((i) => rect(9 + i * 17, 10, 11, 38, { rx: 2, f: 'paper', w: 1 })), circle(66, 56, 3, { f: 'paper', s: 'none' })], text: beside, fill: BLUE,
  },
  {
    id: 'access-point', name: { de: 'Access Point', en: 'Access point' }, words: ['wlan', 'wifi', 'funk'], vw: 80, vh: 62, keep: true,
    elements: [path('M6 62A34 18 0 0 1 74 62Z'), stroke('M22 34A22 22 0 0 1 58 34M12 24A36 36 0 0 1 68 24M2 14A50 50 0 0 1 78 14', 2)], text: beside, fill: BLUE,
  },
  {
    id: 'internet', name: { de: 'Internet', en: 'Internet' }, words: ['wolke', 'cloud', 'wan'], vw: 120, vh: 76,
    elements: [path('M30 70C12 70 2 58 6 46C-1 37 7 21 23 24C26 8 48 3 59 14C69 1 93 5 94 23C111 23 120 38 113 50C120 64 106 75 92 69C83 78 62 78 53 70C45 75 37 74 30 70Z')],
    text: { x: 0.15, y: 0.28, w: 0.7, h: 0.5 }, fill: LIGHT,
  },
  { id: 'pc', name: { de: 'PC', en: 'PC' }, words: ['computer', 'desktop', 'arbeitsplatz', 'monitor'], vw: 80, vh: 70, keep: true, elements: [rect(0, 0, 80, 52, { rx: 4 }), rect(6, 6, 68, 40, { rx: 2, f: 'paper', w: 1 }), path('M30 52H50L54 64H26Z'), line(18, 68, 62, 68, 3)], text: beside, fill: BLUE },
  { id: 'laptop', name: { de: 'Laptop', en: 'Laptop' }, words: ['notebook'], vw: 96, vh: 60, keep: true, elements: [rect(12, 0, 72, 48, { rx: 4 }), rect(17, 5, 62, 38, { rx: 2, f: 'paper', w: 1 }), path('M0 52H96L90 60H6Z')], text: beside, fill: BLUE },
  { id: 'phone', name: { de: 'Handy', en: 'Phone' }, words: ['smartphone', 'telefon', 'mobil'], vw: 40, vh: 72, keep: true, elements: [rect(0, 0, 40, 72, { rx: 7 }), rect(4, 8, 32, 54, { rx: 2, f: 'paper', w: 1 }), line(16, 4, 24, 4, 1.5)], text: beside, fill: BLUE },
  { id: 'tablet', name: { de: 'Tablet', en: 'Tablet' }, words: ['ipad'], vw: 60, vh: 80, keep: true, elements: [rect(0, 0, 60, 80, { rx: 7 }), rect(5, 7, 50, 64, { rx: 2, f: 'paper', w: 1 }), circle(30, 75, 2, { f: 'paper', s: 'none' })], text: beside, fill: BLUE },
  { id: 'printer', name: { de: 'Drucker', en: 'Printer' }, words: ['scanner'], vw: 80, vh: 64, keep: true, elements: [rect(16, 0, 48, 20, { f: 'paper' }), rect(0, 18, 80, 30, { rx: 5 }), rect(16, 40, 48, 24, { f: 'paper' }), circle(68, 28, 3, { f: 'paper', s: 'none' })], text: beside, fill: BLUE },
  {
    id: 'rack', name: { de: 'Rack', en: 'Rack' }, words: ['schrank', 'serverschrank', 'cabinet'], vw: 100, vh: 220,
    elements: [rect(0, 0, 100, 220, { rx: 4 }), rect(8, 10, 84, 200, { f: 'paper', w: 1 }), ...lines(19, (i) => [8, 10 + 10 * (i + 1), 92, 10 + 10 * (i + 1)], 0.6)], text: beside, fill: '#3f3f46',
  },
  {
    id: 'patch-panel', name: { de: 'Patchfeld', en: 'Patch panel' }, words: ['patchpanel', 'ports', 'buchsen'], vw: 200, vh: 30, quiet: true,
    elements: [rect(0, 0, 200, 30, { rx: 2 }), ...Array.from({ length: 12 }, (_, i) => rect(14 + i * 15, 9, 10, 12, { f: 'paper', w: 1 }))], fill: '#3f3f46',
  },
  { id: 'camera', name: { de: 'Kamera', en: 'Camera' }, words: ['ueberwachung', 'cctv', 'webcam'], vw: 80, vh: 56, keep: true, elements: [rect(0, 6, 60, 30, { rx: 6 }), circle(46, 21, 9, { f: 'paper' }), path('M60 14L80 6V36L60 28Z'), stroke('M20 36V56M8 56H32', 3)], text: beside, fill: BLUE },
  { id: 'modem', name: { de: 'Modem', en: 'Modem' }, words: ['dsl', 'kabel', 'glasfaser', 'fiber'], vw: 90, vh: 46, keep: true, elements: [rect(0, 14, 90, 32, { rx: 6 }), stroke('M74 14L82 0', 2.5), ...[0, 1, 2, 3].map((i) => circle(16 + i * 12, 30, 3, { f: 'paper', s: 'none' }))], text: beside, fill: BLUE },
  { id: 'load-balancer', name: { de: 'Lastverteiler', en: 'Load balancer' }, words: ['loadbalancer', 'proxy', 'verteiler'], vw: 64, vh: 64, keep: true, elements: [circle(32, 32, 32), stroke('M12 32H28M28 32L44 18M28 32L44 46M28 32H48M38 14L45 18L40 24M38 50L45 46L40 40M43 27L49 32L43 37', 2)], text: beside, fill: BLUE },
  { id: 'database', name: { de: 'Datenbank', en: 'Database' }, words: ['db', 'sql'], vw: 60, vh: 76, keep: true, elements: [path('M0 10A30 10 0 0 1 60 10V66A30 10 0 0 1 0 66Z'), ellipse(30, 10, 30, 10), stroke('M0 30A30 10 0 0 0 60 30M0 48A30 10 0 0 0 60 48', 1.2)], text: beside, fill: BLUE },
  { id: 'zone', hollow: true, name: { de: 'Zone', en: 'Zone' }, words: ['vlan', 'netz', 'subnet', 'bereich', 'gruppe'], vw: 320, vh: 200, elements: [rect(0, 0, 320, 200, { rx: 16, f: 'none', s: 'line', dash: true, w: 1.5 })], text: { x: 0.04, y: 0.02, w: 0.92, h: 0.15 }, fill: 'none' },
]

export const BUILTIN: ShapePackage[] = [
  { ...META, id: 'basic', name: { de: 'Grundformen', en: 'Basic shapes' }, shapes: basic },
  { ...META, id: 'flow', name: { de: 'Ablaufdiagramm', en: 'Flowchart' }, shapes: flow },
  { ...META, id: 'room', name: { de: 'Raumplan', en: 'Floor plan' }, shapes: room },
  { ...META, id: 'project', name: { de: 'Projektmanagement', en: 'Project management' }, shapes: project },
  { ...META, id: 'network', name: { de: 'Netzwerk', en: 'Network' }, shapes: net },
]
