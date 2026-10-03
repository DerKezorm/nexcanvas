/**
 * The style "Icons": the Lucide symbols nexcanvas draws its buttons with (ISC licence), as shapes. One package holds
 * all of them as lines, like the buttons; the themed packages hold a selection in two colours, the lines in the line
 * colour and the closed parts in the fill. The data (`lucide.json`, made by `scripts/lucide.mjs`) loads when a board
 * opens, not with the page; a board carries every symbol it uses, so it never waits for it.
 */
import { GERMAN_WORDS } from './iconWordsDe'
import type { ShapeDef, ShapeElement, ShapePackage } from './types'

type Raw = (string | null)[]

const META = { version: '1.0.0', author: 'Lucide Contributors', license: 'ISC', builtin: true, scope: 'builtin' as const, enabled: true }
const BELOW = { x: -0.5, y: 1.04, w: 2, h: 0.42 }

/** Themes: a name, and the parts of Lucide names that belong to it. */
const THEMES: { id: string; name: Record<string, string>; parts: RegExp }[] = [
  { id: 'icons-devices', name: { de: 'Icons: Geräte und Netzwerk', en: 'Icons: devices and network' }, parts: /^(monitor|laptop|smartphone|tablet|server|router|wifi|hard-drive|database|cpu|printer|keyboard|mouse|cable|plug|usb|bluetooth|network|tv|webcam|camera|speaker|headphones|watch|battery|radio|satellite|antenna|ethernet|memory|gpu|computer|phone|nfc|signal|scan|qr|container|box|binary|terminal|code|globe|ethernet-port|hdmi)/ },
  { id: 'icons-office', name: { de: 'Icons: Büro und Projekt', en: 'Icons: office and project' }, parts: /^(briefcase|calendar|clipboard|file|folder|mail|inbox|paperclip|pen|pencil|book|notebook|presentation|chart|table|kanban|list|calculator|archive|stamp|signature|bookmark|tag|clock|alarm|timer|hourglass|target|flag|milestone|goal|gantt|square-kanban|receipt|wallet|banknote|coins|piggy|landmark|building|handshake|graduation|award|trophy|medal|badge)/ },
  { id: 'icons-home', name: { de: 'Icons: Haus und Alltag', en: 'Icons: home and everyday' }, parts: /^(house|home|bed|bath|sofa|lamp|lightbulb|door|key|lock|fan|heater|thermometer|refrigerator|microwave|washing|shower|toilet|utensils|chef|cooking|armchair|fence|sprout|shopping|cart|car|bike|bus|train|plane|ship|baby|dog|cat|coffee|cup|wine|beer|pizza|apple|sandwich|cake|cookie|gift|shirt|scissors|hammer|wrench|drill|paintbrush|brush|trash|recycle|vacuum|blinds|lamp-ceiling|lamp-desk|fire-extinguisher|warehouse|tent|caravan)/ },
  { id: 'icons-nature', name: { de: 'Icons: Wetter und Natur', en: 'Icons: weather and nature' }, parts: /^(sun|moon|cloud|snow|rain|wind|umbrella|leaf|tree|flower|mountain|waves|droplet|flame|sprout|rainbow|tornado|cloudy|haze|sunrise|sunset|thermometer|bird|fish|bug|squirrel|rabbit|turtle|snail|shell|clover|palmtree|trees|cherry|grape|carrot|wheat|earth|globe|compass|map)/ },
  { id: 'icons-arrows', name: { de: 'Icons: Pfeile', en: 'Icons: arrows' }, parts: /^(arrow|chevron|corner|move|redo|undo|repeat|refresh|rotate|shuffle|trending|step|skip|fast-forward|rewind|iteration|git|merge|split|route|navigation|send|forward|reply|log-in|log-out|external)/ },
  { id: 'icons-people', name: { de: 'Icons: Menschen und Sprache', en: 'Icons: people and talk' }, parts: /^(user|users|person|contact|message|messages|phone|smile|frown|meh|laugh|angry|hand|heart|thumbs|ear|eye|brain|speech|mic|accessibility|baby|venus|mars|bot|ghost|skull|crown|party|megaphone|bell|at-sign|share|hand-heart)/ },
  { id: 'icons-media', name: { de: 'Icons: Medien', en: 'Icons: media' }, parts: /^(play|pause|music|video|film|image|images|camera|mic|volume|headphones|disc|radio|podcast|tv|clapperboard|gamepad|joystick|dice|puzzle|palette|brush|pen-tool|aperture|focus|scan|sliders|equalizer|audio|airplay|cast|youtube)/ },
  { id: 'icons-signs', name: { de: 'Icons: Zeichen und Formen', en: 'Icons: signs and shapes' }, parts: /^(circle|square|triangle|hexagon|octagon|pentagon|star|diamond|check|x|alert|info|help|plus|minus|shield|ban|badge|sparkle|sparkles|zap|asterisk|hash|percent|equal|infinity|sigma|pi|omega|bold|italic|quote|heading|pilcrow|shapes|spade|club|cone|cylinder|pyramid)/ },
]

