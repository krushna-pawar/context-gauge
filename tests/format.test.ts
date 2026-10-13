import { describe, expect, test } from 'claude-code/testing'

import {
  bar,
  buildCard,
  fmtCost,
  fmtModel,
  fmtMode,
  fmtTokens,
  rowText,
  type CardInput,
} from '../hooks/format'

const FULL: CardInput = {
  model: 'Opus 5.5',
  effort: 'high',
  mode: 'default',
  requests: 12,
  requestsPartial: false,
  ctxTokens: 84_123,
  ctxWindow: 200_000,
  ctxPercent: 42,
  costUsd: 1.844,
  limits: [
    { kind: 'five_hour', percentUsed: 31 },
    { kind: 'seven_day', percentUsed: 12.4 },
  ],
}

const EMPTY: CardInput = {
  model: null,
  effort: null,
  mode: null,
  requests: 0,
  requestsPartial: false,
  ctxTokens: null,
  ctxWindow: null,
  ctxPercent: null,
  costUsd: null,
  limits: [],
}

const lines = (input: CardInput, columns: number) => {
  const card = buildCard(input, columns)
  return { card, text: card.rows.map(rowText) }
}

const barCells = (input: CardInput, columns: number) =>
  buildCard(input, columns).rows[0]!.filter(seg => /^━+$/.test(seg.text)).reduce((n, seg) => n + seg.text.length, 0)

describe('formatters', () => {
  test('tokens', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(84_123)).toBe('84.1k')
    expect(fmtTokens(200_000)).toBe('200k')
    expect(fmtTokens(1_000_000)).toBe('1.0M')
    expect(fmtTokens(1_500_000)).toBe('1.5M')
  })

  test('cost is always an estimate, never a charge', () => {
    expect(fmtCost(1.844)).toBe('≈$1.84')
    expect(fmtCost(0)).toBe('≈$0.00')
    expect(fmtCost(null)).toBe('—')
  })

  test('model id to display name, unknown ids unchanged', () => {
    expect(fmtModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(fmtModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(fmtModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
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
    expect(text.length).toBe(1)
    expect(text[0]!.length).toBe(card.inner)
    expect(text[0]!).toMatch(/^OPUS 5\.5 +│ +CTX 42% ━+  84\.1k \/ 200k +│ +5H 31% ━+ +│ +7D 12% ━+ +│ +HIGH \/ DEFAULT$/)
  })

  test('every filled bar is accent, never another tone', () => {
    const fills = buildCard({ ...FULL, ctxPercent: 95, limits: [{ kind: 'five_hour', percentUsed: 90 }, { kind: 'seven_day', percentUsed: 50 }] }, 120)
      .rows[0]!.filter(s => /^━+$/.test(s.text))
    expect(fills.map(s => s.tone)).toEqual(['accent', 'track', 'accent', 'track', 'accent', 'track'])
  })

  test('bars are one length, grow with the width up to a cap, and spare room goes to the gaps', () => {
    expect(barCells(FULL, 160) > barCells(FULL, 110)).toBe(true)
    expect(barCells(FULL, 400)).toBe(3 * 24)
    expect(lines(FULL, 400).text[0]!).toMatch(/CTX 42% ━{24}  84\.1k/)
    const row = buildCard(FULL, 140).rows[0]!
    const bars: number[] = []
    let run = 0
    for (const s of row) {
      if (/^━+$/.test(s.text)) run += s.text.length
      else if (run > 0) (bars.push(run), (run = 0))
    }
    expect(bars.length).toBe(3)
    expect(new Set(bars).size).toBe(1)
  })

  test('fills the inner width exactly, never wider, at any width', () => {
    for (const columns of [240, 160, 120, 100, 80, 76, 64, 52, 44, 36, 32, 24]) {
      const { card, text } = lines(FULL, columns)
      expect(text.length).toBe(1)
      expect(text[0]!.length <= card.inner).toBe(true)
      if (columns >= 52) expect(text[0]!.length).toBe(card.inner)
    }
  })

  test('narrowing drops token counts, then bars, keeping percentages and the right block', () => {
    const mid = lines(FULL, 80).text[0]!
    expect(mid).not.toContain('84.1k')
    expect(mid).toContain('━')
    const small = lines(FULL, 64).text[0]!
    expect(small).not.toContain('━')
    expect(small).toContain('42%')
    expect(small).not.toMatch(/ {6}/)
    expect(small.endsWith('HIGH / DEFAULT')).toBe(true)
    expect(lines({ ...FULL, mode: 'auto' }, 48).text[0]!.endsWith('HIGH / AUTO')).toBe(true)
  })

  test('missing data shows a dash, never a guess', () => {
    const { text } = lines(EMPTY, 160)
    expect(text[0]!).toMatch(/^— +│ +CTX +— ━+/)
    expect(text[0]!).toContain('— / —')
    expect(text[0]!).not.toContain('%')
    expect(text[0]!.endsWith('— / —')).toBe(true)
    expect(buildCard(EMPTY, 160).rows[0]!.some(s => s.tone === 'accent' && /━/.test(s.text))).toBe(false)
  })

  test('window known before the first response', () => {
    expect(lines({ ...EMPTY, ctxWindow: 200_000 }, 160).text[0]!).toContain('— / 200k')
  })

  test('no subscription windows: 5H and 7D show a dash', () => {
    const t = lines({ ...FULL, limits: [{ kind: 'spend_limit', percentUsed: 50 }] }, 160).text[0]!
    expect(t).toMatch(/5H +— ━+ +│ +7D +— ━+ +│/)
  })

  test('mode names are shown as words, upper-cased', () => {
    expect(lines({ ...FULL, mode: 'acceptEdits' }, 160).text[0]!.endsWith('HIGH / ACCEPT EDITS')).toBe(true)
    expect(lines({ ...FULL, mode: 'auto' }, 160).text[0]!.endsWith('HIGH / AUTO')).toBe(true)
  })

  test('90% and over marks the digits critical', () => {
    const row = buildCard({ ...FULL, limits: [{ kind: 'five_hour', percentUsed: 93 }] }, 160).rows[0]!
    expect(row.find(s => s.text === '93%')?.tone).toBe('critical')
  })
})
