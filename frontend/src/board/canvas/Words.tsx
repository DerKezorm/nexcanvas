/**
 * The words of a note, a shape or a text as the board shows them: line by line, with the formatting of each part
 * (`board/rich.ts`). The markup is the editor's own (`p`, `ol` with `li[data-list]`), and both use the rules of
 * `.nc-rich`, so the words stay exactly where they are when someone starts writing in them.
 */

import type { CSSProperties } from 'react'

import { linesOf, runsOf, type Line, type Run } from '../rich'

function partStyle(marks: Run['attributes']): CSSProperties | undefined {
  if (!marks) return undefined
  const lines = [marks.underline && 'underline', marks.strike && 'line-through'].filter(Boolean).join(' ')
  return {
    fontWeight: marks.bold ? 700 : undefined,
    fontStyle: marks.italic ? 'italic' : undefined,
    textDecorationLine: lines || undefined,
    color: marks.color,
  }
}

function Parts({ line }: { line: Line }) {
  if (!line.parts.length) return <br />
  return (
    <>
      {line.parts.map((part, n) =>
        part.attributes ? (
          <span key={n} className={part.attributes.size ? `ql-size-${part.attributes.size}` : undefined} style={partStyle(part.attributes)}>
            {part.insert}
          </span>
        ) : (
          part.insert
        ),
      )}
    </>
  )
}

export function Words({ text, rich, className = '', style }: { text: string; rich?: Run[]; className?: string; style?: CSSProperties }) {
  const lines = linesOf(runsOf(text, rich))
  // Lines of a list stand together in one list, as in the editor.
  const blocks: Line[][] = []
  for (const line of lines) {
    const last = blocks[blocks.length - 1]
    if (line.list && last?.[0].list) last.push(line)
    else blocks.push([line])
  }
  return (
    <div className={'nc-rich ' + className} style={style}>
      {blocks.map((block, n) =>
        block[0].list ? (
          <ol key={n}>
            {block.map((line, m) => (
              <li key={m} data-list={line.list}>
                <span className="ql-ui" />
                <Parts line={line} />
              </li>
            ))}
          </ol>
        ) : (
          <p key={n}>
            <Parts line={block[0]} />
          </p>
        ),
      )}
    </div>
  )
}
