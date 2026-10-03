/**
 * The packages that come with nexcanvas. All symbols are drawn for nexcanvas in the line style of its basic shapes;
 * none is taken from a maker's icon set. In the floor plan one unit is one centimetre, so a bed placed with a click is
 * as large next to a door as it is in a room.
 */
import { shapePath } from '../geometry'
import type { ShapeKind } from '../types'
import { bpmn } from './bpmn'
import { BLUE, circle, ellipse, gearPath, LIGHT, line, lines, mark, outline, path, polygonPoints, rect, starPoints, stroke, through } from './draw'
import { house } from './house'
import { signs } from './signs'
import type { ShapeDef, ShapePackage } from './types'
import { uml } from './uml'

const META = { version: '1.0.0', author: 'nexcanvas', license: 'AGPL-3.0', builtin: true, scope: 'builtin' as const, enabled: true }

/** The board's own shapes, as in the toolbar: placed from the library they are those, not shapes of a package. */
const NATIVE: [ShapeKind, string, string, number, number][] = [
  ['rect', 'Rechteck', 'Rectangle', 160, 120],
  ['round', 'Abgerundetes Rechteck', 'Rounded rectangle', 160, 120],
  ['ellipse', 'Ellipse', 'Ellipse', 160, 120],
  ['triangle', 'Dreieck', 'Triangle', 140, 120],
  ['diamond', 'Raute', 'Diamond', 140, 120],
  ['hexagon', 'Sechseck', 'Hexagon', 160, 120],
  ['star', 'Stern', 'Star', 120, 120],
  ['arrow', 'Pfeil', 'Arrow', 160, 100],
  ['speech', 'Sprechblase', 'Speech bubble', 160, 120],
]
const native: ShapeDef[] = NATIVE.map(([kind, de, en, vw, vh]) => ({ id: kind, name: { de, en }, words: ['grundform', 'basic', kind], vw, vh, native: kind, elements: [path(shapePath(kind, vw, vh))], fill: BLUE }))

// ---------- Basic shapes ----------

