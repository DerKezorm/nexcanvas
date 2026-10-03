/**
 * House and electrics: sockets, switches and lights for an installation plan (the light as the circle with a cross of
 * the plan symbols), heating, energy and the smart home. Small symbols that sit on a floor plan, words below.
 */
import { BELOW, circle, LIGHT, line, mark, path, rect, stroke } from './draw'
import type { ShapeDef, ShapeElement } from './types'

const symbol = (id: string, de: string, en: string, vw: number, vh: number, elements: ShapeElement[], words: string[], fill = 'none'): ShapeDef => ({
  id,
  name: { de, en },
  words,
  vw,
  vh,
  keep: true,
  elements,
  text: BELOW,
  fill,
})

const socketFace = (x: number): ShapeElement[] => [circle(x + 18, 18, 17), circle(x + 11, 18, 2.6, { f: 'line', s: 'none' }), circle(x + 25, 18, 2.6, { f: 'line', s: 'none' }), stroke(`M${x + 18} 2V6M${x + 18} 30V34`, 2.5)]
const bolt = (x: number, y: number, s: number, look: { f: 'paper' | 'ink' } = { f: 'paper' }) =>
  path(`M${x + 9 * s} ${y}L${x} ${y + 13 * s}H${x + 7 * s}L${x + 4 * s} ${y + 24 * s}L${x + 14 * s} ${y + 9 * s}H${x + 7 * s}Z`, { f: look.f, s: 'none' })
const drop = (cx: number, top: number, r: number) => path(`M${cx} ${top}C${cx} ${top} ${cx + r} ${top + r * 1.2} ${cx + r} ${top + r * 1.8}A${r} ${r} 0 0 1 ${cx - r} ${top + r * 1.8}C${cx - r} ${top + r * 1.2} ${cx} ${top} ${cx} ${top}Z`)
const flame = (cx: number, top: number, s: number, onFill = false) =>
  path(`M${cx} ${top}C${cx + 10 * s} ${top + 10 * s} ${cx + 12 * s} ${top + 18 * s} ${cx + 9 * s} ${top + 25 * s}C${cx + 7 * s} ${top + 30 * s} ${cx - 7 * s} ${top + 30 * s} ${cx - 9 * s} ${top + 25 * s}C${cx - 12 * s} ${top + 18 * s} ${cx - 4 * s} ${top + 12 * s} ${cx - 2 * s} ${top + 4 * s}C${cx + 1 * s} ${top + 8 * s} ${cx + 2 * s} ${top + 10 * s} ${cx + 3 * s} ${top + 13 * s}C${cx + 4 * s} ${top + 8 * s} ${cx + 2 * s} ${top + 4 * s} ${cx} ${top}Z`, onFill ? { f: 'soft', s: 'ink' } : {})

