/** UML and software: classes, use cases, states, sequences, deployment, tables and screens, drawn for nexcanvas. */
import { BELOW, circle, ellipse, gearPath, LIGHT, line, mark, outline, path, rect, stroke } from './draw'
import type { ShapeDef } from './types'

const PALE = '#fef3c7'

export const uml: ShapeDef[] = [
  {
    id: 'class', name: { de: 'Klasse', en: 'Class' }, words: ['uml', 'objekt', 'object', 'attribute', 'methoden', 'methods'], vw: 160, vh: 120,
    elements: [rect(0, 0, 160, 120, { rx: 2 }), mark('M0 30H160M0 75H160', 1.5)], text: { x: 0.03, y: 0, w: 0.94, h: 0.25 }, fill: PALE,
  },
  {
    id: 'interface', name: { de: 'Schnittstelle', en: 'Interface' }, words: ['uml', 'interface', 'abstrakt', 'abstract'], vw: 160, vh: 100,
    elements: [rect(0, 0, 160, 100, { rx: 2 }), rect(0, 0, 160, 30, { rx: 2, f: 'soft', s: 'none' }), mark('M0 30H160', 1.5)], text: { x: 0.03, y: 0, w: 0.94, h: 0.3 }, fill: LIGHT,
  },
  { id: 'lollipop', name: { de: 'Angebotene Schnittstelle', en: 'Provided interface' }, words: ['lollipop', 'interface', 'port'], vw: 64, vh: 30, elements: [line(0, 15, 40, 15, 2), circle(51, 15, 12)], text: BELOW, fill: LIGHT },
  { id: 'socket', name: { de: 'Benötigte Schnittstelle', en: 'Required interface' }, words: ['socket', 'interface', 'port'], vw: 64, vh: 30, elements: [line(0, 15, 40, 15, 2), stroke('M58 2A13 13 0 0 0 58 28', 2)], text: BELOW, fill: 'none' },
  { id: 'note', name: { de: 'Notiz', en: 'Note' }, words: ['kommentar', 'comment', 'anmerkung'], vw: 150, vh: 90, elements: [path('M0 0H130L150 20V90H0Z'), mark('M130 0V20H150', 1.5)], text: { x: 0.05, y: 0.1, w: 0.88, h: 0.85 }, fill: '#fef9c3' },
  { id: 'package', name: { de: 'Paket', en: 'Package' }, words: ['namespace', 'modul', 'module', 'ordner'], vw: 160, vh: 110, elements: [rect(0, 0, 60, 18, { rx: 2 }), rect(0, 16, 160, 94, { rx: 2 })], text: { x: 0.04, y: 0.2, w: 0.92, h: 0.75 }, fill: LIGHT },
  {
    id: 'component', name: { de: 'Komponente', en: 'Component' }, words: ['baustein', 'modul', 'service', 'dienst'], vw: 160, vh: 90,
    elements: [rect(0, 0, 160, 90, { rx: 2 }), rect(128, 10, 22, 26, { f: 'fill', s: 'ink', w: 1.2 }), rect(122, 15, 12, 6, { f: 'fill', s: 'ink', w: 1.2 }), rect(122, 25, 12, 6, { f: 'fill', s: 'ink', w: 1.2 })],
    text: { x: 0.04, y: 0.15, w: 0.72, h: 0.75 }, fill: LIGHT,
  },
  {
    id: 'node', name: { de: 'Knoten', en: 'Node' }, words: ['deployment', 'server', 'rechner', 'host', 'verteilung'], vw: 160, vh: 120,
    elements: [path('M0 16L16 0H160V104L144 120H0Z'), mark('M0 16H144V120M144 16L160 0', 1.5)], outline: outline(160, 120, [[0, 16], [16, 0], [160, 0], [160, 104], [144, 120], [0, 120]]),
    text: { x: 0.03, y: 0.18, w: 0.85, h: 0.78 }, fill: LIGHT,
  },
  { id: 'artifact', name: { de: 'Artefakt', en: 'Artifact' }, words: ['datei', 'file', 'jar', 'build'], vw: 64, vh: 80, keep: true, elements: [path('M0 0H48L64 16V80H0Z'), stroke('M48 0V16H64', 1.5)], text: BELOW, fill: 'none' },
  {
    id: 'actor', name: { de: 'Akteur', en: 'Actor' }, words: ['person', 'nutzer', 'user', 'rolle', 'strichmann', 'stick figure'], vw: 40, vh: 66, keep: true,
    elements: [circle(20, 10, 9, { f: 'paper' }), stroke('M20 19V44M4 28H36M20 44L6 64M20 44L34 64', 2.2)], text: BELOW, fill: 'none',
  },
  { id: 'use-case', name: { de: 'Anwendungsfall', en: 'Use case' }, words: ['usecase', 'ellipse', 'funktion'], vw: 160, vh: 70, elements: [ellipse(80, 35, 80, 35)], text: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }, fill: LIGHT },
  { id: 'system', hollow: true, name: { de: 'Systemgrenze', en: 'System boundary' }, words: ['system', 'grenze', 'boundary', 'rahmen'], vw: 300, vh: 400, elements: [rect(0, 0, 300, 400, { f: 'none', w: 1.5 })], text: { x: 0.04, y: 0.01, w: 0.92, h: 0.1 }, fill: 'none' },
  { id: 'state', name: { de: 'Zustand', en: 'State' }, words: ['status', 'zustandsdiagramm', 'state machine'], vw: 140, vh: 64, elements: [rect(0, 0, 140, 64, { rx: 18 })], text: { x: 0.08, y: 0, w: 0.84, h: 1 }, fill: LIGHT },
  { id: 'action', name: { de: 'Aktion', en: 'Action' }, words: ['aktivitaet', 'activity', 'schritt'], vw: 140, vh: 64, elements: [rect(0, 0, 140, 64, { rx: 12 })], text: { x: 0.06, y: 0, w: 0.88, h: 1 }, fill: '#c7d2fe' },
  { id: 'initial', name: { de: 'Startknoten', en: 'Initial node' }, words: ['start', 'anfang', 'initial'], vw: 30, vh: 30, keep: true, quiet: true, elements: [circle(15, 15, 15, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'final', name: { de: 'Endknoten', en: 'Final node' }, words: ['ende', 'end', 'final'], vw: 32, vh: 32, keep: true, quiet: true, elements: [circle(16, 16, 15, { f: 'paper' }), circle(16, 16, 9, { f: 'line', s: 'none' })], fill: 'none' },
  { id: 'fork', name: { de: 'Gabelung', en: 'Fork and join' }, words: ['fork', 'join', 'parallel', 'balken'], vw: 160, vh: 8, quiet: true, elements: [rect(0, 0, 160, 8, { rx: 2, f: 'line', s: 'none' })], fill: 'none' },
  { id: 'choice', name: { de: 'Verzweigung', en: 'Decision node' }, words: ['entscheidung', 'decision', 'merge', 'raute'], vw: 40, vh: 40, keep: true, elements: [path('M20 0L40 20L20 40L0 20Z')], outline: outline(40, 40, [[20, 0], [40, 20], [20, 40], [0, 20]]), text: BELOW, fill: 'none' },
  { id: 'send-signal', name: { de: 'Signal senden', en: 'Send signal' }, words: ['signal', 'senden', 'send'], vw: 140, vh: 60, elements: [path('M0 0H110L140 30L110 60H0Z')], outline: outline(140, 60, [[0, 0], [110, 0], [140, 30], [110, 60], [0, 60]]), text: { x: 0.04, y: 0, w: 0.74, h: 1 }, fill: LIGHT },
  { id: 'receive-signal', name: { de: 'Signal empfangen', en: 'Receive signal' }, words: ['signal', 'empfangen', 'accept'], vw: 140, vh: 60, elements: [path('M0 0H140V60H0L30 30Z')], outline: outline(140, 60, [[0, 0], [140, 0], [140, 60], [0, 60], [30, 30]]), text: { x: 0.24, y: 0, w: 0.72, h: 1 }, fill: LIGHT },
  {
    id: 'lifeline', name: { de: 'Lebenslinie', en: 'Lifeline' }, words: ['sequenz', 'sequence', 'objekt', 'teilnehmer'], vw: 120, vh: 300,
    elements: [rect(0, 0, 120, 40, { rx: 2 }), stroke('M60 40V300', 1.5, true)], text: { x: 0.04, y: 0, w: 0.92, h: 40 / 300 }, fill: LIGHT,
  },
  { id: 'activation', name: { de: 'Aktivierung', en: 'Activation' }, words: ['sequenz', 'sequence', 'balken'], vw: 16, vh: 120, quiet: true, elements: [rect(0, 0, 16, 120)], fill: LIGHT },
  {
    id: 'table', name: { de: 'Tabelle', en: 'Table' }, words: ['entitaet', 'entity', 'er', 'datenbank', 'database', 'sql'], vw: 160, vh: 140,
    elements: [rect(0, 0, 160, 140, { rx: 4 }), rect(0, 0, 160, 30, { rx: 4, f: 'soft', s: 'none' }), mark('M0 30H160', 1.5), mark('M0 58H160M0 86H160M0 114H160', 0.8)],
    text: { x: 0.04, y: 0, w: 0.92, h: 30 / 140 }, fill: PALE,
  },
  { id: 'relationship', name: { de: 'Beziehung', en: 'Relationship' }, words: ['er', 'relation', 'raute'], vw: 140, vh: 80, elements: [path('M70 0L140 40L70 80L0 40Z')], outline: outline(140, 80, [[70, 0], [140, 40], [70, 80], [0, 40]]), text: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fill: PALE },
  { id: 'attribute', name: { de: 'Attribut', en: 'Attribute' }, words: ['er', 'eigenschaft', 'feld', 'field'], vw: 120, vh: 50, elements: [ellipse(60, 25, 60, 25)], text: { x: 0.12, y: 0.1, w: 0.76, h: 0.8 }, fill: PALE },
  {
    id: 'queue', name: { de: 'Warteschlange', en: 'Queue' }, words: ['queue', 'kafka', 'nachrichten', 'messages', 'topic'], vw: 140, vh: 60,
    elements: [path('M14 0H126A14 30 0 0 1 126 60H14A14 30 0 0 1 14 0Z'), ellipse(126, 30, 14, 30), mark('M40 0V60M64 0V60M88 0V60', 1)], text: { x: 0.04, y: 0.05, w: 0.78, h: 0.9 }, fill: LIGHT,
  },
  {
    id: 'service', name: { de: 'Dienst', en: 'Service' }, words: ['zahnrad', 'gear', 'prozess', 'daemon', 'microservice'], vw: 64, vh: 64, keep: true,
    elements: [path(gearPath(9, 32, 32, 32, 25)), circle(32, 32, 10, { f: 'paper' })], text: BELOW, fill: LIGHT,
  },
  {
    id: 'browser', name: { de: 'Browserfenster', en: 'Browser window' }, words: ['web', 'seite', 'page', 'wireframe', 'fenster'], vw: 160, vh: 110,
    elements: [rect(0, 0, 160, 110, { rx: 6 }), rect(0, 0, 160, 22, { rx: 6, f: 'soft', s: 'none' }), line(0, 22, 160, 22, 1.2), ...[12, 24, 36].map((x) => circle(x, 11, 3.5, { f: 'line', s: 'none' })), rect(48, 6, 100, 10, { rx: 5, f: 'paper', w: 1 })],
    text: { x: 0.05, y: 0.25, w: 0.9, h: 0.7 }, fill: 'none',
  },
  {
    id: 'app-screen', name: { de: 'App-Bildschirm', en: 'App screen' }, words: ['handy', 'mobile', 'wireframe', 'smartphone'], vw: 80, vh: 160,
    elements: [rect(0, 0, 80, 160, { rx: 12 }), rect(6, 16, 68, 128, { rx: 2, f: 'paper', w: 1 }), mark('M30 8H50', 2)], text: { x: 0.1, y: 0.12, w: 0.8, h: 0.76 }, fill: LIGHT,
  },
  {
    id: 'code', name: { de: 'Code', en: 'Code' }, words: ['quelltext', 'source', 'programm', 'script'], vw: 120, vh: 80,
    elements: [rect(0, 0, 120, 80, { rx: 6 }), mark('M36 26L22 40L36 54M84 26L98 40L84 54M68 20L52 60', 2.5)], text: BELOW, fill: LIGHT,
  },
  {
    id: 'terminal', name: { de: 'Konsole', en: 'Terminal' }, words: ['shell', 'cli', 'kommandozeile', 'bash'], vw: 120, vh: 80,
    elements: [rect(0, 0, 120, 80, { rx: 6 }), rect(0, 0, 120, 16, { rx: 6, f: 'soft', s: 'none' }), line(0, 16, 120, 16, 1.2), stroke('M18 32L30 44L18 56M38 58H62', 2.5)], text: BELOW, fill: 'none',
  },
  {
    id: 'api', name: { de: 'API', en: 'API' }, words: ['schnittstelle', 'rest', 'endpoint', 'http'], vw: 80, vh: 70, keep: true,
    elements: [path('M20 0H60L80 35L60 70H20L0 35Z'), mark('M24 44L30 26L36 44M26 38H34M42 44V26H48Q54 26 54 32Q54 38 48 38H42M60 26V44', 1.8)], outline: outline(80, 70, [[20, 0], [60, 0], [80, 35], [60, 70], [20, 70], [0, 35]]), text: BELOW, fill: LIGHT,
  },
]
