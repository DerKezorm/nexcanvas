/** BPMN 2.0: events, activities, gateways, data and swimlanes, drawn for nexcanvas after the standard's notation. */
import { BELOW, circle, ellipse, gearPath, LIGHT, mark, outline, path, polygonPoints, rect, stroke, through } from './draw'
import type { ShapeDef, ShapeElement } from './types'

const START = '#bbf7d0'
const BETWEEN = '#fef3c7'
const END = '#fecaca'
const GATE = '#fde68a'

/** The rings of an event: thin for a start, double for one in between, thick for an end. */
const ring = (kind: 'start' | 'between' | 'end'): ShapeElement[] =>
  kind === 'start' ? [circle(20, 20, 19)] : kind === 'between' ? [circle(20, 20, 19), circle(20, 20, 15.5, { f: 'none', s: 'ink', w: 1.2 })] : [circle(20, 20, 18, { w: 4 })]

const envelope = (filled: boolean): ShapeElement[] => [
  rect(11, 14, 18, 13, { f: filled ? 'ink' : 'none', s: 'ink', w: 1.2 }),
  path('M11 14L20 21L29 14', { f: 'none', s: filled ? 'fill' : 'ink', w: 1.2 }),
]

const event = (id: string, de: string, en: string, kind: 'start' | 'between' | 'end', inner: ShapeElement[], words: string[] = []): ShapeDef => ({
  id,
  name: { de, en },
  words: ['bpmn', 'ereignis', 'event', ...words],
  vw: 40,
  vh: 40,
  keep: true,
  elements: [...ring(kind), ...inner],
  text: BELOW,
  fill: kind === 'start' ? START : kind === 'between' ? BETWEEN : END,
})