function humanize(name: string): string {
  const words = name.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The German words for a symbol: those whose English meaning is a whole part of its name, so "drucker" finds the
 * printer and "adresse" the map pin, but "bad" not the badge. */
const GERMAN = Object.entries(GERMAN_WORDS)
function germanFor(name: string): string[] {
  const framed = `-${name}-`
  return GERMAN.filter(([, englishes]) => englishes.some((english) => framed.includes(`-${english}-`))).map(([german]) => german)
}

const n = (value: string | null) => Number(value ?? 0)

function element(raw: Raw, twoTone: boolean): ShapeElement | null {
  const [tag, ...v] = raw
  const look = (closed: boolean) => ({ f: twoTone && closed ? ('fill' as const) : ('none' as const), s: 'line' as const, w: 2.5 })
  switch (tag) {
    case 'path': {
      const d = v[0] ?? ''
      return { t: 'path', d, ...look(/z\s*$/i.test(d)) }
    }
    case 'circle':
      return { t: 'circle', cx: n(v[0]), cy: n(v[1]), r: n(v[2]), ...look(true) }
    case 'ellipse':
      return { t: 'ellipse', cx: n(v[0]), cy: n(v[1]), rx: n(v[2]), ry: n(v[3]), ...look(true) }
    case 'rect':
      return { t: 'rect', x: n(v[0]), y: n(v[1]), width: n(v[2]), height: n(v[3]), ...(v[4] ? { rx: n(v[4]) } : {}), ...look(true) }
    case 'line':
      return { t: 'line', x1: n(v[0]), y1: n(v[1]), x2: n(v[2]), y2: n(v[3]), s: 'line', w: 2.5 }
    case 'polyline':
    case 'polygon': {
      const pts = (v[0] ?? '').trim().split(/[\s,]+/).map(Number)
      if (pts.length < 4 || pts.some((p) => !Number.isFinite(p))) return null
      const pairs: string[] = []
      for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`)
      return { t: 'path', d: 'M' + pairs.join('L') + (tag === 'polygon' ? 'Z' : ''), ...look(tag === 'polygon') }
    }
    default:
      return null
  }
}

function def(name: string, raws: Raw[], twoTone: boolean): ShapeDef {
  const parts = name.split('-')
  const german = germanFor(name)
  const shown = humanize(name)
  return {
    id: name,
    name: { de: shown, en: shown },
    words: [...new Set([...parts, ...german])].filter((word) => word.length <= 40).slice(0, 20),
    vw: 24,
    vh: 24,
    w: 64,
    h: 64,
    keep: true,
    elements: raws.map((raw) => element(raw, twoTone)).filter((el): el is ShapeElement => el !== null),
    text: BELOW,
    fill: twoTone ? '#3b82f6' : 'none',
  }
}

let loading: Promise<ShapePackage[]> | null = null

/** The icon packages, loaded once. */
export function loadIconPackages(): Promise<ShapePackage[]> {
  loading ??= import('./lucide.json').then((module) => {
    const data = (module.default ?? module) as unknown as Record<string, Raw[]>
    const names = Object.keys(data).sort()
    const themed = THEMES.map((theme) => ({
      ...META,
      id: theme.id,
      name: theme.name,
      shapes: names.filter((name) => theme.parts.test(name)).map((name) => def(name, data[name], true)),
    }))
    const all: ShapePackage = { ...META, id: 'icons', name: { de: 'Icons: alle (Linien)', en: 'Icons: all (lines)' }, shapes: names.map((name) => def(name, data[name], false)) }
    return [...themed, all]
  })
  return loading
}

/** The ids of the icon packages, known before the data is there (for the switches in the profile). */
export const ICON_PACKAGES: { id: string; name: Record<string, string> }[] = [...THEMES.map(({ id, name }) => ({ id, name })), { id: 'icons', name: { de: 'Icons: alle (Linien)', en: 'Icons: all (lines)' } }]
