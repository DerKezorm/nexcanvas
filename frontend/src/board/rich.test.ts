/** Formatting inside the words: what is kept, how lines fall, when a look counts for all of them. */

import { allHave, cleanRuns, hasMarks, linesOf, plainOf, runsOf } from './rich'

describe('cleaning the formatting', () => {
  it('keeps what the board knows and drops everything else', () => {
    const runs = cleanRuns([
      { insert: 'a', attributes: { bold: true, link: 'javascript:alert(1)', font: 'serif' } },
      { insert: 'b', attributes: { color: '#FF8A70', size: 'large' } },
      { insert: 'c', attributes: { color: 'red; background: url(x)', size: '99px', italic: 'yes' } },
      { insert: '\n', attributes: { list: 'checked' } },
      { insert: '\n', attributes: { list: 'ordered' } },
    ])
    expect(runs).toEqual([
      { insert: 'a', attributes: { bold: true } },
      { insert: 'b', attributes: { color: '#ff8a70', size: 'large' } },
      { insert: 'c\n' },
      { insert: '\n', attributes: { list: 'ordered' } },
    ])
  })

  it('drops what is no words: embeds, empty inserts, rubbish', () => {
    expect(cleanRuns([{ insert: { video: 'x' } }, { insert: '' }, null, 'a', { retain: 3 }, { insert: 'ok' }])).toEqual([{ insert: 'ok' }])
    expect(cleanRuns('nope')).toEqual([])
  })

  it('knows whether there is any formatting at all', () => {
    expect(hasMarks([{ insert: 'plain' }])).toBe(false)
    expect(hasMarks(cleanRuns([{ insert: 'a', attributes: { strike: true } }]))).toBe(true)
    expect(plainOf([{ insert: 'a' }, { insert: 'b\n', attributes: { list: 'bullet' } }])).toBe('ab\n')
  })
})

describe('lines', () => {
  it('ends a line at each newline, the last one may leave it out', () => {
    expect(linesOf([{ insert: 'a' }]).length).toBe(1)
    expect(linesOf([{ insert: 'a\n' }]).length).toBe(1)
    expect(linesOf([{ insert: 'a\n\n' }]).map((l) => l.parts.length)).toEqual([1, 0])
    expect(linesOf([]).length).toBe(1)
  })

  it('gives a line the list its newline carries, and the parts their own marks', () => {
    const lines = linesOf([
      { insert: 'Title\n' },
      { insert: 'one ', attributes: { bold: true } },
      { insert: 'two' },
      { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'three' },
      { insert: '\n', attributes: { list: 'ordered' } },
    ])
    expect(lines).toEqual([
      { parts: [{ insert: 'Title' }] },
      { list: 'bullet', parts: [{ insert: 'one ', attributes: { bold: true } }, { insert: 'two' }] },
      { list: 'ordered', parts: [{ insert: 'three' }] },
    ])
  })
})

describe('a look over all the words', () => {
  it('counts only when every letter has it', () => {
    expect(allHave([{ insert: 'ab', attributes: { bold: true } }, { insert: '\n' }], 'bold')).toBe(true)
    expect(allHave([{ insert: 'a', attributes: { bold: true } }, { insert: 'b' }], 'bold')).toBe(false)
    expect(allHave([{ insert: ' \n' }], 'bold')).toBe(false)
    expect(allHave(undefined, 'bold')).toBe(false)
  })

  it('takes plain words as one run', () => {
    expect(runsOf('hi', undefined)).toEqual([{ insert: 'hi' }])
    expect(runsOf('', undefined)).toEqual([])
    expect(runsOf('hi', [{ insert: 'hi', attributes: { bold: true } }])).toEqual([{ insert: 'hi', attributes: { bold: true } }])
  })
})
