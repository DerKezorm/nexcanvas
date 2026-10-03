/** Signs and arrows: block arrows in every direction, marks, status signs, stars, markers, ribbons and brackets. */
import { BELOW, BLUE, circle, LIGHT, mark, outline, path, rect, starPoints, stroke, through } from './draw'
import type { ShapeDef, ShapeElement } from './types'

const ARROW = BLUE
const GREEN = '#4ade80'
const RED = '#f87171'
const YELLOW = '#fde047'
const ORANGE = '#fb923c'

/** A sign of fixed proportions, quiet unless it has words below. */
const sign = (id: string, de: string, en: string, vw: number, vh: number, elements: ShapeElement[], words: string[], fill: string, below = true): ShapeDef => ({
  id,
  name: { de, en },
  words,
  vw,
  vh,
  keep: true,
  elements,
  ...(below ? { text: BELOW } : { quiet: true }),
  fill,
})

/** A block arrow from points, with its outline for lines to meet. */
const arrow = (id: string, de: string, en: string, vw: number, vh: number, points: [number, number][], text: ShapeDef['text'], words: string[] = []): ShapeDef => ({
  id,
  name: { de, en },
  words: ['pfeil', 'arrow', ...words],
  vw,
  vh,
  elements: [path(through(points))],
  outline: outline(vw, vh, points),
  text,
  fill: ARROW,
})

const onPaper = (d: string, w: number): ShapeElement => path(d, { f: 'none', s: 'paper', w })