const basic: ShapeDef[] = [
  ...native,
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
  { id: 'circle', name: { de: 'Kreis', en: 'Circle' }, words: ['rund', 'round'], vw: 100, vh: 100, keep: true, elements: [circle(50, 50, 50)], text: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, fill: BLUE },
  { id: 'square', name: { de: 'Quadrat', en: 'Square' }, words: ['viereck'], vw: 100, vh: 100, keep: true, elements: [rect(0, 0, 100, 100)], fill: BLUE },
  { id: 'heptagon', name: { de: 'Siebeneck', en: 'Heptagon' }, vw: 100, vh: 100, elements: [path(through(polygonPoints(7, 50, 52, 50)))], outline: outline(100, 100, polygonPoints(7, 50, 52, 50)), text: { x: 0.2, y: 0.25, w: 0.6, h: 0.55 }, fill: BLUE },
  { id: 'decagon', name: { de: 'Zehneck', en: 'Decagon' }, vw: 100, vh: 100, elements: [path(through(polygonPoints(10, 50, 50, 50)))], outline: outline(100, 100, polygonPoints(10, 50, 50, 50)), text: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, fill: BLUE },
  { id: 'plaque', name: { de: 'Plakette', en: 'Plaque' }, words: ['schild', 'sign'], vw: 140, vh: 80, elements: [path('M14 0H126A14 14 0 0 0 140 14V66A14 14 0 0 0 126 80H14A14 14 0 0 0 0 66V14A14 14 0 0 0 14 0Z')], text: { x: 0.1, y: 0.12, w: 0.8, h: 0.76 }, fill: BLUE },
  { id: 'snip', name: { de: 'Abgeschnittene Ecke', en: 'Snipped corner' }, words: ['ecke', 'corner', 'karte'], vw: 140, vh: 80, elements: [path('M0 0H116L140 24V80H0Z')], outline: outline(140, 80, [[0, 0], [116, 0], [140, 24], [140, 80], [0, 80]]), fill: BLUE },
  { id: 'frame', name: { de: 'Rahmen', en: 'Frame' }, words: ['bilderrahmen', 'border'], vw: 140, vh: 100, elements: [rect(0, 0, 140, 100), rect(12, 12, 116, 76, { f: 'paper' })], text: { x: 0.12, y: 0.15, w: 0.76, h: 0.7 }, fill: BLUE },
  { id: 'ring', name: { de: 'Ring', en: 'Ring' }, words: ['donut', 'kreis'], vw: 100, vh: 100, keep: true, elements: [circle(50, 50, 50), circle(50, 50, 28, { f: 'paper' })], text: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, fill: BLUE },
  { id: 'pie', name: { de: 'Kreisausschnitt', en: 'Pie' }, words: ['torte', 'tortenstueck', 'segment', 'anteil'], vw: 100, vh: 100, keep: true, elements: [path('M50 50L50 0A50 50 0 1 1 0 50Z')], text: { x: 0.45, y: 0.45, w: 0.45, h: 0.4 }, fill: BLUE },
  { id: 'moon', name: { de: 'Mond', en: 'Moon' }, words: ['sichel', 'crescent', 'nacht'], vw: 50, vh: 100, keep: true, quiet: true, elements: [path('M50 0A50 50 0 0 0 50 100A30 50 0 0 1 50 0Z')], fill: '#fde68a' },
  { id: 'lightning', name: { de: 'Blitz', en: 'Lightning' }, words: ['strom', 'energie', 'zap', 'schnell'], vw: 90, vh: 100, keep: true, quiet: true, elements: [path('M40 0H90L60 40H85L20 100L38 55H10Z')], fill: '#fde047' },
  { id: 'drop', name: { de: 'Tropfen', en: 'Drop' }, words: ['wasser', 'water', 'fluessig'], vw: 80, vh: 110, keep: true, elements: [path('M40 0C40 0 80 45 80 70A40 40 0 0 1 0 70C0 45 40 0 40 0Z')], text: { x: 0.15, y: 0.5, w: 0.7, h: 0.4 }, fill: '#93c5fd' },
  { id: 'shield', name: { de: 'Schild', en: 'Shield' }, words: ['wappen', 'sicherheit', 'security'], vw: 100, vh: 110, keep: true, elements: [path('M50 0L100 15V50C100 80 75 100 50 110C25 100 0 80 0 50V15Z')], text: { x: 0.15, y: 0.2, w: 0.7, h: 0.55 }, fill: BLUE },
  { id: 'wave', name: { de: 'Welle', en: 'Wave' }, words: ['banner', 'flagge', 'fahne'], vw: 140, vh: 80, elements: [path('M0 12C35 -4 70 28 105 12Q125 2 140 10V68C105 84 70 52 35 68Q15 78 0 72Z')], text: { x: 0.05, y: 0.18, w: 0.9, h: 0.64 }, fill: BLUE },
  { id: 'l-shape', name: { de: 'Winkel', en: 'L-shape' }, words: ['ecke', 'l'], vw: 100, vh: 100, elements: [path('M0 0H34V66H100V100H0Z')], outline: outline(100, 100, [[0, 0], [34, 0], [34, 66], [100, 66], [100, 100], [0, 100]]), text: { x: 0.02, y: 0.68, w: 0.96, h: 0.3 }, fill: BLUE },
  { id: 'cone', name: { de: 'Kegel', en: 'Cone' }, words: ['3d', 'trichter'], vw: 100, vh: 110, elements: [path('M50 0L100 96A50 14 0 0 1 0 96Z'), stroke('M0 96A50 14 0 0 1 100 96', 1, true)], text: { x: 0.2, y: 0.45, w: 0.6, h: 0.4 }, fill: BLUE },
  { id: 'pyramid', name: { de: 'Pyramide', en: 'Pyramid' }, words: ['3d', 'hierarchie'], vw: 110, vh: 100, elements: [path('M55 0L110 78L66 100L0 84Z'), stroke('M55 0L66 100', 1.5)], text: { x: 0.12, y: 0.45, w: 0.5, h: 0.35 }, fill: BLUE },
  { id: 'sphere', name: { de: 'Kugel', en: 'Sphere' }, words: ['3d', 'ball', 'globus'], vw: 100, vh: 100, keep: true, elements: [circle(50, 50, 50), stroke('M0 50A50 16 0 0 0 100 50', 1.2)], text: { x: 0.15, y: 0.15, w: 0.7, h: 0.5 }, fill: BLUE },
  { id: 'many-star', name: { de: 'Zackenstern', en: 'Many-pointed star' }, words: ['siegel', 'badge', 'stoerer', 'stern'], vw: 100, vh: 100, keep: true, elements: [path(through(starPoints(16, 50, 50, 50, 40)))], text: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fill: '#fbbf24' },
  { id: 'gear', name: { de: 'Zahnrad', en: 'Gear' }, words: ['einstellung', 'settings', 'technik'], vw: 100, vh: 100, keep: true, quiet: true, elements: [path(gearPath(10, 50, 50, 50, 41)), circle(50, 50, 16, { f: 'paper' })], fill: '#a1a1aa' },
]

// ---------- Flowchart ----------

