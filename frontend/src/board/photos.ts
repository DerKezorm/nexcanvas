/**
 * Made-up photos for the demo boards: small SVG scenes as data addresses, so the mock needs no files and no
 * outside server. Each looks enough like a photo to judge a board full of them.
 */

function svg(w: number, h: number, body: string): string {
  const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
}

function sky(id: string, top: string, bottom: string): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>`
}

export type PhotoKind = 'fjord' | 'sunset' | 'forest' | 'room' | 'kitchen' | 'city' | 'desk' | 'plant'

export function photo(kind: PhotoKind): string {
  switch (kind) {
    case 'fjord':
      return svg(
        640,
        440,
        sky('s', '#7cb7e8', '#dbeafe') +
          `<rect width="640" height="440" fill="url(#s)"/>` +
          `<path d="M0 250 120 120 210 200 300 90 420 210 520 130 640 230V440H0Z" fill="#475569"/>` +
          `<path d="M0 270 90 190 180 240 280 160 380 250 470 190 640 260V440H0Z" fill="#334155"/>` +
          `<path d="M276 98 300 90 322 112 304 108Z M512 136 520 130 534 142Z" fill="#f8fafc"/>` +
          `<rect y="300" width="640" height="140" fill="#1e3a5f"/>` +
          `<path d="M0 300H640V312C520 306 400 316 300 308S80 316 0 310Z" fill="#2c4f7c"/>` +
          `<path d="M70 360h120M260 380h160M460 350h90" stroke="#5b86b8" stroke-width="3" stroke-linecap="round" opacity=".6"/>`,
      )
    case 'sunset':
      return svg(
        640,
        440,
        sky('s', '#f97316', '#fde68a') +
          `<rect width="640" height="440" fill="url(#s)"/>` +
          `<circle cx="320" cy="270" r="70" fill="#fff7ed" opacity=".9"/>` +
          `<rect y="270" width="640" height="170" fill="#7c2d12"/>` +
          `<path d="M250 300h140M220 330h200M270 360h100" stroke="#fdba74" stroke-width="4" stroke-linecap="round" opacity=".7"/>` +
          `<path d="M0 270 60 240 130 262 200 236 250 270Z M420 270 500 230 570 258 640 238V270Z" fill="#431407"/>`,
      )
    case 'forest':
      return svg(
        640,
        440,
        sky('s', '#a7f3d0', '#ecfccb') +
          `<rect width="640" height="440" fill="url(#s)"/>` +
          Array.from({ length: 11 }, (_, i) => {
            const x = 20 + i * 60
            const h = 180 + ((i * 53) % 90)
            return `<path d="M${x} ${440 - h} ${x + 45} 440H${x - 45}Z" fill="${i % 2 ? '#166534' : '#14532d'}"/>`
          }).join('') +
          `<rect y="400" width="640" height="40" fill="#3f6212"/>`,
      )
    case 'room':
      return svg(
        640,
        440,
        `<rect width="640" height="440" fill="#e7e1d8"/>` +
          `<rect y="320" width="640" height="120" fill="#b08968"/>` +
          `<rect x="80" y="60" width="180" height="130" rx="4" fill="#f5f0e8" stroke="#a8a29e" stroke-width="6"/>` +
          `<path d="M95 175 150 110 190 150 215 128 245 175Z" fill="#7dd3fc" opacity=".7"/>` +
          `<rect x="300" y="210" width="280" height="90" rx="20" fill="#5b7553"/>` +
          `<rect x="280" y="240" width="320" height="80" rx="22" fill="#6b8a62"/>` +
          `<rect x="300" y="320" width="10" height="26" fill="#3f3f46"/><rect x="570" y="320" width="10" height="26" fill="#3f3f46"/>` +
          `<rect x="330" y="215" width="60" height="45" rx="10" fill="#f4c095"/>` +
          `<rect x="40" y="250" width="44" height="70" rx="6" fill="#c2410c"/>` +
          `<path d="M62 250c-30-40-10-80 0-90 10 10 30 50 0 90Z" fill="#4d7c0f"/>`,
      )
    case 'kitchen':
      return svg(
        640,
        440,
        `<rect width="640" height="440" fill="#f1f5f9"/>` +
          `<rect y="250" width="640" height="190" fill="#334155"/>` +
          `<rect y="240" width="640" height="16" fill="#e2e8f0"/>` +
          Array.from({ length: 5 }, (_, i) => `<rect x="${30 + i * 120}" y="280" width="104" height="130" rx="4" fill="#475569"/><rect x="${70 + i * 120}" y="300" width="24" height="5" rx="2" fill="#cbd5e1"/>`).join('') +
          `<rect x="60" y="50" width="220" height="110" rx="6" fill="#cbd5e1"/>` +
          `<rect x="360" y="50" width="220" height="110" rx="6" fill="#cbd5e1"/>` +
          `<circle cx="470" cy="210" r="24" fill="#f97316"/><rect x="455" y="182" width="30" height="8" rx="3" fill="#7c2d12"/>`,
      )
    case 'city':
      return svg(
        640,
        440,
        sky('s', '#1e1b4b', '#7c3aed') +
          `<rect width="640" height="440" fill="url(#s)"/>` +
          Array.from({ length: 12 }, (_, i) => {
            const x = i * 55
            const h = 140 + ((i * 71) % 170)
            return `<rect x="${x}" y="${440 - h}" width="50" height="${h}" fill="${i % 2 ? '#1e1b4b' : '#312e81'}"/>` +
              Array.from({ length: Math.floor(h / 30) }, (_, j) => (j + i) % 3 ? '' : `<rect x="${x + 12}" y="${450 - h + j * 30}" width="8" height="10" fill="#fde68a"/>`).join('')
          }).join(''),
      )
    case 'desk':
      return svg(
        640,
        440,
        `<rect width="640" height="440" fill="#d6d3d1"/>` +
          `<rect y="290" width="640" height="150" fill="#78350f"/>` +
          `<rect x="200" y="80" width="260" height="170" rx="10" fill="#18181b"/>` +
          `<rect x="212" y="92" width="236" height="146" rx="4" fill="#0f766e"/>` +
          `<path d="M230 120h120M230 140h170M230 160h90M230 180h140" stroke="#99f6e4" stroke-width="6" stroke-linecap="round" opacity=".7"/>` +
          `<rect x="310" y="250" width="40" height="40" fill="#27272a"/><rect x="260" y="286" width="140" height="10" rx="4" fill="#27272a"/>` +
          `<rect x="120" y="300" width="190" height="34" rx="6" fill="#e4e4e7"/>` +
          `<rect x="500" y="250" width="44" height="50" rx="8" fill="#fafaf9"/>`,
      )
    case 'plant':
      return svg(
        440,
        560,
        `<rect width="440" height="560" fill="#ecfccb"/>` +
          `<rect x="150" y="380" width="140" height="150" rx="12" fill="#c2410c"/>` +
          `<path d="M220 390c-90-60-110-180-40-250 20 80 60 150 40 250Z" fill="#4d7c0f"/>` +
          `<path d="M220 390c80-50 120-150 70-240-30 70-80 140-70 240Z" fill="#65a30d"/>` +
          `<path d="M220 390c-10-110 10-200 0-290-25 90-25 190 0 290Z" fill="#3f6212"/>`,
      )
  }
}