/** A task with a small mark in its upper left corner. */
const task = (id: string, de: string, en: string, mark: ShapeElement[], words: string[] = [], thick = false): ShapeDef => ({
  id,
  name: { de, en },
  words: ['bpmn', 'aufgabe', 'task', 'aktivitaet', 'activity', ...words],
  vw: 140,
  vh: 80,
  elements: [rect(0, 0, 140, 80, { rx: 10, ...(thick ? { w: 4 } : {}) }), ...mark],
  text: mark.length ? { x: 0.05, y: 0.25, w: 0.9, h: 0.7 } : { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  fill: LIGHT,
})

const diamond = 'M25 0L50 25L25 50L0 25Z'
const gateway = (id: string, de: string, en: string, inner: ShapeElement[], words: string[] = []): ShapeDef => ({
  id,
  name: { de, en },
  words: ['bpmn', 'gateway', 'verzweigung', 'raute', ...words],
  vw: 50,
  vh: 50,
  keep: true,
  elements: [path(diamond), ...inner],
  outline: outline(50, 50, [[25, 0], [50, 25], [25, 50], [0, 25]]),
  text: BELOW,
  fill: GATE,
})

export const bpmn: ShapeDef[] = [
  event('start', 'Startereignis', 'Start event', 'start', [], ['start', 'anfang']),
  event('start-message', 'Start durch Nachricht', 'Message start event', 'start', envelope(false), ['nachricht', 'message', 'mail']),
  event('start-timer', 'Start durch Zeit', 'Timer start event', 'start', [circle(20, 20, 11, { f: 'none', s: 'ink', w: 1.2 }), mark('M20 13V20L25 23', 1.5)], ['zeit', 'timer', 'uhr']),
  event('start-signal', 'Start durch Signal', 'Signal start event', 'start', [path('M20 10L29 26H11Z', { f: 'none', s: 'ink', w: 1.5 })], ['signal']),
  event('start-conditional', 'Start durch Bedingung', 'Conditional start event', 'start', [rect(13, 11, 14, 18, { f: 'none', s: 'ink', w: 1.2 }), mark('M16 16H24M16 20H24M16 24H24', 1)], ['bedingung', 'condition']),
  event('intermediate', 'Zwischenereignis', 'Intermediate event', 'between', [], ['zwischen']),
  event('message-catch', 'Nachricht empfangen', 'Message catch event', 'between', envelope(false), ['nachricht', 'message', 'empfangen']),
  event('message-throw', 'Nachricht senden', 'Message throw event', 'between', envelope(true), ['nachricht', 'message', 'senden']),
  event('timer', 'Zeitgeber', 'Timer event', 'between', [circle(20, 20, 11, { f: 'none', s: 'ink', w: 1.2 }), mark('M20 13V20L25 23', 1.5)], ['zeit', 'timer', 'warten', 'uhr']),
  event('signal', 'Signal', 'Signal event', 'between', [path('M20 10L29 26H11Z', { f: 'none', s: 'ink', w: 1.5 })], ['signal']),
  event('escalation', 'Eskalation', 'Escalation event', 'between', [path('M20 9L28 30L20 24L12 30Z', { f: 'none', s: 'ink', w: 1.5 })], ['eskalation', 'escalation']),
  event('link', 'Verknüpfung', 'Link event', 'between', [path('M10 16H21V11L31 20L21 29V24H10Z', { f: 'none', s: 'ink', w: 1.5 })], ['link', 'sprung', 'goto']),
  event('end', 'Endereignis', 'End event', 'end', [], ['ende', 'end']),
  event('end-message', 'Ende mit Nachricht', 'Message end event', 'end', envelope(true), ['nachricht', 'message']),
  event('end-error', 'Ende mit Fehler', 'Error end event', 'end', [path('M12 29L16 12L22 21L28 10L24 28L18 19Z', { f: 'ink', s: 'none' })], ['fehler', 'error']),
  event('end-terminate', 'Terminieren', 'Terminate end event', 'end', [circle(20, 20, 10, { f: 'ink', s: 'none' })], ['terminieren', 'terminate', 'abbruch']),
  task('task', 'Aufgabe', 'Task', []),
  task('user-task', 'Benutzeraufgabe', 'User task', [circle(17, 13, 4.5, { f: 'none', s: 'ink', w: 1.2 }), path('M8 27C8 19 26 19 26 27Z', { f: 'none', s: 'ink', w: 1.2 })], ['benutzer', 'user', 'mensch', 'manuell']),
  task('service-task', 'Serviceaufgabe', 'Service task', [path(gearPath(8, 17, 17, 9, 6.5), { f: 'none', s: 'ink', w: 1.2 }), circle(17, 17, 2.5, { f: 'none', s: 'ink', w: 1.2 })], ['service', 'automatisch', 'automatic', 'system']),
  task('script-task', 'Skriptaufgabe', 'Script task', [path('M10 8H26C22 12 30 20 26 26H10C14 20 6 12 10 8Z', { f: 'none', s: 'ink', w: 1.2 }), mark('M13 13H22M14 17H23M14 21H23', 1)], ['skript', 'script', 'code']),
  task('send-task', 'Sendeaufgabe', 'Send task', [rect(8, 9, 20, 14, { f: 'ink', s: 'ink', w: 1.2 }), path('M8 9L18 17L28 9', { f: 'none', s: 'fill', w: 1.2 })], ['senden', 'send', 'nachricht', 'mail']),
  task('receive-task', 'Empfangsaufgabe', 'Receive task', [rect(8, 9, 20, 14, { f: 'none', s: 'ink', w: 1.2 }), path('M8 9L18 17L28 9', { f: 'none', s: 'ink', w: 1.2 })], ['empfangen', 'receive', 'nachricht']),
  task('manual-task', 'Manuelle Aufgabe', 'Manual task', [path('M8 22V14Q8 10 12 10H26Q28 10 28 12Q28 14 26 14H20M20 14H28Q30 14 30 16Q30 18 28 18H20M20 18H27Q29 18 29 20Q29 22 27 22Z', { f: 'none', s: 'ink', w: 1.1 })], ['manuell', 'manual', 'hand']),
  task('business-rule', 'Geschäftsregel', 'Business rule task', [rect(8, 8, 22, 16, { f: 'none', s: 'ink', w: 1.1 }), rect(8, 8, 22, 5, { f: 'ink', s: 'ink', w: 1.1 }), mark('M8 18H30M15 13V24', 1)], ['regel', 'rule', 'entscheidungstabelle', 'dmn']),
  {
    id: 'subprocess', name: { de: 'Teilprozess', en: 'Subprocess' }, words: ['bpmn', 'teilprozess', 'subprocess', 'unterprozess'], vw: 140, vh: 80,
    elements: [rect(0, 0, 140, 80, { rx: 10 }), rect(62, 62, 16, 16, { f: 'none', s: 'ink', w: 1.2 }), mark('M70 65V75M65 70H75', 1.2)], text: { x: 0.05, y: 0.05, w: 0.9, h: 0.7 }, fill: LIGHT,
  },
  task('call-activity', 'Aufrufaktivität', 'Call activity', [], ['aufruf', 'call', 'global'], true),
  gateway('gateway-exclusive', 'Exklusives Gateway', 'Exclusive gateway', [mark('M17 17L33 33M33 17L17 33', 3.5)], ['xor', 'exklusiv', 'exclusive', 'oder']),
  gateway('gateway-parallel', 'Paralleles Gateway', 'Parallel gateway', [mark('M25 12V38M12 25H38', 3.5)], ['and', 'parallel', 'und']),
  gateway('gateway-inclusive', 'Inklusives Gateway', 'Inclusive gateway', [circle(25, 25, 10, { f: 'none', s: 'ink', w: 3 })], ['or', 'inklusiv', 'inclusive']),
  gateway('gateway-event', 'Ereignisbasiertes Gateway', 'Event-based gateway', [circle(25, 25, 12, { f: 'none', s: 'ink', w: 1.2 }), circle(25, 25, 9.5, { f: 'none', s: 'ink', w: 1.2 }), path(through(polygonPoints(5, 25, 25.5, 6)), { f: 'none', s: 'ink', w: 1.2 })], ['ereignis', 'event']),
  gateway('gateway-complex', 'Komplexes Gateway', 'Complex gateway', [mark('M25 12V38M12 25H38M16 16L34 34M34 16L16 34', 3)], ['komplex', 'complex']),
  {
    id: 'data-object', name: { de: 'Datenobjekt', en: 'Data object' }, words: ['bpmn', 'daten', 'data', 'dokument', 'document'], vw: 46, vh: 60, keep: true,
    elements: [path('M0 0H34L46 12V60H0Z'), stroke('M34 0V12H46', 1.2)], outline: outline(46, 60, [[0, 0], [34, 0], [46, 12], [46, 60], [0, 60]]), text: BELOW, fill: 'none',
  },
  {
    id: 'data-store', name: { de: 'Datenspeicher', en: 'Data store' }, words: ['bpmn', 'datenbank', 'database', 'speicher', 'store'], vw: 60, vh: 60, keep: true,
    elements: [path('M0 10A30 10 0 0 1 60 10V50A30 10 0 0 1 0 50Z'), ellipse(30, 10, 30, 10), stroke('M0 18A30 10 0 0 0 60 18M0 26A30 10 0 0 0 60 26', 1.2)], text: BELOW, fill: 'none',
  },
  { id: 'message', name: { de: 'Nachricht', en: 'Message' }, words: ['bpmn', 'brief', 'mail', 'umschlag', 'envelope'], vw: 50, vh: 34, keep: true, elements: [rect(0, 0, 50, 34, { rx: 2 }), stroke('M0 0L25 18L50 0', 1.5)], text: BELOW, fill: 'none' },
  {
    id: 'pool', hollow: true, name: { de: 'Pool', en: 'Pool' }, words: ['bpmn', 'teilnehmer', 'participant', 'organisation'], vw: 640, vh: 240,
    elements: [rect(0, 0, 640, 240, { f: 'none', w: 2 }), rect(0, 0, 40, 240, { f: 'soft', w: 2 })], text: { x: 0.075, y: 0.01, w: 0.5, h: 0.14 }, fill: 'none',
  },
  { id: 'lane', hollow: true, name: { de: 'Bahn', en: 'Lane' }, words: ['bpmn', 'lane', 'schwimmbahn', 'rolle', 'role'], vw: 600, vh: 120, elements: [rect(0, 0, 600, 120, { f: 'none', w: 1.2 })], text: { x: 0.01, y: 0.02, w: 0.5, h: 0.25 }, fill: 'none' },
  { id: 'group', hollow: true, name: { de: 'Gruppe', en: 'Group' }, words: ['bpmn', 'gruppe', 'kategorie'], vw: 300, vh: 200, elements: [rect(0, 0, 300, 200, { rx: 12, f: 'none', dash: true, w: 1.5 })], text: { x: 0.04, y: 0.02, w: 0.92, h: 0.15 }, fill: 'none' },
  {
    id: 'annotation', hollow: true, name: { de: 'Textanmerkung', en: 'Text annotation' }, words: ['bpmn', 'kommentar', 'comment', 'notiz'], vw: 120, vh: 70,
    elements: [rect(0, 0, 120, 70, { f: 'none', s: 'none' }), stroke('M20 0H0V70H20', 1.5)], text: { x: 0.1, y: 0, w: 0.88, h: 1 }, fill: 'none',
  },
]