const flow: ShapeDef[] = [
  { id: 'terminator', name: { de: 'Start und Ende', en: 'Start and end' }, words: ['terminator', 'anfang', 'begin'], vw: 140, vh: 60, elements: [rect(0, 0, 140, 60, { rx: 30 })], text: { x: 0.12, y: 0, w: 0.76, h: 1 }, fill: LIGHT },
  { id: 'process', name: { de: 'Prozess', en: 'Process' }, words: ['schritt', 'step', 'aktion'], vw: 140, vh: 70, elements: [rect(0, 0, 140, 70, { rx: 4 })], fill: LIGHT },
  { id: 'decision', name: { de: 'Entscheidung', en: 'Decision' }, words: ['frage', 'question', 'wenn', 'if'], vw: 140, vh: 90, elements: [path('M70 0L140 45L70 90L0 45Z')], outline: outline(140, 90, [[70, 0], [140, 45], [70, 90], [0, 45]]), text: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fill: '#fde68a' },
  { id: 'data', name: { de: 'Daten', en: 'Data' }, words: ['eingabe', 'ausgabe', 'input', 'output'], vw: 140, vh: 70, elements: [path('M28 0H140L112 70H0Z')], outline: outline(140, 70, [[28, 0], [140, 0], [112, 70], [0, 70]]), text: { x: 0.2, y: 0, w: 0.6, h: 1 }, fill: LIGHT },
  { id: 'predefined', name: { de: 'Unterprozess', en: 'Subprocess' }, words: ['vordefiniert', 'predefined'], vw: 140, vh: 70, elements: [rect(0, 0, 140, 70), mark('M14 0V70M126 0V70')], text: { x: 0.12, y: 0, w: 0.76, h: 1 }, fill: LIGHT },
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
  { id: 'sort', name: { de: 'Sortieren', en: 'Sort' }, words: ['sortierung', 'ordnen'], vw: 140, vh: 90, elements: [path('M70 0L140 45L70 90L0 45Z'), mark('M0 45H140', 1.5)], outline: outline(140, 90, [[70, 0], [140, 45], [70, 90], [0, 45]]), text: { x: 0.25, y: 0.14, w: 0.5, h: 0.32 }, fill: LIGHT },
  { id: 'collate', name: { de: 'Zusammenstellen', en: 'Collate' }, words: ['sanduhr', 'hourglass', 'sammeln'], vw: 100, vh: 100, elements: [path('M0 0H100L0 100H100Z')], outline: outline(100, 100, [[0, 0], [100, 0], [0, 100], [100, 100]]), text: { x: 0.25, y: 0, w: 0.5, h: 0.4 }, fill: LIGHT },
  { id: 'extract', name: { de: 'Auszug', en: 'Extract' }, words: ['dreieck', 'triangle', 'herausziehen'], vw: 100, vh: 80, elements: [path('M50 0L100 80H0Z')], outline: outline(100, 80, [[50, 0], [100, 80], [0, 80]]), text: { x: 0.25, y: 0.5, w: 0.5, h: 0.45 }, fill: LIGHT },
  { id: 'or', name: { de: 'Oder', en: 'Or' }, words: ['oder', 'or', 'verbindung'], vw: 60, vh: 60, keep: true, quiet: true, elements: [circle(30, 30, 30), mark('M30 0V60M0 30H60', 1.5)], fill: LIGHT },
  { id: 'summing-junction', name: { de: 'Summierstelle', en: 'Summing junction' }, words: ['und', 'and', 'summe'], vw: 60, vh: 60, keep: true, quiet: true, elements: [circle(30, 30, 30), mark('M8.8 8.8L51.2 51.2M51.2 8.8L8.8 51.2', 1.5)], fill: LIGHT },
  { id: 'card', name: { de: 'Lochkarte', en: 'Card' }, words: ['karte', 'punch card'], vw: 140, vh: 80, elements: [path('M24 0H140V80H0V24Z')], outline: outline(140, 80, [[24, 0], [140, 0], [140, 80], [0, 80], [0, 24]]), text: { x: 0.08, y: 0.15, w: 0.86, h: 0.8 }, fill: LIGHT },
  { id: 'paper-tape', name: { de: 'Lochstreifen', en: 'Paper tape' }, words: ['band', 'tape', 'welle'], vw: 140, vh: 80, elements: [path('M0 12C35 -4 70 28 105 12Q125 2 140 10V68C105 84 70 52 35 68Q15 78 0 72Z')], text: { x: 0.05, y: 0.18, w: 0.9, h: 0.64 }, fill: LIGHT },
  { id: 'internal-storage', name: { de: 'Interner Speicher', en: 'Internal storage' }, words: ['speicher', 'memory', 'ram'], vw: 140, vh: 80, elements: [rect(0, 0, 140, 80), mark('M16 0V80M0 16H140', 1.2)], text: { x: 0.14, y: 0.22, w: 0.82, h: 0.74 }, fill: LIGHT },
  { id: 'sequential-data', name: { de: 'Sequenzieller Speicher', en: 'Sequential data' }, words: ['band', 'tape', 'magnetband'], vw: 84, vh: 80, keep: true, elements: [circle(40, 40, 40), stroke('M40 80H84', 2)], text: { x: 0.12, y: 0.15, w: 0.72, h: 0.7 }, fill: LIGHT },
  { id: 'direct-data', name: { de: 'Direktzugriffsspeicher', en: 'Direct access storage' }, words: ['festplatte', 'disk', 'trommel', 'drum'], vw: 140, vh: 80, elements: [path('M14 0H126A14 40 0 0 1 126 80H14A14 40 0 0 1 14 0Z'), ellipse(126, 40, 14, 40)], text: { x: 0.04, y: 0.05, w: 0.78, h: 0.9 }, fill: LIGHT },
  { id: 'start-point', name: { de: 'Startpunkt', en: 'Start point' }, words: ['start', 'anfang', 'begin'], vw: 30, vh: 30, keep: true, quiet: true, elements: [circle(15, 15, 15, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'end-point', name: { de: 'Endpunkt', en: 'End point' }, words: ['ende', 'end', 'stopp'], vw: 32, vh: 32, keep: true, quiet: true, elements: [circle(16, 16, 15, { f: 'paper' }), circle(16, 16, 9, { f: 'line', s: 'none' })], fill: 'none' },
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
  {
    id: 'opening', name: { de: 'Durchgang', en: 'Opening' }, words: ['oeffnung', 'durchbruch', 'tuerloch'], vw: 90, vh: 12, w: 90, h: 12, quiet: true,
    elements: [rect(0, 0, 90, 12, { f: 'paper', s: 'none' }), line(0, 0, 0, 12, 2.5), line(90, 0, 90, 12, 2.5)], fill: 'none',
  },
  { id: 'pillar', name: { de: 'Stütze', en: 'Pillar' }, words: ['saeule', 'pfeiler', 'column', 'stuetze'], vw: 30, vh: 30, w: 30, h: 30, keep: true, quiet: true, elements: [rect(0, 0, 30, 30, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'radiator', name: { de: 'Heizkörper', en: 'Radiator' }, words: ['heizung', 'heizkoerper'], vw: 100, vh: 12, w: 100, h: 12, quiet: true, elements: [rect(0, 0, 100, 12, { rx: 2 }), ...lines(9, (i) => [10 * (i + 1), 2, 10 * (i + 1), 10], 0.8)], fill: 'none' },
  { id: 'fireplace', name: { de: 'Kamin', en: 'Fireplace' }, words: ['ofen', 'feuer', 'kaminofen'], vw: 120, vh: 50, w: 120, h: 50, quiet: true, elements: [rect(0, 0, 120, 50), path('M20 0V30H100V0', { f: 'soft' }), stroke('M45 30C40 20 50 16 50 8C58 16 56 22 60 22C62 16 64 14 68 12C72 20 74 26 72 30', 1.2)], fill: 'none' },
  { id: 'nightstand', name: { de: 'Nachttisch', en: 'Nightstand' }, words: ['nachtschrank', 'bedside'], vw: 45, vh: 40, w: 45, h: 40, keep: true, quiet: true, elements: [rect(0, 0, 45, 40, { rx: 3 }), circle(22.5, 20, 7, { f: 'none', w: 1 })], fill: 'none' },
  { id: 'dresser', name: { de: 'Kommode', en: 'Dresser' }, words: ['sideboard', 'schubladen', 'drawers'], vw: 120, vh: 50, w: 120, h: 50, quiet: true, elements: [rect(0, 0, 120, 50), line(40, 0, 40, 50, 0.8), line(80, 0, 80, 50, 0.8)], fill: 'none' },
  { id: 'shelf', name: { de: 'Regal', en: 'Shelf' }, words: ['buecherregal', 'bookshelf', 'regal'], vw: 100, vh: 35, w: 100, h: 35, quiet: true, elements: [rect(0, 0, 100, 35), stroke('M0 0L100 35', 0.8, true)], fill: 'none' },
  { id: 'tv-board', name: { de: 'Fernseher mit Board', en: 'TV and stand' }, words: ['fernseher', 'tv', 'lowboard'], vw: 160, vh: 45, w: 160, h: 45, quiet: true, elements: [rect(0, 15, 160, 30), rect(20, 4, 120, 6, { rx: 2, f: 'line', s: 'none' })], fill: 'none' },
  {
    id: 'corner-sofa', name: { de: 'Ecksofa', en: 'Corner sofa' }, words: ['sofa', 'couch', 'wohnlandschaft'], vw: 240, vh: 200, w: 240, h: 200, quiet: true,
    elements: [path('M0 10Q0 0 10 0H230Q240 0 240 10V80Q240 90 230 90H90V190Q90 200 80 200H10Q0 200 0 190Z'), path('M0 10Q0 0 10 0H230Q240 0 240 10V22H22V200H10Q0 200 0 190Z', { f: 'soft' }), line(90, 22, 90, 90, 1), line(165, 22, 165, 90, 1), line(22, 120, 90, 120, 1)],
    fill: 'none',
  },
  {
    id: 'dining-set', name: { de: 'Esstisch mit Stühlen', en: 'Dining set' }, words: ['esstisch', 'tisch', 'stuehle', 'essen'], vw: 220, vh: 170, w: 220, h: 170, quiet: true,
    elements: [...[45, 90, 135].flatMap((x) => [rect(x, 2, 40, 32, { rx: 5 }), rect(x, 136, 40, 32, { rx: 5 })]), rect(30, 26, 160, 118, { rx: 4 })],
    fill: 'none',
  },
  { id: 'kitchen-island', name: { de: 'Kochinsel', en: 'Kitchen island' }, words: ['kueche', 'insel', 'theke', 'island'], vw: 200, vh: 90, w: 200, h: 90, elements: [rect(0, 0, 200, 90), line(0, 60, 200, 60, 0.8)], text: { x: 0.05, y: 0.05, w: 0.9, h: 0.6 }, fill: 'none' },
  { id: 'washer', name: { de: 'Waschmaschine', en: 'Washing machine' }, words: ['waschmaschine', 'waesche', 'washer'], vw: 60, vh: 60, w: 60, h: 60, keep: true, quiet: true, elements: [rect(0, 0, 60, 60, { rx: 3 }), circle(30, 32, 17, { f: 'paper' }), circle(30, 32, 10, { f: 'none', w: 1 })], fill: 'none' },
  { id: 'dryer', name: { de: 'Trockner', en: 'Dryer' }, words: ['trockner', 'waesche', 'dryer'], vw: 60, vh: 60, w: 60, h: 60, keep: true, quiet: true, elements: [rect(0, 0, 60, 60, { rx: 3 }), circle(30, 32, 17, { f: 'paper' }), stroke('M22 30Q26 26 30 30T38 30M22 36Q26 32 30 36T38 36', 1)], fill: 'none' },
  { id: 'dishwasher', name: { de: 'Spülmaschine', en: 'Dishwasher' }, words: ['spuelmaschine', 'geschirr', 'dishwasher'], vw: 60, vh: 60, w: 60, h: 60, keep: true, quiet: true, elements: [rect(0, 0, 60, 60), line(0, 10, 60, 10, 1.2), stroke('M10 22H50M10 32H50M10 42H50M10 52H50', 0.8, true)], fill: 'none' },
  { id: 'oven', name: { de: 'Backofen', en: 'Oven' }, words: ['ofen', 'backofen', 'oven'], vw: 60, vh: 60, w: 60, h: 60, keep: true, quiet: true, elements: [rect(0, 0, 60, 60), rect(8, 16, 44, 36, { rx: 3, f: 'paper', w: 1 }), stroke('M14 8H46', 2)], fill: 'none' },
  { id: 'double-sink', name: { de: 'Doppelwaschbecken', en: 'Double washbasin' }, words: ['waschbecken', 'doppel', 'bad'], vw: 140, vh: 50, w: 140, h: 50, quiet: true, elements: [rect(0, 0, 140, 50, { rx: 4 }), ellipse(35, 27, 24, 16, { f: 'paper' }), ellipse(105, 27, 24, 16, { f: 'paper' })], fill: 'none' },
  { id: 'piano', name: { de: 'Klavier', en: 'Piano' }, words: ['klavier', 'piano', 'instrument'], vw: 150, vh: 60, w: 150, h: 60, quiet: true, elements: [rect(0, 0, 150, 60), rect(0, 40, 150, 20, { f: 'paper' }), ...lines(14, (i) => [10 * (i + 1), 40, 10 * (i + 1), 60], 0.6)], fill: 'none' },
  { id: 'rug', hollow: true, name: { de: 'Teppich', en: 'Rug' }, words: ['teppich', 'rug', 'laeufer'], vw: 200, vh: 140, w: 200, h: 140, elements: [rect(0, 0, 200, 140, { rx: 6, f: 'soft', s: 'line', w: 1 }), rect(10, 10, 180, 120, { rx: 4, f: 'none', s: 'line', w: 0.8, dash: true })], text: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, fill: 'none' },
  { id: 'elevator', name: { de: 'Aufzug', en: 'Elevator' }, words: ['aufzug', 'lift', 'fahrstuhl'], vw: 150, vh: 150, w: 150, h: 150, keep: true, quiet: true, elements: [rect(0, 0, 150, 150), stroke('M0 0L150 150M150 0L0 150', 1)], fill: 'none' },
  {
    id: 'spiral-stairs', name: { de: 'Wendeltreppe', en: 'Spiral stairs' }, words: ['treppe', 'wendel', 'spiral'], vw: 160, vh: 160, w: 160, h: 160, keep: true, quiet: true,
    elements: [circle(80, 80, 80), ...Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return line(80 + Math.cos(a) * 12, 80 + Math.sin(a) * 12, 80 + Math.cos(a) * 80, 80 + Math.sin(a) * 80, 0.8) }), circle(80, 80, 12, { f: 'paper' })],
    fill: 'none',
  },
  {
    id: 'car', name: { de: 'Auto', en: 'Car' }, words: ['auto', 'pkw', 'garage', 'stellplatz', 'parking'], vw: 180, vh: 450, w: 180, h: 450, keep: true, quiet: true,
    elements: [path('M30 0H150Q180 0 180 40V410Q180 450 150 450H30Q0 450 0 410V40Q0 0 30 0Z'), rect(20, 120, 140, 70, { rx: 14, f: 'soft' }), rect(20, 330, 140, 50, { rx: 12, f: 'soft' }), rect(20, 190, 140, 140, { rx: 4, f: 'none', w: 1 })],
    fill: 'none',
  },
  { id: 'parking', hollow: true, name: { de: 'Stellplatz', en: 'Parking space' }, words: ['parkplatz', 'garage', 'stellplatz'], vw: 250, vh: 500, w: 250, h: 500, elements: [rect(0, 0, 250, 500, { f: 'none', w: 1.5, dash: true })], text: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, fill: 'none' },
  {
    id: 'tree', name: { de: 'Baum', en: 'Tree' }, words: ['baum', 'garten', 'garden', 'strauch'], vw: 200, vh: 200, w: 200, h: 200, keep: true, quiet: true,
    elements: [path('M100 4C122 4 132 18 140 22C160 20 180 36 178 60C196 72 198 98 186 112C196 132 186 160 162 166C154 188 128 198 108 190C88 200 60 192 50 172C26 172 8 150 14 128C0 112 2 86 20 74C16 48 36 26 60 28C70 12 82 4 100 4Z'), circle(100, 100, 8, { f: 'line', s: 'none' })],
    fill: '#4ade80',
  },
  { id: 'north', name: { de: 'Nordpfeil', en: 'North arrow' }, words: ['norden', 'north', 'kompass', 'himmelsrichtung'], vw: 60, vh: 80, w: 60, h: 80, keep: true, quiet: true, elements: [circle(30, 50, 28, { f: 'none', w: 1.2 }), path('M30 0L42 60L30 52L18 60Z', { f: 'line', s: 'line', w: 1 })], fill: 'none' },
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
  { id: 'sticky', name: { de: 'Haftnotiz', en: 'Sticky note' }, words: ['notiz', 'zettel', 'post-it', 'note'], vw: 100, vh: 100, keep: true, elements: [path('M0 0H100V76L76 100H0Z'), path('M76 100V82Q76 76 82 76H100Z', { f: 'soft' })], outline: outline(100, 100, [[0, 0], [100, 0], [100, 76], [76, 100], [0, 100]]), text: { x: 0.08, y: 0.08, w: 0.84, h: 0.68 }, fill: '#fde68a' },
  {
    id: 'checklist', name: { de: 'Checkliste', en: 'Checklist' }, words: ['liste', 'todo', 'aufgaben', 'list'], vw: 60, vh: 72, keep: true,
    elements: [rect(0, 0, 60, 72, { rx: 6 }), ...[0, 1, 2].flatMap((i) => [rect(10, 14 + i * 18, 10, 10, { rx: 2, f: 'paper', w: 1.2 }), mark(`M28 ${19 + i * 18}H50`, 2)]), stroke('M11.5 18.5L14.5 22L20.5 13.5', 2)],
    text: below, fill: LIGHT,
  },
  { id: 'priority-high', name: { de: 'Hohe Priorität', en: 'High priority' }, words: ['prioritaet', 'wichtig', 'dringend', 'urgent', 'hoch'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), path('M30 46V16M18 27L30 15L42 27', { f: 'none', s: 'paper', w: 4.5 })], text: below, fill: '#f87171' },
  { id: 'priority-low', name: { de: 'Niedrige Priorität', en: 'Low priority' }, words: ['prioritaet', 'unwichtig', 'spaeter', 'niedrig'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), path('M30 14V44M18 33L30 45L42 33', { f: 'none', s: 'paper', w: 4.5 })], text: below, fill: '#93c5fd' },
  { id: 'blocked', name: { de: 'Blockiert', en: 'Blocked' }, words: ['blockiert', 'stopp', 'wartet', 'hindernis', 'blocker'], vw: 60, vh: 60, keep: true, elements: [path('M17.6 0H42.4L60 17.6V42.4L42.4 60H17.6L0 42.4V17.6Z'), path('M16 30H44', { f: 'none', s: 'paper', w: 6 })], text: below, fill: '#f87171' },
  { id: 'in-progress', name: { de: 'In Arbeit', en: 'In progress' }, words: ['laeuft', 'halb', 'fortschritt', 'progress', 'begonnen'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 29, { f: 'paper', w: 2.5 }), path('M30 6A24 24 0 0 1 30 54Z', { s: 'none' })], text: below, fill: BLUE },
  { id: 'question', name: { de: 'Offene Frage', en: 'Open question' }, words: ['frage', 'unklar', 'question', 'klaeren'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), path('M21 22C21 13 39 12 39 22C39 30 30 30 30 37', { f: 'none', s: 'paper', w: 4.5 }), circle(30, 46, 3.5, { f: 'paper', s: 'none' })], text: below, fill: '#a78bfa' },
  { id: 'budget', name: { de: 'Budget', en: 'Budget' }, words: ['geld', 'muenzen', 'kosten', 'money', 'coins', 'finanzen'], vw: 60, vh: 60, keep: true, elements: [40, 28, 16].flatMap((y) => [path(`M4 ${y}V${y + 8}A26 8 0 0 0 56 ${y + 8}V${y}`), ellipse(30, y, 26, 8)]), text: below, fill: '#fbbf24' },
  { id: 'chart', name: { de: 'Kennzahl', en: 'Metric' }, words: ['diagramm', 'chart', 'balken', 'kpi', 'auswertung'], vw: 60, vh: 60, keep: true, elements: [rect(0, 0, 60, 60, { rx: 6, f: 'paper' }), rect(10, 34, 10, 16, { rx: 1 }), rect(25, 22, 10, 28, { rx: 1 }), rect(40, 12, 10, 38, { rx: 1 })], text: below, fill: BLUE },
  {
    id: 'rocket', name: { de: 'Start', en: 'Launch' }, words: ['rakete', 'rocket', 'launch', 'go-live', 'veroeffentlichung'], vw: 50, vh: 72, keep: true,
    elements: [path('M17 52L25 72L33 52Z', { f: 'soft' }), path('M10 34L0 54L12 50Z'), path('M40 34L50 54L38 50Z'), path('M25 0C38 10 42 26 40 52H10C8 26 12 10 25 0Z'), circle(25, 24, 6, { f: 'paper' })],
    text: below, fill: LIGHT,
  },
  {
    id: 'trophy', name: { de: 'Erfolg', en: 'Success' }, words: ['pokal', 'trophy', 'gewonnen', 'erreicht', 'win'], vw: 60, vh: 64, keep: true,
    elements: [stroke('M14 6H4V12C4 20 10 24 15 24M46 6H56V12C56 20 50 24 45 24', 3), path('M14 0H46V18C46 30 39 38 30 38C21 38 14 30 14 18Z'), rect(26, 38, 8, 12, { f: 'line', s: 'none' }), rect(16, 50, 28, 10, { rx: 2 })],
    text: below, fill: '#fbbf24',
  },
  {
    id: 'hourglass', name: { de: 'Wartet', en: 'Waiting' }, words: ['sanduhr', 'hourglass', 'warten', 'zeit', 'pause'], vw: 44, vh: 64, keep: true,
    elements: [path('M5 6H39C39 22 26 26 26 32C26 38 39 42 39 58H5C5 42 18 38 18 32C18 26 5 22 5 6Z', { f: 'paper' }), path('M11 15H33C31 21 26 23 22 27C18 23 13 21 11 15Z', { s: 'none' }), path('M10 54C12 47 19 45 22 41C25 45 32 47 34 54Z', { s: 'none' }), rect(0, 0, 44, 6, { rx: 2, f: 'line', s: 'none' }), rect(0, 58, 44, 6, { rx: 2, f: 'line', s: 'none' })],
    text: below, fill: '#fbbf24',
  },
  { id: 'sprint', name: { de: 'Sprint', en: 'Sprint' }, words: ['iteration', 'zyklus', 'scrum', 'kreislauf', 'cycle'], vw: 64, vh: 64, keep: true, elements: [stroke('M53.3 19.5A24 24 0 1 0 54.5 40.2', 5), path('M57 29L62 44L47 41Z', { f: 'line', s: 'line', w: 1 })], text: below, fill: 'none' },
  { id: 'dependency', name: { de: 'Abhängigkeit', en: 'Dependency' }, words: ['kette', 'chain', 'verknuepfung', 'link', 'abhaengig'], vw: 64, vh: 40, keep: true, elements: [rect(2, 10, 36, 20, { rx: 10, f: 'none', w: 4 }), rect(26, 10, 36, 20, { rx: 10, f: 'none', w: 4 })], text: below, fill: 'none' },
  {
    id: 'stakeholder', name: { de: 'Beteiligte', en: 'Stakeholders' }, words: ['stakeholder', 'kunde', 'customer', 'gruppe'], vw: 90, vh: 60, keep: true,
    elements: [...person(50, 6, 0.9), ...person(4, 6, 0.9), ...person(25, 0, 1)], text: below, fill: '#a78bfa',
  },
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
  {
    id: 'container', name: { de: 'Container', en: 'Container' }, words: ['docker', 'podman', 'kubernetes', 'pod'], vw: 80, vh: 60, keep: true,
    elements: [rect(0, 30, 80, 30, { rx: 3 }), rect(4, 0, 34, 28, { rx: 3 }), rect(42, 0, 34, 28, { rx: 3 }), stroke('M12 6V22M21 6V22M30 6V22M50 6V22M59 6V22M68 6V22M10 36V54M20 36V54M30 36V54M40 36V54M50 36V54M60 36V54M70 36V54', 1)],
    text: beside, fill: BLUE,
  },
  { id: 'vm', name: { de: 'Virtuelle Maschine', en: 'Virtual machine' }, words: ['vm', 'virtuell', 'proxmox', 'hypervisor', 'gast'], vw: 80, vh: 64, keep: true, elements: [rect(0, 0, 80, 64, { rx: 6, f: 'soft', dash: true, w: 1.5 }), rect(12, 12, 56, 40, { rx: 4 }), stroke('M22 24H58M22 32H58M22 40H44', 1.5)], text: beside, fill: BLUE },
  { id: 'ups', name: { de: 'USV', en: 'UPS' }, words: ['usv', 'ups', 'notstrom', 'batterie', 'strom'], vw: 50, vh: 80, keep: true, elements: [rect(0, 0, 50, 80, { rx: 5 }), path('M29 14L16 40H26L22 62L36 33H26Z', { f: 'paper', s: 'none' })], text: beside, fill: BLUE },
  {
    id: 'vpn', name: { de: 'VPN', en: 'VPN' }, words: ['vpn', 'tunnel', 'wireguard', 'sicher', 'netbird', 'tailscale'], vw: 60, vh: 70, keep: true,
    elements: [path('M30 0L60 10V34C60 52 46 64 30 70C14 64 0 52 0 34V10Z'), stroke('M23 32V25A7 7 0 0 1 37 25V32', 2.5), rect(19, 31, 22, 18, { rx: 3, f: 'paper' })], text: beside, fill: '#4ade80',
  },
  { id: 'smart-home', name: { de: 'Smart Home', en: 'Smart home' }, words: ['haus', 'iot', 'home assistant', 'automatisierung'], vw: 70, vh: 66, keep: true, elements: [path('M35 0L70 28H62V66H8V28H0Z'), stroke('M25 46A14 14 0 0 1 45 46M19 39A22 22 0 0 1 51 39', 2.5), circle(35, 54, 3, { f: 'line', s: 'none' })], text: beside, fill: BLUE },
  { id: 'sensor', name: { de: 'Sensor', en: 'Sensor' }, words: ['iot', 'fuehler', 'messung', 'zigbee'], vw: 60, vh: 50, keep: true, elements: [circle(30, 25, 12), stroke('M14 13A20 20 0 0 0 14 37M46 13A20 20 0 0 1 46 37M8 5A30 30 0 0 0 8 45M52 5A30 30 0 0 1 52 45', 2)], text: beside, fill: BLUE },
  { id: 'tv', name: { de: 'Fernseher', en: 'TV' }, words: ['fernseher', 'tv', 'mediaplayer', 'bildschirm'], vw: 90, vh: 64, keep: true, elements: [rect(0, 0, 90, 54, { rx: 4 }), rect(5, 5, 80, 44, { rx: 2, f: 'paper', w: 1 }), stroke('M30 63L36 54M60 63L54 54', 2.5)], text: beside, fill: BLUE },
  { id: 'speaker', name: { de: 'Lautsprecher', en: 'Speaker' }, words: ['lautsprecher', 'sonos', 'audio', 'musik', 'smart speaker'], vw: 44, vh: 64, keep: true, elements: [rect(0, 0, 44, 64, { rx: 14 }), circle(22, 40, 12, { f: 'paper' }), circle(22, 40, 4, { f: 'line', s: 'none' }), circle(22, 14, 4, { f: 'paper' })], text: beside, fill: BLUE },
  {
    id: 'voip', name: { de: 'Telefon', en: 'Desk phone' }, words: ['telefon', 'voip', 'sip', 'festnetz'], vw: 80, vh: 60, keep: true,
    elements: [path('M0 20Q0 10 10 10H70Q80 10 80 20V54Q80 60 74 60H6Q0 60 0 54Z'), path('M6 10C6 0 74 0 74 10V18H58V12H22V18H6Z', { f: 'soft' }), ...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => circle(28 + c * 12, 30 + r * 9, 2.5, { f: 'paper', s: 'none' })))],
    text: beside, fill: BLUE,
  },
  { id: 'user', name: { de: 'Nutzer', en: 'User' }, words: ['person', 'mensch', 'client', 'benutzer'], vw: 40, vh: 60, keep: true, elements: person(0, 0, 1), text: beside, fill: BLUE },
  { id: 'mail', name: { de: 'Mailserver', en: 'Mail server' }, words: ['mail', 'smtp', 'imap', 'e-mail', 'brief'], vw: 76, vh: 52, keep: true, elements: [rect(0, 0, 76, 52, { rx: 4 }), mark('M2 4L38 30L74 4', 2)], text: beside, fill: LIGHT },
  { id: 'globe', name: { de: 'Website', en: 'Website' }, words: ['web', 'www', 'dns', 'domain', 'globus', 'internet'], vw: 60, vh: 60, keep: true, elements: [circle(30, 30, 30), mark('M0 30H60M30 0C16 14 16 46 30 60M30 0C44 14 44 46 30 60M5 15H55M5 45H55', 1.4)], text: beside, fill: LIGHT },
  { id: 'disk', name: { de: 'Festplatte', en: 'Hard disk' }, words: ['hdd', 'ssd', 'platte', 'laufwerk', 'speicher'], vw: 70, vh: 50, keep: true, elements: [rect(0, 0, 70, 50, { rx: 5 }), circle(28, 25, 16, { f: 'paper' }), circle(28, 25, 3, { f: 'line', s: 'none' }), stroke('M58 40L52 14', 2.5)], text: beside, fill: BLUE },
  {
    id: 'cell-tower', name: { de: 'Mobilfunk', en: 'Cell tower' }, words: ['mobilfunk', 'lte', '5g', 'mast', 'antenne'], vw: 60, vh: 80, keep: true,
    elements: [stroke('M30 20L14 80M30 20L46 80M20 56H40M17 68H43M24 40H36', 2.5), circle(30, 16, 5, { f: 'line', s: 'none' }), stroke('M18 6A16 16 0 0 0 18 26M42 6A16 16 0 0 1 42 26M10 0A24 24 0 0 0 10 32M50 0A24 24 0 0 1 50 32', 2)],
    text: beside, fill: 'none',
  },
  { id: 'certificate', name: { de: 'Zertifikat', en: 'Certificate' }, words: ['schluessel', 'key', 'tls', 'ssl', 'zertifikat'], vw: 70, vh: 40, keep: true, elements: [path('M36 15H70V25H64V33H56V25H36Z'), circle(20, 20, 18), circle(20, 20, 6, { f: 'paper' })], text: beside, fill: '#fbbf24' },
  { id: 'reverse-proxy', name: { de: 'Reverse Proxy', en: 'Reverse proxy' }, words: ['proxy', 'nginx', 'traefik', 'caddy', 'vorschalt'], vw: 90, vh: 50, keep: true, elements: [rect(0, 0, 90, 50, { rx: 8 }), stroke('M14 25H44M36 17L44 25L36 33M76 15H54M62 9L54 15L62 21M76 35H54M62 29L54 35L62 41', 2)], text: beside, fill: BLUE },
]

export const BUILTIN: ShapePackage[] = [
  { ...META, id: 'basic', name: { de: 'Grundformen', en: 'Basic shapes' }, shapes: basic },
  { ...META, id: 'flow', name: { de: 'Ablaufdiagramm', en: 'Flowchart' }, shapes: flow },
  { ...META, id: 'room', name: { de: 'Raumplan', en: 'Floor plan' }, shapes: room },
  { ...META, id: 'project', name: { de: 'Projektmanagement', en: 'Project management' }, shapes: project },
  { ...META, id: 'network', name: { de: 'Netzwerk', en: 'Network' }, shapes: net },
  { ...META, id: 'uml', name: { de: 'UML und Software', en: 'UML and software' }, shapes: uml },
  { ...META, id: 'bpmn', name: { de: 'BPMN', en: 'BPMN' }, shapes: bpmn },
  { ...META, id: 'house', name: { de: 'Haus und Elektro', en: 'House and electrics' }, shapes: house },
  { ...META, id: 'signs', name: { de: 'Symbole und Pfeile', en: 'Signs and arrows' }, shapes: signs },
]
