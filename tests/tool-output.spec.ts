import { describe, expect, it } from 'vitest'
import { truncateHeadTail } from '../src/client/tool-output.tsx'

describe('truncateHeadTail', () => {
  it('keeps the whole text when it fits', () => {
    expect(truncateHeadTail('a\nb\nc', 2, 2)).toEqual({ head: 'a\nb\nc', omitted: 0, tail: '' })
  })

  it('keeps head and tail and reports omitted middle', () => {
    const text = ['1', '2', '3', '4', '5', '6', '7'].join('\n')
    expect(truncateHeadTail(text, 2, 2)).toEqual({
      head: '1\n2',
      omitted: 3,
      tail: '6\n7',
    })
  })
})
