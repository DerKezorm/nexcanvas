# nexcanvas

[![Website: www.nexcanvas.de](https://img.shields.io/badge/website-www.nexcanvas.de-ff8a70?style=for-the-badge)](https://www.nexcanvas.de)

A whiteboard for your own server, in the spirit of Apple Freeform: sticky notes, shapes, text, lines, pen and
highlighter, photos and PDFs on an endless board, edited by several people at the same time. Self-hosted, for
yourself, a family or a small team.

nexcanvas is one of the nex apps and looks like them: coral, dark and light. Whoever knows nexlore finds the same
frame here, with the same accounts, second factor, sign-in through a provider, log, languages and backups. More on
the project site, **[www.nexcanvas.de](https://www.nexcanvas.de)**.

![A network plan with VLANs, the shape library open on the left](docs/screenshots/board.png)

*A network plan from a template. On the left the shape library: packages as groups, search, favorites and recent
shapes; drag a shape onto the board or click it and draw it to size. Lines dock at the edge a shape really has.*

## Screenshots

![A floor plan of a flat with furniture to scale, on a grid](docs/screenshots/floorplan.png)

*A floor plan to scale, one unit a centimetre: walls, doors, windows and furniture from the floor plan package, a
dimension line, the board on a grid that things snap to.*

![A flowchart with a decision and a loop back](docs/screenshots/flowchart.png)

*A flowchart. Every shape carries its text; the "+" on a selected shape adds the next one and joins it, Tab adds a
child and Shift+Tab a sibling.*

![The templates, grouped](docs/screenshots/templates.png)

*Over thirty templates in groups (to begin, flow and process, project, rooms, network, thinking, organisation), plus
your own: save a board as a template, with its content or only the skeleton.*

<p>
  <img src="docs/screenshots/light.png" alt="A home network plan in the light theme" width="68%">
  <img src="docs/screenshots/phone.png" alt="A mind map on a phone" width="28%">
</p>

*Light and dark, and on the phone with every tool at the bottom of the screen.*

## What it does

- **An endless board.** Notes in seven colours, nine shapes with text inside, text in four sizes or handwriting,
  lines that stick to what they connect (straight or curved, arrows, dashed), pen and highlighter with pressure,
  an eraser for drawings. Things snap to each other while you drag (Alt does the opposite).
- **Together, live.** Everybody sees each change at once, the pointers of the others with their names, and what
  they have selected. Two people can type in the same note; both their words stay. Undo only ever takes back your
  own steps, never somebody else's.
- **Photos and files.** Drop them on the board, paste them, or take a photo with the phone's camera. Place and
  device are taken out of photos, large photos get a smaller copy for the board, the same file is stored once.
  A photo dropped on an empty slot of a mood board fills it. PDFs show page by page; what you draw on a page
  stays with that page.
- **Frames and scenes.** A frame is a named area that takes along what lies in it. The scene list jumps from frame
  to frame, and presenting shows one frame after the other on the whole screen, also on a public page.
- **A shape library like Visio's.** Over 350 shapes of its own in packages: basic shapes, flowchart, BPMN, UML and
  software, floor plan (to scale), house and electrics, project management, network, signs and arrows, plus the
  Lucide icons in themed packages. A board carries the drawings of the shapes it uses, so it looks the same on a
  server without that package. Spaces and the operator install packages as files, add SVGs or save a shape from
  the board; each account hides the packages it does not need.
- **Templates.** Over thirty, from kanban and retro to floor plan, rack layout, Gantt schedule and business model
  canvas, and your own ones for a space or the whole server.
- **Backgrounds.** Plain, dots, squares, lines, millimetre paper or isometric, on paper white, cream, chalkboard,
  blueprint or a colour of your own, the same for everybody on the board.
- **Turn, group, line up.** Turn anything around its middle, group things so they move as one, line several up or
  spread them evenly.
- **Export.** The board, the selection or every frame as a picture (PNG) or a PDF, one page per frame.
- **JSON Canvas.** A board saves as a `.canvas` file the way Obsidian writes it, with its photos and files in a ZIP
  archive, and a canvas from Obsidian or nexlore comes in, into an open board or as a new one. What only nexcanvas
  knows (shapes, drawings, turned things, the background) travels along unseen and comes back whole, so a board
  moves from one nexcanvas to another as a file.
- **Spaces and rights.** Boards live in spaces; each member of a space reads, writes or manages there. A space
  somebody may not read answers like one that does not exist. A board can get a public page, read only, with an end
  date and a password if you like.
- **Versions and the trash.** A state of each board is kept every half hour while people work on it; bring one back
  with a click. Boards and spaces go to the trash for 30 days.
- **On the phone.** All tools with the finger: the tools sit at the bottom, one finger moves the board, two zoom,
  a long press opens the menu, a double tap starts a text.
- **Around it, as in nexlore.** Accounts by invitation, second factor with recovery codes, sign-in through an OIDC
  provider, a log in four levels, German and English plus languages the operator adds as JSON files, backups of the
  database together with every photo and file, with a check before going back.

## Start

```yaml
services:
  nexcanvas:
    image: ghcr.io/derkezorm/nexcanvas:latest
    container_name: nexcanvas
    restart: unless-stopped
    ports:
      - "8500:8000"
    volumes:
      - ./data:/data
    environment:
      PUID: 1000
      PGID: 1000
      TZ: Europe/Berlin
```

```
docker compose up -d
```

Built from source instead: clone this repository, put `build: .` in place of `image:` and run
`docker compose up -d --build`.

Open `http://<your-host>:8500`. The first account you create there is the operator. It needs the **setup code**
from the server's log, so that nobody who reaches a fresh instance first can take it:

```
docker logs nexcanvas
```

shows the setup code, new at every start until nexcanvas is set up. To choose it yourself, set
`NEXCANVAS_SETUP_TOKEN`. `docker-compose.yml` in this repository has the same service with every option explained.

**Put nexcanvas behind a reverse proxy with TLS** before you use it from anywhere but your own desk, and let the
proxy pass WebSockets through: boards are edited live over `/api/boards/<id>/live`.

## nexcanvas on the internet

nexcanvas is made to be reachable from outside, for yourself on the road or for a small team. Before you open it:

1. **Set it up first**, from your own network, with the setup code from the log. Only then forward a port.
2. **TLS at a reverse proxy**, and nexcanvas reachable only through it: publish the port as `127.0.0.1:8500:8000`
   when the proxy runs on the same host, or keep both on a Docker network without a published port. Pass WebSockets
   through, and send HSTS from the proxy.
3. **Tell nexcanvas about the proxy**: `NEXCANVAS_PUBLIC_URL` (the address people use), `NEXCANVAS_TRUSTED_PROXIES`
   (the proxy's address or network; without it every sign-in seems to come from the proxy and the brake against
   guessing cannot tell people apart), and `NEXCANVAS_COOKIE_SECURE: "on"`.
4. **A second factor**: set up your own under My account, Security. Or sign in through your OpenID Connect provider.
5. **Leave the switches closed you do not need**: public pages and API tokens are off until you open them.
6. **Optionally keep the operator's settings at home**: `NEXCANVAS_OPERATOR_NETWORKS: "192.168.0.0/16"` refuses them
   from anywhere else (behind a proxy only together with `NEXCANVAS_TRUSTED_PROXIES`).
7. **Backups somewhere else**: they hold everything, photos and files included. Copy one off the machine now and
   then, as carefully as the data directory, and try a restore with "Check".
8. **Pin a version** instead of `latest`, update on purpose, back up before.

## Where things are stored

Everything lives in `/data`: the SQLite database `nexcanvas.db` (accounts, spaces, boards and their versions),
`media/` (photos and files, with smaller copies of large photos), `secret.key`, `backups/`, `logs/`, `locales/`.
Mount it from a local disk, never from an SMB or NFS share: SQLite's locking does not work reliably over network
filesystems.

Back it up with nexcanvas's own backups (Settings, Server, Backup), which copy the database consistently while it
runs and take every photo and file along. A backup is a plain ZIP; whoever has it has everything, so keep
downloaded copies as carefully as the data directory itself.

Moving to a new server: download a backup, set up nexcanvas there, upload the backup under Settings, Server,
Backup, check it and restore it. Afterwards the new server has the old accounts, spaces, boards, photos and files.

## Updating

With an image: `docker compose pull && docker compose up -d`. Built from source: pull the new code and run
`docker compose up -d --build`. nexcanvas adds what the database lacks at the start; nothing needs doing by hand. Make a backup before a big jump anyway.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `NEXCANVAS_DATA_DIR` | `/data` | Database, photos and files, logs, backups, languages |
| `NEXCANVAS_MEDIA_DIR` | `<data>/media` | Photos and files of the boards |
| `NEXCANVAS_LOCALES_DIR` | `<data>/locales` | Extra languages, one JSON file each |
| `NEXCANVAS_SECRET_KEY` | created on first start | Protects server-side secrets; when set, it wins over `secret.key` |
| `NEXCANVAS_PUBLIC_URL` | from the request | The address people use to reach nexcanvas, for invitation links, public pages and the OIDC redirect. The setting in the interface wins when set |
| `NEXCANVAS_TRUSTED_PROXIES` | none | Addresses or networks of reverse proxies whose `X-Forwarded-For` is believed, comma separated |
| `NEXCANVAS_SETUP_TOKEN` | made at start | The code the first account needs |
| `NEXCANVAS_OPERATOR_NETWORKS` | none | Networks the operator's settings may be changed from, comma separated |
| `NEXCANVAS_UPLOAD_MAX_MB` | `50` | The largest photo or file; the operator can lower it in the settings |
| `NEXCANVAS_SESSION_DAYS` | `30` | A browser session ends after this many days |
| `NEXCANVAS_LOG_LEVEL` | stored setting | `quiet`, `normal`, `detailed` or `trace`; overrides the setting |
| `NEXCANVAS_COOKIE_SECURE` | `auto` | `on`, `off` or `auto` (from the request or `X-Forwarded-Proto`) |
| `NEXCANVAS_API_DOCS` | `false` | Serves `/api/docs` and `/api/openapi.json` |
| `PUID`, `PGID` | `1000` | Owner of the files in the data directory |

## Working next to nexlore and Obsidian

nexlore keeps notes, nexcanvas draws. Between them, and with Obsidian, boards travel as JSON Canvas
([jsoncanvas.org](https://jsoncanvas.org)): notes, texts and shapes become text cards, photos and files file cards,
links link cards, frames groups, lines between two things edges. Drawings and lines with a free end are kept in a
`nexcanvas` block the others leave alone. Coming in, a text card becomes a note in the nearest of the seven colours,
a group a frame, and a file card the photo or file of that name from the archive.

## For programs

n8n and your own scripts can read nexcanvas with an API token: the boards, numbers for a dashboard and a small
picture of each board. Off until the operator switches it on; every account then makes its own tokens. Reading only.
The routes are in [docs/api.md](docs/api.md).

## Security in short

- Passwords are hashed with Argon2id; failed sign-ins lock an account for a while, and a brake per sender slows
  guessing on top. With a second factor, the password alone opens nothing.
- Every changing request needs the header `X-Nexcanvas-Client`, which a page on another site cannot send; the live
  connection checks where it comes from and checks the rights of each connection again every 30 seconds, so a
  member taken out of a space is out of its boards at once.
- A space somebody may not read answers exactly like one that does not exist, in every route.
- Readers get the changes of others but cannot send any; the server keeps every change before it passes it on.
- Photos and files are served with their own sandboxing policy; whatever a browser would not show by itself is a
  download. PDFs are drawn by pdf.js without scripts.
- A canvas archive that comes in is read without ever writing its names to disk; each file is checked like an
  upload.
- The log never contains the words on a board, passwords, keys or tokens.

## Development

```
cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8500
cd frontend && npm ci && npx vite
```

On Linux the virtual environment's programs are in `.venv/bin`. The frontend on port 5500 sends `/api`, the live
connection included, to the backend. Tests: `python -m pytest -q` in `backend`, `npx vitest run` in `frontend`.

## License

AGPL-3.0.

The buttons and the icon packages of the shape library use the [Lucide](https://lucide.dev) icons (ISC, partly MIT
from Feather); their notice is in `frontend/public/licenses/lucide.txt` and ships with the app at
`/licenses/lucide.txt`. Everything else nexcanvas ships or depends on, with its licence, is listed in
[THIRD-PARTY.md](THIRD-PARTY.md).
