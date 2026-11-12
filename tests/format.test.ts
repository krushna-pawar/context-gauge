import { describe, expect, test } from 'claude-code/testing'

import {
  bar,
  fmtClock,
  fmtIn,
  fmtModel,
  fmtMode,
  fmtTokens,
  footer,
  FOOTER_DEFAULTS,
  rail,
  rowText,
  type CardInput,
  type FooterOptions,
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

describe('footer', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  const limits = (five: number, resetsIn = 52) => [
    { kind: 'five_hour', percentUsed: five, resetsAt: at(resetsIn) },
    { kind: 'seven_day', percentUsed: 45, resetsAt: at(3 * 24 * 60) },
  ]
  // Calm: nothing is near a limit. Filling: the 5h window has passed 75%.
  const CALM: CardInput = { ...FULL, ctxPercent: 5, limits: limits(62) }
  const FILLING: CardInput = { ...CALM, limits: limits(78) }
  const clock = fmtClock(at(52), true)!
  const text = (input: CardInput, room: number, o: Partial<FooterOptions> = {}) =>
    rowText(footer(input, room, now, { ...FOOTER_DEFAULTS, ...o }, true))

  test('calm: one row of the model and three readings; only the context has a bar, and nothing says when 5h resets', () => {
    expect(text(CALM, 200)).toBe('OPUS 5.5  ctx ━━━━━━ 5%  5h 62%  7d 45%')
    expect(text(CALM, 200).match(/━/g)?.length).toBe(6)
  })

  test('from 75% 5h says when it resets: how long from now, then the time of day; 7d never does', () => {
    expect(text(FILLING, 200)).toBe(`OPUS 5.5  ctx ━━━━━━ 5%  5h 78% resets in 0:52 at ${clock}  7d 45%`)
    const week = { ...CALM, limits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: at(52) }, { kind: 'seven_day', percentUsed: 99, resetsAt: at(90) }] }
    expect(text(week, 200)).toBe('OPUS 5.5  ctx ━━━━━━ 5%  5h 10%  7d 99%')
  })

  test('narrowing drops the reset\'s time of day, the model, the bar, the countdown, then 7d, then everything', () => {
    const steps = [
      `OPUS 5.5  ctx ━━━━━━ 5%  5h 78% resets in 0:52 at ${clock}  7d 45%`,
      'OPUS 5.5  ctx ━━━━━━ 5%  5h 78% resets in 0:52  7d 45%',
      'ctx ━━━━━━ 5%  5h 78% resets in 0:52  7d 45%',
      'ctx 5%  5h 78% resets in 0:52  7d 45%',
      'ctx 5%  5h 78%  7d 45%',
      'ctx 5%  5h 78%',
    ]
    steps.forEach((want, i) => {
      expect(text(FILLING, want.length)).toBe(want)
      expect(text(FILLING, want.length - 1)).toBe(steps[i + 1] ?? '')
    })
    for (let room = 0; room <= 120; room++) expect(text(FILLING, room).length <= room).toBe(true)
  })

  test('the reset as a time of day, on a 12- or 24-hour clock', () => {
    const local = (h: number, m: number) => new Date(2026, 9, 17, h, m).toISOString()
    expect(fmtClock(local(15, 40), true)).toBe('3:40pm')
    expect(fmtClock(local(15, 40), false)).toBe('15:40')
    expect(fmtClock(local(0, 5), true)).toBe('12:05am')
    expect(fmtClock(local(0, 5), false)).toBe('00:05')
    expect(fmtClock(local(12, 0), true)).toBe('12:00pm')
    expect(fmtClock('not a date', true)).toBe(null)
    expect(rowText(footer(FILLING, 200, now, FOOTER_DEFAULTS, false))).toContain(`resets in 0:52 at ${fmtClock(at(52), false)}`)
  })

  test('no reset once it is past or without a clock', () => {
    expect(rowText(footer(FILLING, 200))).not.toContain('resets')
    expect(text({ ...FILLING, limits: limits(78, -1) }, 200)).toContain('5h 78%  7d')
  })

  test('quiet below 75%: everything is muted and plain, the model too', () => {
    const row = footer(CALM, 200, now, FOOTER_DEFAULTS, true)
    for (const t of ['OPUS 5.5', 'ctx ', '5%', '5h ', '62%', '7d ', '45%']) expect(row.find(s => s.text === t)?.tone).toBe('muted')
    expect(row.some(s => s.bold)).toBe(false)
    expect(row.find(s => /^━+$/.test(s.text))?.tone).toBe('accent')
    // A click on the model opens its picker.
    expect(row[0]).toEqual({ text: 'OPUS 5.5', tone: 'muted', press: 'model' })
    expect(row.filter(s => s.press).length).toBe(1)
  })

  test('from 75% a percentage is plain and bold; from 95% Claude orange; never red', () => {
    const filling = footer(FILLING, 200, now, FOOTER_DEFAULTS, true)
    expect(filling.find(s => s.text === '78%')).toEqual({ text: '78%', tone: 'text', bold: true })
    expect(filling.find(s => s.text === '5h ')?.tone).toBe('text')
    expect(filling.find(s => s.text.startsWith(' resets'))?.tone).toBe('muted')

    const near = footer({ ...CALM, ctxPercent: 97, limits: limits(94.9) }, 200, now, FOOTER_DEFAULTS, true)
    expect(near.find(s => s.text === '94%')).toEqual({ text: '94%', tone: 'text', bold: true })
    expect(near.find(s => s.text === '97%')).toEqual({ text: '97%', tone: 'accent', bold: true })
    const full = footer({ ...CALM, limits: limits(95) }, 200, now, FOOTER_DEFAULTS, true)
    expect(full.find(s => s.text === '95%')).toEqual({ text: '95%', tone: 'accent', bold: true })
    for (const row of [filling, near, full]) expect(row.some(s => s.tone === 'critical')).toBe(false)
  })

  test('settings: each part can be turned off, the effort on, and both thresholds moved', () => {
    expect(text(CALM, 200, { model: false })).toBe('ctx ━━━━━━ 5%  5h 62%  7d 45%')
    expect(text(CALM, 200, { week: false })).toBe('OPUS 5.5  ctx ━━━━━━ 5%  5h 62%')
    expect(text(FILLING, 200, { clock: false })).toBe('OPUS 5.5  ctx ━━━━━━ 5%  5h 78% resets in 0:52  7d 45%')
    expect(text(CALM, 200, { effort: true })).toBe('OPUS 5.5  ctx ━━━━━━ 5%  5h 62%  7d 45%  high')
    const effort = footer(CALM, 200, now, { ...FOOTER_DEFAULTS, effort: true }, true)
    expect(effort[effort.length - 1]).toEqual({ text: 'high', tone: 'muted', press: 'effort' })
    expect(text(CALM, 200, { noticeAt: 50 })).toContain('5h 62% resets in 0:52')
    const moved = footer(CALM, 200, now, { ...FOOTER_DEFAULTS, noticeAt: 50, alertAt: 60 }, true)
    expect(moved.find(s => s.text === '62%')).toEqual({ text: '62%', tone: 'accent', bold: true })
    expect(moved.find(s => s.text === '45%')?.tone).toBe('muted')
  })

  test('missing data shows a dash, never a guess', () => {
    expect(text(EMPTY, 200)).toBe('—  ctx ━━━━━━ —  5h —  7d —')
    expect(text(EMPTY, 200, { effort: true })).toBe('—  ctx ━━━━━━ —  5h —  7d —  —')
  })
})

