# The nexcanvas API

Programs such as [nexdeck](https://github.com/DerKezorm/nexdeck) or n8n read nexcanvas over `/api/v1`: the boards,
numbers for a dashboard and a small picture of a board. The API only reads; nothing under `/api/v1` changes a board.

## Switching it on

API tokens are off until the operator switches them on, under **Settings → Server → API**. Then every account makes
its own tokens under **My account → Connections**:

- A token reads what its account may read, never more. It can be limited to some spaces.
- It runs out after 30, 90 or 365 days, or never. The list marks a token a week before it runs out.
- It is shown once, right after it was made. nexcanvas keeps only a checksum.
- The operator sees every token (never the token itself) and can block one for good.

## Asking

Every request carries the token in a header:

```
Authorization: Bearer nxa_…
```

A request that carries an `Origin` header is refused (403): the API is for programs, not web pages. The answers are
JSON, the picture of a board is SVG.

| Answer | Code | Meaning |
|---|---|---|
| 401 | `api_off` | The operator has not switched API tokens on. |
| 401 | `token_invalid` | No such token, or it ran out, was blocked or deleted. |
| 403 | `origin_refused` | The request came from a web page. |
| 404 | `not_found` | No such board or space, or the token may not read it. Both answer the same. |
| 429 | `slow_down` | More than 600 requests in a minute with this token; `Retry-After` says when to go on. |

Errors look like `{"detail": {"code": "token_invalid", "message": "No valid API token."}}`.

## Routes

### `GET /api/v1/me`

Who the token speaks for: `name`, `display_name`, `level` (always `read`), `spaces` (the names of the spaces it may
read) and the nexcanvas `version`.

### `GET /api/v1/spaces`

The spaces the token may read: `id`, `name`, `color`, `boards` (how many) and `role` (`read`, `write` or `manage`, the
account's right there).

### `GET /api/v1/boards`

Boards the token may read, the ones changed last first.

| Parameter | Default | |
|---|---|---|
| `space` | all | Only the boards of this space (its `id`). |
| `order` | `updated` | `updated` or `title`. |
| `limit` | 50 | 1 to 200. |

Each board: `id`, `title`, `space_id`, `space`, `created_at`, `updated_at` (ISO 8601, UTC), `updated_by` (the account
name of whoever changed it last), `items` (how many things are on it), `url` (where it opens in the browser) and
`picture` (the path of its picture, see below).

### `GET /api/v1/boards/{id}`

One board, as in the list.

### `GET /api/v1/boards/{id}/picture.svg`

The board as a small picture, as the overview in the app shows it: shapes, notes, frames and drawings as they are;
words, photos, files and links as plain boxes. 16 to 10, on the board's own background colour.

| Parameter | Default | |
|---|---|---|
| `look` | `dark` | `dark` or `light`, the looks of the app. |
| `width` | 480 | 120 to 1600 pixels. |

The answer is `image/svg+xml` with a policy that lets nothing in it run or load. It may be kept for 30 seconds.

### `GET /api/v1/dashboard`

Numbers for a dashboard card:

```json
{
  "spaces": 2,
  "boards": 14,
  "changed_today": 3,
  "changed_week": 6,
  "recent": [ … the five boards changed last, as in the list … ]
}
```

"Today" is the server's day.

## A dashboard card

A card that shows the boards changed last asks `/api/v1/dashboard` now and then (a minute is plenty) and shows the
`recent` boards with their pictures: the picture of each is `picture` after the server's address, fetched with the
same header. A click opens `url`.

## The promise

What is under `/api/v1` stays as it is: new fields may come, nothing is renamed or taken away. A change that would
break a program goes to `/api/v2` beside it.