export const signs: ShapeDef[] = [
  arrow('arrow-right', 'Pfeil nach rechts', 'Arrow right', 110, 70, [[0, 20], [70, 20], [70, 0], [110, 35], [70, 70], [70, 50], [0, 50]], { x: 0.02, y: 0.29, w: 0.62, h: 0.42 }, ['rechts', 'right', 'weiter']),
  arrow('arrow-left', 'Pfeil nach links', 'Arrow left', 110, 70, [[110, 20], [40, 20], [40, 0], [0, 35], [40, 70], [40, 50], [110, 50]], { x: 0.36, y: 0.29, w: 0.62, h: 0.42 }, ['links', 'left', 'zurueck']),
  arrow('arrow-up', 'Pfeil nach oben', 'Arrow up', 70, 110, [[20, 110], [20, 40], [0, 40], [35, 0], [70, 40], [50, 40], [50, 110]], { x: 0.29, y: 0.38, w: 0.42, h: 0.6 }, ['oben', 'up', 'hoch']),
  arrow('arrow-down', 'Pfeil nach unten', 'Arrow down', 70, 110, [[20, 0], [20, 70], [0, 70], [35, 110], [70, 70], [50, 70], [50, 0]], { x: 0.29, y: 0.02, w: 0.42, h: 0.6 }, ['unten', 'down', 'runter']),
  arrow('arrow-up-down', 'Pfeil hoch und runter', 'Arrow up and down', 70, 110, [[35, 0], [70, 35], [50, 35], [50, 75], [70, 75], [35, 110], [0, 75], [20, 75], [20, 35], [0, 35]], { x: 0.29, y: 0.32, w: 0.42, h: 0.36 }, ['beide', 'both', 'vertikal']),
  arrow('arrow-four', 'Pfeil in vier Richtungen', 'Four-way arrow', 100, 100, [[50, 0], [70, 20], [58, 20], [58, 42], [80, 42], [80, 30], [100, 50], [80, 70], [80, 58], [58, 58], [58, 80], [70, 80], [50, 100], [30, 80], [42, 80], [42, 58], [20, 58], [20, 70], [0, 50], [20, 30], [20, 42], [42, 42], [42, 20], [30, 20]], { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, ['kreuz', 'bewegen', 'move', 'alle richtungen']),
  arrow('arrow-notched', 'Kerbpfeil', 'Notched arrow', 110, 70, [[0, 20], [70, 20], [70, 0], [110, 35], [70, 70], [70, 50], [0, 50], [14, 35]], { x: 0.14, y: 0.29, w: 0.5, h: 0.42 }, ['kerbe', 'notched']),
  arrow('arrow-pentagon', 'Fünfeckpfeil', 'Pentagon arrow', 120, 70, [[0, 0], [90, 0], [120, 35], [90, 70], [0, 70]], { x: 0.04, y: 0, w: 0.72, h: 1 }, ['phase', 'schritt', 'step', 'home plate']),
  arrow('arrow-callout', 'Pfeil mit Feld', 'Arrow callout', 120, 70, [[0, 0], [72, 0], [72, 22], [90, 22], [90, 8], [120, 35], [90, 62], [90, 48], [72, 48], [72, 70], [0, 70]], { x: 0.04, y: 0.05, w: 0.54, h: 0.9 }, ['legende', 'callout', 'hinweis']),
  {
    id: 'arrow-striped', name: { de: 'Streifenpfeil', en: 'Striped arrow' }, words: ['pfeil', 'arrow', 'streifen', 'tempo'], vw: 110, vh: 70,
    elements: [rect(0, 20, 7, 30), rect(12, 20, 9, 30), path(through([[26, 20], [70, 20], [70, 0], [110, 35], [70, 70], [70, 50], [26, 50]]))], text: { x: 0.24, y: 0.29, w: 0.4, h: 0.42 }, fill: ARROW,
  },
  {
    id: 'arrow-curved', name: { de: 'Bogenpfeil', en: 'Curved arrow' }, words: ['pfeil', 'arrow', 'bogen', 'kurve', 'curve'], vw: 110, vh: 72, quiet: true,
    elements: [path('M0 72C0 30 34 10 78 10V0L110 22L78 44V34C48 34 26 48 26 72Z')], fill: ARROW,
  },
  {
    id: 'arrow-u-turn', name: { de: 'Wendepfeil', en: 'U-turn arrow' }, words: ['pfeil', 'arrow', 'wenden', 'zurueck', 'return'], vw: 86, vh: 80, quiet: true,
    elements: [path('M0 80V35A35 35 0 0 1 70 35V50H86L58 80L30 50H46V35A11 11 0 0 0 24 35V80Z')], fill: ARROW,
  },
  {
    id: 'arrow-cycle', name: { de: 'Kreislauf', en: 'Cycle' }, words: ['pfeil', 'arrow', 'kreis', 'wiederholen', 'repeat', 'refresh', 'zyklus'], vw: 64, vh: 64, keep: true,
    elements: [stroke('M53.3 19.5A24 24 0 1 0 54.5 40.2', 6), path('M57 29L62 44L47 41Z', { f: 'line', s: 'line', w: 1 })], text: BELOW, fill: 'none',
  },
  { id: 'chevrons', name: { de: 'Doppelwinkel', en: 'Double chevron' }, words: ['pfeil', 'arrow', 'weiter', 'vor', 'forward'], vw: 94, vh: 70, quiet: true, elements: [path('M0 0H24L54 35L24 70H0L30 35Z'), path('M40 0H64L94 35L64 70H40L70 35Z')], fill: ARROW },
  sign('check', 'Haken', 'Check mark', 88, 70, [path(through([[0, 38], [14, 24], [32, 42], [74, 0], [88, 14], [32, 70]]))], ['ok', 'erledigt', 'done', 'richtig', 'ja', 'yes'], GREEN, false),
  sign('x-mark', 'X-Zeichen', 'X mark', 80, 80, [path(through([[14, 0], [40, 26], [66, 0], [80, 14], [54, 40], [80, 66], [66, 80], [40, 54], [14, 80], [0, 66], [26, 40], [0, 14]]))], ['kreuz', 'falsch', 'wrong', 'nein', 'no', 'loeschen'], RED, false),
  sign('check-circle', 'Haken im Kreis', 'Check in circle', 60, 60, [circle(30, 30, 30), onPaper('M16 31L26 41L45 20', 5)], ['ok', 'erledigt', 'done', 'erfolg', 'success'], GREEN),
  sign('x-circle', 'X im Kreis', 'X in circle', 60, 60, [circle(30, 30, 30), onPaper('M20 20L40 40M40 20L20 40', 5)], ['fehler', 'error', 'falsch', 'abgelehnt'], RED),
  sign('plus-circle', 'Plus im Kreis', 'Plus in circle', 60, 60, [circle(30, 30, 30), onPaper('M30 16V44M16 30H44', 5)], ['plus', 'hinzufuegen', 'add', 'mehr'], GREEN),
  sign('minus-circle', 'Minus im Kreis', 'Minus in circle', 60, 60, [circle(30, 30, 30), onPaper('M16 30H44', 5)], ['minus', 'entfernen', 'remove', 'weniger'], RED),
  sign('warning', 'Warnung', 'Warning', 64, 58, [path('M28 3Q32 -3 36 3L63 51Q66 57 59 57H5Q-2 57 1 51Z'), onPaper('M32 20V38', 5), circle(32, 47, 3.2, { f: 'paper', s: 'none' })], ['achtung', 'warnung', 'warning', 'gefahr', 'vorsicht', 'risiko'], '#fbbf24'),
  sign('info', 'Information', 'Information', 60, 60, [circle(30, 30, 30), circle(30, 17, 3.5, { f: 'paper', s: 'none' }), onPaper('M30 27V46', 5)], ['info', 'hinweis', 'note', 'hilfe'], BLUE),
  sign('exclamation', 'Ausrufezeichen', 'Exclamation', 60, 60, [circle(30, 30, 30), onPaper('M30 14V35', 5), circle(30, 45, 3.5, { f: 'paper', s: 'none' })], ['wichtig', 'important', 'achtung', 'ausrufezeichen'], ORANGE),
  sign('question', 'Fragezeichen', 'Question mark', 60, 60, [circle(30, 30, 30), onPaper('M21 22C21 13 39 12 39 22C39 30 30 30 30 37', 5), circle(30, 46, 3.5, { f: 'paper', s: 'none' })], ['frage', 'question', 'hilfe', 'help', 'unklar'], '#a78bfa'),
  sign('no-entry', 'Einfahrt verboten', 'No entry', 60, 60, [circle(30, 30, 30), rect(11, 24, 38, 12, { f: 'paper', s: 'none' })], ['verboten', 'stopp', 'stop', 'gesperrt', 'blocked'], RED),
  sign('forbidden', 'Verbot', 'Prohibited', 60, 60, [circle(30, 30, 26, { f: 'paper', s: 'fill', w: 6 }), path('M12 12L48 48', { f: 'none', s: 'fill', w: 6 })], ['verboten', 'nicht', 'forbidden', 'no', 'verbot'], RED),
  sign('stop', 'Stopp', 'Stop', 60, 60, [path('M17.6 0H42.4L60 17.6V42.4L42.4 60H17.6L0 42.4V17.6Z'), onPaper('M16 30H44', 6)], ['stopp', 'stop', 'halt', 'achteck'], RED),
  sign('star-four', 'Vierzackstern', 'Four-point star', 60, 60, [path('M30 0L38 22L60 30L38 38L30 60L22 38L0 30L22 22Z')], ['stern', 'star', 'funkeln'], YELLOW),
  sign('sparkle', 'Funkeln', 'Sparkle', 60, 60, [path('M30 0C32 20 40 28 60 30C40 32 32 40 30 60C28 40 20 32 0 30C20 28 28 20 30 0Z')], ['funkeln', 'sparkle', 'neu', 'new', 'glanz'], YELLOW),
  sign('star-six', 'Sechszackstern', 'Six-point star', 60, 60, [path(through(starPoints(6, 30, 30, 30, 17)))], ['stern', 'star'], YELLOW),
  { id: 'burst', name: { de: 'Explosion', en: 'Burst' }, words: ['explosion', 'knall', 'neu', 'new', 'aktion', 'sale', 'stoerer'], vw: 100, vh: 100, keep: true, elements: [path(through(starPoints(12, 50, 50, 50, 34)))], text: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, fill: YELLOW },
  { id: 'seal', name: { de: 'Siegel', en: 'Seal' }, words: ['siegel', 'abzeichen', 'badge', 'qualitaet', 'zertifikat'], vw: 100, vh: 100, keep: true, elements: [path(through(starPoints(20, 50, 50, 50, 44))), circle(50, 50, 36, { f: 'none', s: 'ink', w: 1.2 })], text: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fill: '#fbbf24' },
  { id: 'marker', name: { de: 'Nummer', en: 'Number marker' }, words: ['nummer', 'number', 'zahl', 'schritt', 'step', 'marker'], vw: 48, vh: 48, keep: true, word: '1', elements: [circle(24, 24, 24)], text: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, fill: '#ff8a70' },
  { id: 'marker-letter', name: { de: 'Buchstabe', en: 'Letter marker' }, words: ['buchstabe', 'letter', 'marker', 'kennung'], vw: 48, vh: 48, keep: true, word: 'A', elements: [rect(0, 0, 48, 48, { rx: 9 })], text: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, fill: '#a78bfa' },
  sign('pin', 'Ortsmarke', 'Location pin', 50, 66, [path('M25 0C39 0 50 11 50 25C50 43 25 66 25 66C25 66 0 43 0 25C0 11 11 0 25 0Z'), circle(25, 24, 9, { f: 'paper' })], ['ort', 'pin', 'standort', 'location', 'karte', 'map', 'adresse'], RED),
  sign('bookmark', 'Lesezeichen', 'Bookmark', 40, 60, [path('M0 4Q0 0 4 0H36Q40 0 40 4V60L20 46L0 60Z')], ['lesezeichen', 'bookmark', 'merken'], RED),
  {
    id: 'tag', name: { de: 'Etikett', en: 'Tag' }, words: ['etikett', 'label', 'schild', 'preis', 'price'], vw: 110, vh: 50,
    elements: [path('M0 6Q0 0 6 0H84L110 25L84 50H6Q0 50 0 44Z'), circle(86, 25, 4, { f: 'paper' })], outline: outline(110, 50, [[0, 0], [84, 0], [110, 25], [84, 50], [0, 50]]), text: { x: 0.05, y: 0, w: 0.68, h: 1 }, fill: '#fde68a',
  },
  {
    id: 'ribbon', name: { de: 'Spruchband', en: 'Ribbon' }, words: ['banner', 'band', 'ribbon', 'titel', 'ueberschrift'], vw: 180, vh: 54,
    elements: [path('M0 12H28V54H0L12 33Z', { f: 'soft' }), path('M180 12H152V54H180L168 33Z', { f: 'soft' }), path('M20 44L28 54V44Z', { f: 'line', s: 'none' }), path('M160 44L152 54V44Z', { f: 'line', s: 'none' }), rect(20, 0, 140, 44)],
    text: { x: 0.14, y: 0, w: 0.72, h: 44 / 54 }, fill: RED,
  },
  {
    id: 'speech-round', name: { de: 'Runde Sprechblase', en: 'Round speech bubble' }, words: ['sprechblase', 'sagen', 'speech', 'comic', 'zitat'], vw: 120, vh: 92,
    elements: [path('M60 0C93 0 120 18 120 40C120 62 93 80 60 80C52 80 45 79 38 77L14 92L20 70C7 62 0 52 0 40C0 18 27 0 60 0Z')], text: { x: 0.12, y: 0.1, w: 0.76, h: 0.66 }, fill: LIGHT,
  },
  {
    id: 'thought', name: { de: 'Gedankenblase', en: 'Thought bubble' }, words: ['denken', 'gedanke', 'thought', 'idee', 'comic'], vw: 140, vh: 112,
    elements: [path('M36 82C14 82 2 68 7 54C-1 43 8 25 27 28C31 9 56 3 69 16C81 1 110 6 111 27C131 27 141 45 133 59C141 75 124 88 107 81C97 91 72 92 62 82C53 88 43 87 36 82Z'), circle(30, 96, 7), circle(16, 107, 4)],
    text: { x: 0.18, y: 0.24, w: 0.64, h: 0.45 }, fill: '#e9d5ff',
  },
  sign('lock', 'Schloss', 'Lock', 60, 66, [stroke('M15 28V19A15 15 0 0 1 45 19V28', 6), rect(4, 26, 52, 40, { rx: 6 }), circle(30, 43, 5, { f: 'paper', s: 'none' }), rect(28, 45, 4, 10, { f: 'paper', s: 'none' })], ['schloss', 'lock', 'sicher', 'privat', 'geschuetzt'], '#fbbf24'),
  sign('smile', 'Lächeln', 'Smile', 60, 60, [circle(30, 30, 30), circle(20, 23, 3.5, { f: 'ink', s: 'none' }), circle(40, 23, 3.5, { f: 'ink', s: 'none' }), mark('M17 36Q30 50 43 36', 3)], ['smiley', 'gut', 'happy', 'froh', 'zufrieden'], YELLOW),
  sign('sad', 'Traurig', 'Sad', 60, 60, [circle(30, 30, 30), circle(20, 23, 3.5, { f: 'ink', s: 'none' }), circle(40, 23, 3.5, { f: 'ink', s: 'none' }), mark('M18 45Q30 34 42 45', 3)], ['smiley', 'schlecht', 'sad', 'unzufrieden'], '#93c5fd'),
  sign('thumbs-up', 'Daumen hoch', 'Thumbs up', 60, 60, [rect(2, 26, 14, 32, { rx: 2 }), path('M20 28L30 4C36 4 40 8 38 16L36 24H54C58 24 60 28 59 32L54 52C53 56 50 58 46 58H20Z')], ['daumen', 'gut', 'like', 'ok', 'zustimmung'], BLUE),
  sign('magnifier', 'Lupe', 'Magnifier', 60, 60, [stroke('M38 38L56 56', 8), circle(24, 24, 20, { f: 'fill', w: 4 })], ['suche', 'search', 'lupe', 'pruefen', 'zoom'], LIGHT),
  sign('house', 'Haus', 'House', 60, 56, [path('M30 0L60 26H52V56H8V26H0Z'), rect(24, 36, 12, 20, { f: 'paper' })], ['haus', 'home', 'start', 'zuhause'], BLUE),
  sign('checkbox', 'Kästchen', 'Checkbox', 40, 40, [rect(0, 0, 40, 40, { rx: 6, f: 'paper', w: 2.5 })], ['kaestchen', 'checkbox', 'todo', 'aufgabe', 'offen'], 'none'),
  sign('checkbox-done', 'Kästchen abgehakt', 'Checked box', 40, 40, [rect(0, 0, 40, 40, { rx: 6, w: 2.5 }), mark('M9 21L17 29L31 12', 4)], ['kaestchen', 'checkbox', 'erledigt', 'done', 'haken'], GREEN),
  { id: 'brace', name: { de: 'Geschweifte Klammer', en: 'Curly brace' }, words: ['klammer', 'brace', 'zusammenfassen'], vw: 30, vh: 100, quiet: true, elements: [stroke('M30 0C14 0 18 10 18 30C18 44 14 50 0 50C14 50 18 56 18 70C18 90 14 100 30 100', 2.5)], fill: 'none' },
  { id: 'bracket', name: { de: 'Eckige Klammer', en: 'Bracket' }, words: ['klammer', 'bracket'], vw: 20, vh: 100, quiet: true, elements: [stroke('M20 0H0V100H20', 2.5)], fill: 'none' },
]