describe('rail(): the card on the desktop, VS Code and mobile', () => {
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
  const flex = (input: CardInput, columns: number) => rail(input, columns, now)
  const tails = (r: ReturnType<typeof flex>) => r.gauges.map(g => rowText(g.tail))

  test('the parts to lay out', () => {
    const r = flex(S, 120)
    expect(r.paddingX).toBe(2)
    expect(r.gauges.map(g => g.label.text)).toEqual(['CTX', '5H', '7D'])
    expect(r.gauges.map(g => g.pct.text)).toEqual(['8%', '34%', '7%'])
  })

  test('fill: none for no use or no reading, at least 2% for any use', () => {
    const r = flex({ ...S, ctxPercent: 0, limits: [{ kind: 'five_hour', percentUsed: 0.4 }] }, 130)
    expect(r.gauges.map(g => g.fill)).toEqual([0, 2, 0])
    expect(flex({ ...S, ctxPercent: 150 }, 130).gauges[0]!.fill).toBe(100)
  })

  test('one gap everywhere, never none', () => {
    expect(flex(S, 160).gap).toBe(2)
    expect(flex(S, 90).gap).toBe(1)
    expect(flex(S, 64).gap).toBe(1)
  })

  // Columns are the code font's, so they never decide which gauges a flex surface gets: at 43
  // the desktop had room for 7D with a third of the card empty, and it was hidden.
  test('every gauge and both ends at any width: what fits is the surface layout\'s call', () => {
    for (const columns of [400, 160, 90, 64, 50, 43, 24, 4]) {
      const r = flex(FULL, columns)
      expect(r.gauges.map(g => g.label.text)).toEqual(['CTX', '5H', '7D'])
      expect(r.left.text).toBe('OPUS 5.5')
      expect(rowText(r.right)).toBe('HIGH / DEFAULT')
    }
  })

  test('keeps its bars unless its columns say it is narrow, and then stacks', () => {
    expect(flex(FULL, 120).bars).toBe(true)
    expect(flex(FULL, 120).stacked).toBe(false)
    // A 700px desktop card counted 64.
    expect(flex(FULL, 64).bars).toBe(true)
    expect(flex(FULL, 64).stacked).toBe(false)
    expect(flex(FULL, 30).stacked).toBe(true)
    expect(flex(FULL, 30).bars).toBe(false)
    expect(flex(FULL, 30).gauges.length).toBe(3)
  })

  test('drops tokens, then the reset time, before its bars get short', () => {
    expect(tails(flex(S, 130))).toEqual(['84.1k / 1.0M', '↻ 1:20', ''])
    expect(tails(flex(S, 90))).toEqual(['', '↻ 1:20', ''])
    expect(tails(flex(S, 74))).toEqual(['', '', ''])
  })

  test('only 5H shows a reset countdown, never 7D, and none without a clock', () => {
    expect(tails(flex(S, 160))[2]).toBe('')
    expect(tails(rail(S, 160))).toEqual(['84.1k / 1.0M', '', ''])
  })

  test('missing data shows a dash; the window is known before the first response', () => {
    const r = flex(EMPTY, 160)
    expect(r.left.text).toBe('—')
    expect(r.gauges.map(g => g.pct.text)).toEqual(['—', '—', '—'])
    expect(rowText(r.right)).toBe('— / —')
    expect(tails(flex({ ...EMPTY, ctxWindow: 200_000 }, 160))[0]).toBe('— / 200k')
  })

  test('mode names are shown as words, upper-cased', () => {
    expect(rowText(flex({ ...FULL, mode: 'acceptEdits' }, 120).right)).toBe('HIGH / ACCEPT EDITS')
  })

  test('90% and over marks the digits critical; below that they stay plain', () => {
    const r = flex({ ...FULL, ctxPercent: 69, limits: [{ kind: 'five_hour', percentUsed: 93 }, { kind: 'seven_day', percentUsed: 70 }] }, 160)
    expect(r.gauges.map(g => g.pct.tone)).toEqual(['text', 'critical', 'text'])
  })

  test('reset countdown: rounded up to the minute, gone once past', () => {
    expect(fmtIn(at(0.5), now)).toBe('0:01')
    expect(fmtIn(at(42), now)).toBe('0:42')
    expect(fmtIn(at(80), now)).toBe('1:20')
    expect(fmtIn(at((3 * 24 + 4) * 60), now)).toBe('76:00')
    expect(fmtIn(at(0), now)).toBe(null)
    expect(fmtIn('not a date', now)).toBe(null)
  })
})
