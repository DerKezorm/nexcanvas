# Third-party licences

nexcanvas itself is licensed under the **GNU Affero General Public License v3.0** (see [LICENSE](LICENSE)). This file
lists what it ships or depends on.

## Bundled with the app

These files travel inside the container image, so their notices travel with them.

| What | Copyright | Licence | Notice in the app |
|---|---|---|---|
| Font Inter (via Fontsource) | The Inter Project Authors | OFL-1.1 | `/licenses/fonts.txt` |
| Lucide icons (partly from Feather): the buttons, and the icon packages of the shape library | Lucide Contributors; Cole Bemis | ISC, MIT | `/licenses/lucide.txt` |
| PDF.js, to show PDFs page by page | Mozilla and contributors | Apache-2.0 | `/licenses/pdfjs.txt` |

nexcanvas loads no font, icon or script from another host.

## Backend

| Package | Licence |
|---|---|
| FastAPI, SQLAlchemy, pydantic, pydantic-settings, argon2-cffi, PyJWT, pycrdt | MIT |
| uvicorn, httpx, pypdf, segno | BSD-3-Clause |
| Pillow | MIT-CMU |
| python-multipart | Apache-2.0 |
| cryptography | Apache-2.0 **or** BSD-3-Clause |
| pillow-heif | BSD-3-Clause for its own code; the binary wheels are **GPLv2** as a whole, see below |

### HEIC photos: pillow-heif and the libraries it brings

To turn iPhone photos (HEIC) into a picture every browser shows, nexcanvas uses pillow-heif. Its binary wheels, and
so the container image, contain:

| Library | Licence |
|---|---|
| libheif | LGPL-3.0 |
| libde265 | LGPL-3.0 |
| x265 | GPL-2.0-or-later |

The wheel ships these notices in `pillow_heif-*.dist-info/licenses/`. GPL-2.0-or-later and LGPL-3.0 may be combined
with an AGPL-3.0 work, and the source of every part is public.

## Frontend

| Package | Licence |
|---|---|
| React, React DOM, React Router, Yjs, y-websocket, y-protocols, perfect-freehand, html-to-image, i18next, react-i18next | MIT |
| lucide-react | ISC |
| pdfjs-dist | Apache-2.0 |
| Fontsource packages | MIT (the font itself OFL-1.1, see above) |

Build and test tools (Vite, TypeScript, Tailwind CSS, Vitest, Playwright, ruff, pytest) are not part of the image.

## Compatibility

All of the above may be combined into an AGPL-3.0 work. The obligation runs one way: nexcanvas as a whole is
AGPL-3.0, and anyone who runs a modified version as a network service must offer its source.
