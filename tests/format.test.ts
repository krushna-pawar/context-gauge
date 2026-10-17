import { describe, expect, test } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import {
  bar,
  buildCard,
  fmtIn,
  fmtModel,
  fmtMode,
  fmtTokens,
  rail,
  rowText,
  type CardInput,
} from '../hooks/format'

const FULL: CardInput = {
  model: 'Opus 5.5',
  effort: 'high',
  mode: 'default',
  ctxTokens: 84_123,
  ctxWindow: 200_000,
  ctxPercent: 42,
  limits: [
    { kind: 'five_hour', percentUsed: 31 },
    { kind: 'seven_day', percentUsed: 12.4 },
  ],
}

const EMPTY: CardInput = {
  model: null,
  effort: null,
  mode: null,
  ctxTokens: null,
  ctxWindow: null,
  ctxPercent: null,
  limits: [],
}

const lines = (input: CardInput, columns: number) => {
  const card = buildCard(input, columns)
  return { card, text: rowText(card.row) }
}

const barCells = (input: CardInput, columns: number) =>
  buildCard(input, columns).row.filter(seg => /^━+$/.test(seg.text)).reduce((n, seg) => n + seg.text.length, 0)

describe('formatters', () => {
  test('tokens', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(84_123)).toBe('84.1k')
    expect(fmtTokens(200_000)).toBe('200k')
    expect(fmtTokens(999_499)).toBe('999k')
    expect(fmtTokens(999_500)).toBe('1.0M')
    expect(fmtTokens(1_000_000)).toBe('1.0M')
    expect(fmtTokens(1_500_000)).toBe('1.5M')
  })

  test('model id to display name, unknown ids unchanged', () => {
    expect(fmtModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(fmtModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(fmtModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(fmtModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(fmtModel('claude-fable-5')).toBe('Fable 5')
    expect(fmtModel('Opus 5.5')).toBe('Opus 5.5')
    expect(fmtModel('us.anthropic.claude-x')).toBe('us.anthropic.claude-x')
  })

  test('mode', () => {
    expect(fmtMode('acceptEdits')).toBe('accept edits')
    expect(fmtMode('bypassPermissions')).toBe('bypass')
    expect(fmtMode('dontAsk')).toBe("don't ask")
    expect(fmtMode('plan')).toBe('plan')
    expect(fmtMode('somethingNew')).toBe('somethingNew')
    expect(fmtMode(null)).toBe('—')
  })

  test('bar fill is always Claude orange on a dark track', () => {
    const half = bar(42, 10)
    expect(half.map(s => s.tone)).toEqual(['accent', 'track'])
    expect(half[0]!.text.length).toBe(4)
    expect(half[1]!.text.length).toBe(6)
    expect(bar(95, 10)[0]!.tone).toBe('accent')
    expect(bar(150, 10)).toEqual([{ text: '━'.repeat(10), tone: 'accent' }])
    expect(bar(null, 6)).toEqual([{ text: '━'.repeat(6), tone: 'track' }])
    expect(bar(50, 0)).toEqual([])
  })
})

describe('rail', () => {
  test('one row, full width, every value in order', () => {
    const { card, text } = lines(FULL, 160)
    expect(card.width).toBe(160)
    expect(text.length).toBe(card.inner)
    expect(text).toMatch(/^OPUS 5\.5  │  CTX ━+  42%   84\.1k \/ 200k  │  5H ━+  31%  │  7D ━+  12%  │  HIGH \/ DEFAULT$/)
  })

  test('every filled bar is accent, never another tone', () => {
    const fills = buildCard({ ...FULL, ctxPercent: 95, limits: [{ kind: 'five_hour', percentUsed: 90 }, { kind: 'seven_day', percentUsed: 50 }] }, 120)
      .row.filter(s => /^━+$/.test(s.text))
    expect(fills.map(s => s.tone)).toEqual(['accent', 'track', 'accent', 'track', 'accent', 'track'])
  })

  test('bars grow with the width and the context bar is the longest', () => {
    expect(barCells(FULL, 200) > barCells(FULL, 120)).toBe(true)
    const row = buildCard(FULL, 140).row
    const bars: number[] = []
    let run = 0
    for (const s of row) {
      if (/^━+$/.test(s.text)) run += s.text.length
      else if (run > 0) (bars.push(run), (run = 0))
    }
    expect(bars.length).toBe(3)
    expect(bars[0]! > bars[1]!).toBe(true)
    expect(bars[0]! > bars[2]!).toBe(true)
  })

  test('fills the inner width exactly, never wider, at any width', () => {
    for (const columns of [240, 160, 120, 100, 80, 76, 64, 52, 44, 36, 32, 24]) {
      const { card, text } = lines(FULL, columns)
      expect(text.length <= card.inner).toBe(true)
      if (columns >= 52) expect(text.length).toBe(card.inner)
    }
  })

  test('narrowing drops token counts, then bars, keeping percentages and the right block', () => {
    const mid = lines(FULL, 80).text
    expect(mid).not.toContain('84.1k')
    expect(mid).toContain('━')
    const small = lines(FULL, 64).text
    expect(small).not.toContain('━')
    expect(small).toContain('42%')
    expect(small).not.toMatch(/ {6}/)
    expect(small.endsWith('HIGH / DEFAULT')).toBe(true)
    expect(lines({ ...FULL, mode: 'auto' }, 48).text.endsWith('HIGH / AUTO')).toBe(true)
  })

  test('missing data shows a dash, never a guess', () => {
    const { text } = lines(EMPTY, 160)
    expect(text.startsWith('—  │  CTX ')).toBe(true)
    expect(text).toContain('— / —')
    expect(text).not.toContain('%')
    expect(text.endsWith('— / —')).toBe(true)
    expect(buildCard(EMPTY, 160).row.some(s => s.tone === 'accent' && /━/.test(s.text))).toBe(false)
  })

  test('window known before the first response', () => {
    expect(lines({ ...EMPTY, ctxWindow: 200_000 }, 160).text).toContain('— / 200k')
  })

  test('no subscription windows: 5H and 7D show a dash', () => {
    const t = lines({ ...FULL, limits: [{ kind: 'spend_limit', percentUsed: 50 }] }, 160).text
    expect(t).toMatch(/5H ━+ +—  │  7D ━+ +—  │/)
  })

  test('mode names are shown as words, upper-cased', () => {
    expect(lines({ ...FULL, mode: 'acceptEdits' }, 160).text.endsWith('HIGH / ACCEPT EDITS')).toBe(true)
    expect(lines({ ...FULL, mode: 'auto' }, 160).text.endsWith('HIGH / AUTO')).toBe(true)
  })

  test('90% and over marks the digits critical; below that they stay plain', () => {
    const row = buildCard({ ...FULL, ctxPercent: 69, limits: [{ kind: 'five_hour', percentUsed: 93 }, { kind: 'seven_day', percentUsed: 70 }] }, 160).row
    expect(row.find(s => s.text === '93%')?.tone).toBe('critical')
    expect(row.find(s => s.text === '70%')?.tone).toBe('text')
    expect(row.find(s => s.text === '69%')?.tone).toBe('text')
  })

  test('reset countdown: rounded up to the minute, gone once past or without a clock', () => {
    const now = Date.parse('2026-10-17T12:00:00Z')
    const at = (ms: number) => new Date(now + ms).toISOString()
    expect(fmtIn(at(30_000), now)).toBe('0:01')
    expect(fmtIn(at(42 * 60_000), now)).toBe('0:42')
    expect(fmtIn(at(80 * 60_000), now)).toBe('1:20')
    expect(fmtIn(at((3 * 24 + 4) * 3_600_000), now)).toBe('76:00')
    expect(fmtIn(at(0), now)).toBe(null)
    expect(fmtIn('not a date', now)).toBe(null)
    const s = { ...FULL, limits: [{ kind: 'five_hour', percentUsed: 31, resetsAt: at(80 * 60_000) }] }
    expect(lines(s, 160).text).not.toContain('↻')
    expect(rowText(buildCard(s, 160, now).row)).toContain('31%  ↻ 1:20')
  })

  test('only 5H shows a reset countdown, never 7D', () => {
    const now = Date.parse('2026-10-17T12:00:00Z')
    const at = (ms: number) => new Date(now + ms).toISOString()
    const s = {
      ...FULL,
      limits: [
        { kind: 'five_hour', percentUsed: 31, resetsAt: at(80 * 60_000) },
        { kind: 'seven_day', percentUsed: 12, resetsAt: at((3 * 24 + 4) * 3_600_000) },
      ],
    }
    const t = rowText(buildCard(s, 160, now).row)
    expect(t).toContain('31%  ↻ 1:20')
    expect(t).toMatch(/7D ━+  12%  │/)
    expect(t).not.toContain('76:00')
  })

  test('flex surfaces drop tokens where the terminal keeps them beside short bars', () => {
    expect(buildCard(FULL, 95).fit.tokens).toBe(true)
    const r = rail(FULL, 'desktop', 95)
    expect(r.surface === 'flex' && r.bars && rowText(r.gauges[0]!.tail)).toBe('')
  })
})

describe('rail() on a flex surface', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  const S: CardInput = {
    ...EMPTY,
    ctxTokens: 84_123,
    ctxWindow: 1_000_000,
    ctxPercent: 8,
    limits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: at(80) },
      { kind: 'seven_day', percentUsed: 7, resetsAt: at(3 * 24 * 60 + 240) },
    ],
  }
  const flex = (input: CardInput, columns: number, surface: RenderSurface = 'desktop') => {
    const r = rail(input, surface, columns, now)
    if (r.surface !== 'flex') throw new Error(`expected a flex rail, got ${r.surface}`)
    return r
  }
  const tails = (r: ReturnType<typeof flex>) => r.gauges.map(g => rowText(g.tail))
  const terminal = (input: CardInput, columns: number) => {
    const r = rail(input, 'terminal', columns, now)
    if (r.surface !== 'terminal') throw new Error(`expected a terminal rail, got ${r.surface}`)
    return rowText(r.row)
  }

  test('the terminal gets its row; every other surface gets the parts to lay out', () => {
    expect(rail(S, 'terminal', 120, now).surface).toBe('terminal')
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) expect(rail(S, surface, 120, now).surface).toBe('flex')
    const r = flex(S, 120)
    expect(r.width).toBe(120)
    expect(r.paddingX).toBe(2)
    expect(r.gauges.map(g => g.label.text)).toEqual(['CTX', '5H', '7D'])
    expect(r.gauges.map(g => g.pct.text)).toEqual(['8%', '34%', '7%'])
  })

  test('fill: none for no use or no reading, at least 2% for any use', () => {
    const r = flex({ ...S, ctxPercent: 0, limits: [{ kind: 'five_hour', percentUsed: 0.4 }] }, 130)
    expect(r.gauges.map(g => g.fill)).toEqual([0, 2, 0])
    expect(flex({ ...S, ctxPercent: 150 }, 130).gauges[0]!.fill).toBe(100)
  })

  test('one gap everywhere: the terminal spacing, never none', () => {
    expect(flex(S, 160).gap).toBe(2)
    expect(flex(S, 90).gap).toBe(1)
    expect(flex(S, 24).gap).toBe(1)
  })

  test('drops tokens, then the reset time, before its bars get short', () => {
    const wide = flex(S, 130)
    expect(wide.bars).toBe(true)
    expect(tails(wide)).toEqual(['84.1k / 1.0M', '↻ 1:20', ''])

    // Where the terminal would still squeeze tokens in beside short bars, the desktop gives them up
    // but keeps the 5H countdown, which the terminal drops along with the tokens.
    expect(terminal(S, 90)).toContain('84.1k')
    const mid = flex(S, 90)
    expect(mid.bars).toBe(true)
    expect(tails(mid)).toEqual(['', '↻ 1:20', ''])
    expect(terminal(S, 80)).not.toContain('↻')

    const narrow = flex(S, 74)
    expect(narrow.bars).toBe(true)
    expect(tails(narrow)).toEqual(['', '', ''])
  })
})