export const house: ShapeDef[] = [
  symbol('socket', 'Steckdose', 'Socket', 36, 36, socketFace(0), ['steckdose', 'schuko', 'strom', 'outlet', 'power']),
  symbol('socket-double', 'Doppelsteckdose', 'Double socket', 74, 36, [rect(0, 0, 74, 36, { rx: 6, f: 'soft', s: 'none' }), ...socketFace(0), ...socketFace(38)], ['steckdose', 'doppelt', 'outlet', 'power']),
  symbol('switch', 'Lichtschalter', 'Light switch', 40, 40, [rect(0, 0, 40, 40, { rx: 6 }), rect(12, 8, 16, 24, { rx: 3, f: 'soft' }), line(14, 20, 26, 20, 1.5)], ['schalter', 'switch', 'licht', 'taster']),
  symbol('dimmer', 'Dimmer', 'Dimmer', 40, 40, [rect(0, 0, 40, 40, { rx: 6 }), circle(20, 20, 10, { f: 'soft' }), stroke('M20 10V16', 2)], ['dimmer', 'drehschalter', 'licht']),
  symbol('light', 'Deckenleuchte', 'Ceiling light', 40, 40, [circle(20, 20, 18, { f: 'none' }), stroke('M7.3 7.3L32.7 32.7M32.7 7.3L7.3 32.7', 2)], ['licht', 'lampe', 'leuchte', 'light', 'auslass', 'brennstelle']),
  symbol('light-wall', 'Wandleuchte', 'Wall light', 40, 44, [circle(20, 20, 18, { f: 'none' }), stroke('M7.3 7.3L32.7 32.7M32.7 7.3L7.3 32.7', 2), line(0, 42, 40, 42, 3)], ['licht', 'lampe', 'wand', 'wall', 'light']),
  symbol('spotlight', 'Einbaustrahler', 'Downlight', 40, 40, [circle(20, 20, 11, { f: 'none' }), circle(20, 20, 5, { f: 'line', s: 'none' }), stroke('M20 0V5M20 35V40M0 20H5M35 20H40M6 6L9.5 9.5M34 34L30.5 30.5M34 6L30.5 9.5M6 34L9.5 30.5', 1.5)], ['spot', 'strahler', 'licht', 'downlight']),
  symbol('bulb', 'Glühbirne', 'Light bulb', 46, 66, [path('M23 0C36 0 46 10 46 23C46 33 39 38 36 44V52H10V44C7 38 0 33 0 23C0 10 10 0 23 0Z'), rect(12, 56, 22, 10, { rx: 3, f: 'soft' }), mark('M17 44V30L23 36L29 30V44', 1.5)], ['lampe', 'licht', 'bulb', 'birne'], '#fde68a'),
  { id: 'led-strip', name: { de: 'LED-Streifen', en: 'LED strip' }, words: ['led', 'licht', 'streifen', 'strip'], vw: 160, vh: 12, quiet: true, elements: [rect(0, 0, 160, 12, { rx: 3 }), ...Array.from({ length: 10 }, (_, i) => circle(8 + i * 16, 6, 2.5, { f: 'paper', s: 'none' }))], fill: '#fde68a' },
  symbol('motion', 'Bewegungsmelder', 'Motion sensor', 40, 34, [path('M4 34A16 16 0 0 1 36 34Z'), stroke('M10 16A14 14 0 0 1 30 16M4 9A22 22 0 0 1 36 9', 1.6)], ['bewegung', 'pir', 'sensor', 'motion', 'praesenz'], LIGHT),
  symbol('smoke', 'Rauchmelder', 'Smoke detector', 40, 40, [circle(20, 20, 18), circle(20, 20, 11, { f: 'none', w: 1.2 }), circle(20, 20, 3, { f: 'line', s: 'none' })], ['rauch', 'feuer', 'brand', 'smoke', 'alarm']),
  symbol('thermostat', 'Thermostat', 'Thermostat', 40, 40, [circle(20, 20, 18), stroke('M20 4V8M20 32V36M4 20H8M32 20H36', 1.5), rect(17, 9, 6, 15, { rx: 3, f: 'soft', w: 1.2 }), circle(20, 26, 4.5, { f: 'line', s: 'none' })], ['temperatur', 'heizung', 'thermostat', 'regler']),
  symbol('radiator', 'Heizkörper', 'Radiator', 80, 50, [rect(0, 0, 80, 50, { rx: 4 }), stroke(Array.from({ length: 8 }, (_, i) => `M${12 + i * 8} 7V43`).join(''), 1.5)], ['heizung', 'heizkoerper', 'radiator', 'heater']),
  {
    id: 'floor-heating', name: { de: 'Fußbodenheizung', en: 'Underfloor heating' }, words: ['heizung', 'fussboden', 'floor', 'heating'], vw: 120, vh: 80, quiet: true,
    elements: [rect(0, 0, 120, 80, { f: 'none', s: 'soft', w: 1 }), stroke('M10 10H110V26H10V42H110V58H10V70', 1.8)], fill: 'none',
  },
  symbol('solar', 'Solarmodul', 'Solar panel', 100, 60, [path('M10 0H90L100 60H0Z'), mark('M36.7 0L33.3 60M63.3 0L66.7 60M6.7 20H93.3M3.3 40H96.7', 1.2)], ['solar', 'photovoltaik', 'pv', 'sonne', 'panel'], '#60a5fa'),
  symbol('battery', 'Batteriespeicher', 'Home battery', 50, 70, [rect(15, 0, 20, 8, { rx: 2 }), rect(0, 6, 50, 64, { rx: 6 }), bolt(18, 24, 1)], ['batterie', 'akku', 'speicher', 'battery', 'storage'], '#4ade80'),
  symbol('wallbox', 'Wallbox', 'Wallbox', 50, 76, [rect(0, 0, 50, 64, { rx: 10 }), rect(10, 10, 30, 14, { rx: 3, f: 'paper', w: 1 }), bolt(18, 30, 1, { f: 'ink' }), stroke('M25 64V70Q25 74 30 74H46', 2.5)], ['wallbox', 'laden', 'elektroauto', 'ev', 'charger'], LIGHT),
  symbol('heat-pump', 'Wärmepumpe', 'Heat pump', 90, 60, [rect(0, 0, 90, 60, { rx: 4 }), circle(32, 30, 20, { f: 'paper' }), stroke('M32 30L32 14M32 30L46 38M32 30L18 38', 2), mark('M64 16H80M64 26H80M64 36H80M64 46H80', 1.5)], ['waermepumpe', 'heizung', 'heat pump', 'aussengeraet'], LIGHT),
  symbol('boiler', 'Warmwasserspeicher', 'Water heater', 50, 80, [rect(0, 0, 50, 80, { rx: 20 }), flame(25, 30, 1, true)], ['boiler', 'warmwasser', 'speicher', 'water heater', 'therme'], LIGHT),
  symbol('meter', 'Stromzähler', 'Electricity meter', 60, 70, [rect(0, 0, 60, 70, { rx: 4 }), rect(10, 10, 40, 16, { rx: 2, f: 'paper', w: 1 }), stroke('M14 18H18M22 18H26M30 18H34M38 18H42', 2), circle(30, 48, 10, { f: 'paper' }), stroke('M30 48L36 42', 1.5)], ['zaehler', 'strom', 'meter', 'smart meter'], LIGHT),
  symbol('fuse-box', 'Sicherungskasten', 'Fuse box', 70, 90, [rect(0, 0, 70, 90, { rx: 4 }), ...[0, 1].flatMap((row) => [0, 1, 2, 3, 4].flatMap((col) => [rect(9 + col * 11, 14 + row * 38, 8, 24, { rx: 1, f: 'paper', w: 1 }), rect(11 + col * 11, 20 + row * 38, 4, 9, { f: 'line', s: 'none' })]))], ['sicherung', 'verteiler', 'fuse', 'breaker', 'unterverteilung'], LIGHT),
  symbol('junction', 'Abzweigdose', 'Junction box', 40, 40, [circle(20, 20, 18, { f: 'none' }), circle(20, 20, 5, { f: 'line', s: 'none' })], ['abzweig', 'dose', 'junction', 'verteilerdose']),
  symbol('network-socket', 'Netzwerkdose', 'Network socket', 40, 40, [rect(0, 0, 40, 40, { rx: 6 }), path('M12 14H28V26H24V30H16V26H12Z', { f: 'paper', w: 1.2 })], ['lan', 'netzwerk', 'rj45', 'ethernet', 'dose']),
  symbol('tv-socket', 'Antennendose', 'Antenna socket', 40, 40, [rect(0, 0, 40, 40, { rx: 6 }), circle(20, 20, 9, { f: 'paper', w: 1.2 }), circle(20, 20, 2.5, { f: 'line', s: 'none' })], ['antenne', 'tv', 'sat', 'koax', 'dose']),
  symbol('doorbell', 'Klingel', 'Doorbell', 30, 50, [rect(0, 0, 30, 50, { rx: 8 }), circle(15, 33, 8, { f: 'paper' }), rect(8, 8, 14, 10, { rx: 2, f: 'soft', s: 'ink' })], ['klingel', 'tuerklingel', 'doorbell', 'sprechanlage'], LIGHT),
  symbol('speaker', 'Deckenlautsprecher', 'Ceiling speaker', 40, 40, [circle(20, 20, 18), circle(20, 20, 10, { f: 'soft' }), circle(20, 20, 3, { f: 'line', s: 'none' })], ['lautsprecher', 'speaker', 'audio', 'musik']),
  symbol('smart-plug', 'Zwischenstecker', 'Smart plug', 40, 48, [rect(0, 0, 40, 48, { rx: 10 }), circle(13, 22, 3, { f: 'ink', s: 'none' }), circle(27, 22, 3, { f: 'ink', s: 'none' }), circle(20, 39, 2.5, { f: 'paper' })], ['smart', 'stecker', 'plug', 'schaltbar'], LIGHT),
  symbol('air-conditioner', 'Klimagerät', 'Air conditioner', 100, 52, [rect(0, 0, 100, 34, { rx: 8 }), mark('M8 24H92', 1.2), stroke('M24 40L20 50M50 40V50M76 40L80 50', 1.5)], ['klima', 'klimaanlage', 'air conditioner', 'kuehlung'], LIGHT),
  symbol('water', 'Wasseranschluss', 'Water connection', 40, 40, [circle(20, 20, 18, { f: 'none' }), drop(20, 8, 8)], ['wasser', 'water', 'anschluss', 'zapfstelle'], '#93c5fd'),
  symbol('drain', 'Abfluss', 'Drain', 40, 40, [circle(20, 20, 18), stroke('M8 14H32M5 20H35M8 26H32', 1.5)], ['abfluss', 'drain', 'gully', 'bodenablauf']),
  symbol('gas', 'Gasanschluss', 'Gas connection', 40, 40, [circle(20, 20, 18, { f: 'none' }), flame(20, 8, 0.85)], ['gas', 'flamme', 'heizung'], '#fdba74'),
  symbol('window-contact', 'Fensterkontakt', 'Window contact', 44, 40, [rect(0, 4, 22, 32, { rx: 3 }), rect(26, 10, 12, 20, { rx: 3, f: 'soft' }), stroke('M40 14A8 8 0 0 1 40 26', 1.5)], ['fenster', 'kontakt', 'sensor', 'tuerkontakt', 'alarm'], LIGHT),
  symbol('smart-home', 'Smart-Home-Zentrale', 'Smart home hub', 70, 66, [path('M35 0L70 28H62V66H8V28H0Z'), mark('M25 46A14 14 0 0 1 45 46M19 39A22 22 0 0 1 51 39', 2.5), circle(35, 54, 3, { f: 'ink', s: 'none' })], ['smart home', 'zentrale', 'hub', 'home assistant', 'gateway'], LIGHT),
  symbol('plug-cable', 'Stecker', 'Plug', 40, 56, [rect(4, 14, 32, 26, { rx: 6 }), stroke('M13 4V14M27 4V14', 3), stroke('M20 40V56', 3)], ['stecker', 'kabel', 'plug', 'cable'], LIGHT),
]
