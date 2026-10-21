/** The words as the board shows them: the editor's markup, each part with its own look, nothing it does not know. */
import { renderToStaticMarkup } from 'react-dom/server'

import { Words } from './Words'

describe('words on the board', () => {
  it('shows plain words as one line, an empty line as a break', () => {
    expect(renderToStaticMarkup(<Words text="Hallo" />)).toBe('<div class="nc-rich "><p>Hallo</p></div>')
    expect(renderToStaticMarkup(<Words text={'a\n\nb'} />)).toBe('<div class="nc-rich "><p>a</p><p><br/></p><p>b</p></div>')
  })

  it('gives a part its size in pixels as a style, an old step as its class', () => {
    const out = renderToStaticMarkup(<Words text="ab" rich={[{ insert: 'a', attributes: { size: '24px' } }, { insert: 'b', attributes: { size: 'huge' } }]} />)
    expect(out).toBe('<div class="nc-rich "><p><span style="font-size:24px">a</span><span class="ql-size-huge">b</span></p></div>')
  })

  it('gives each part its look and puts list lines into one list', () => {
    const out = renderToStaticMarkup(
      <Words
        text={'Titel\neins\nzwei\n'}
        rich={[
          { insert: 'Titel', attributes: { bold: true, color: '#60a5fa' } },
          { insert: '\neins' },
          { insert: '\n', attributes: { list: 'ordered' } },
          { insert: 'zwei', attributes: { size: 'large', strike: true, underline: true } },
          { insert: '\n', attributes: { list: 'ordered' } },
        ]}
      />,
    )
    expect(out).toBe(
      '<div class="nc-rich "><p><span style="font-weight:700;color:#60a5fa">Titel</span></p>' +
        '<ol><li data-list="ordered"><span class="ql-ui"></span>eins</li>' +
        '<li data-list="ordered"><span class="ql-ui"></span><span class="ql-size-large" style="text-decoration-line:underline line-through">zwei</span></li></ol></div>',
    )
  })

  it('writes words as words, never as markup', () => {
    expect(renderToStaticMarkup(<Words text={'<img src=x onerror=alert(1)>'} />)).toContain('&lt;img')
  })
})
