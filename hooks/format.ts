import type { Snap } from '../types'

export type Tone = 'text' | 'muted' | 'accent' | 'critical' | 'track'
export type Seg = { text: string; tone: Tone; bold?: boolean; press?: 'model' | 'effort' }
export type Row = Seg[]
export type CardInput = Snap

const DASH = '—'
const WINDOWS = [
  { kind: 'five_hour', label: '5H' },
  { kind: 'seven_day', label: '7D' },
]
const MODES: Record<string, string> = { acceptEdits: 'accept edits', bypassPermissions: 'bypass', dontAsk: "don't ask" }

const seg = (text: string, tone: Tone = 'text'): Seg => ({ text, tone })
const dash = seg(DASH, 'muted')
export const rowText = (row: Row) => row.map(s => s.text).join('')

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  // 999.5k and up would round to "1000k".
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
}

export function fmtModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

export const fmtMode = (mode: string | null) => (mode === null ? DASH : (MODES[mode] ?? mode))

export function fmtIn(iso: string, now: number): string | null {
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return null
  const minutes = Math.ceil(ms / 60_000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

// The clock of the machine Claude Code runs on. A server's is often UTC, not the person's own
// zone, so a time told in UTC says so.
const MACHINE = (() => {
  try {
    const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
    return { hour12: o.hour12 ?? !/^h2/.test(o.hourCycle ?? ''), utc: /^(Etc\/)?(UTC|GMT|Universal|Zulu)$/.test(o.timeZone) }
  } catch {
    return { hour12: true, utc: false }
  }
})()

// The hour (0-23) and minute of a moment in an IANA time zone, or null where the zone is unknown.
function inZone(d: Date, timeZone: string): [number, number] | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(d)
    const of = (type: string) => Number(parts.find(p => p.type === type)?.value)
    return Number.isNaN(of('hour') + of('minute')) ? null : [of('hour'), of('minute')]
  } catch {
    return null
  }
}

export const isZone = (timeZone: string) => inZone(new Date(0), timeZone) !== null

// `3:40pm`, or `15:40` on a 24-hour clock: in `timeZone` when given, else the machine's.
export function fmtClock(iso: string, hour12 = MACHINE.hour12, timeZone = ''): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const [h, min] = (timeZone && inZone(d, timeZone)) || [d.getHours(), d.getMinutes()]
  const m = String(min).padStart(2, '0')
  return hour12 ? `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}` : `${String(h).padStart(2, '0')}:${m}`
}

const fillPct = (pct: number | null) => (pct === null || pct <= 0 ? 0 : Math.min(100, Math.max(2, pct)))

export function bar(pct: number | null, width: number): Seg[] {
  if (width <= 0) return []
  const filled = fillPct(pct) === 0 ? 0 : Math.min(width, Math.max(1, Math.round((pct! / 100) * width)))
  return [seg('━'.repeat(filled), 'accent'), seg('━'.repeat(width - filled), 'track')].filter(s => s.text)
}

const limitOf = (s: CardInput, kind: string) => s.limits.find(l => l.kind === kind)
const model = (s: CardInput) => (s.model === null ? DASH : fmtModel(s.model).toUpperCase())


const pctSeg = (pct: number | null): Seg => (pct === null ? dash : seg(`${Math.floor(pct)}%`, pct >= 90 ? 'critical' : 'text'))
const upper = (v: string | null): Seg => (v === null ? dash : { text: v.toUpperCase(), tone: 'accent', bold: true })

type Fit = { gap: number; tokens: boolean; resets: boolean; bars: boolean }
const FITS: Fit[] = [
  { gap: 2, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: false, resets: true, bars: true },
  { gap: 1, tokens: false, resets: false, bars: true },
  { gap: 1, tokens: false, resets: false, bars: false },
]
const MIN_BAR = 6
// A flex surface's columns undercount its room (VS Code: 36 across 490px), so from 30 cells the
// bars stay whatever the fit says, and under 40 the card stacks into two rows.
const BARS_FROM = 30
const ROW_FROM = 40

function gauges(s: CardInput, fit: Fit, now?: number) {
  const tokens = (n: number | null) => seg(n === null ? DASH : fmtTokens(n), 'muted')
  const ctx = { label: 'CTX', pct: s.ctxPercent, tail: fit.tokens ? [tokens(s.ctxTokens), seg(' / ', 'muted'), tokens(s.ctxWindow)] : [] }
  return [
    ctx,
    ...WINDOWS.map(({ kind, label }, i) => {
      const limit = limitOf(s, kind)
      const resets = i === 0 && fit.resets && now !== undefined && limit?.resetsAt ? fmtIn(limit.resetsAt, now) : null
      return { label, pct: limit?.percentUsed ?? null, tail: resets === null ? [] : [seg(`↻ ${resets}`, 'muted')] }
    }),
  ]
}

const ends = (s: CardInput): { left: Seg; right: Row } => ({
  left: s.model === null ? dash : { text: model(s), tone: 'text', bold: true },
  right: [upper(s.effort), seg(' / ', 'muted'), upper(s.mode === null ? null : fmtMode(s.mode))],
})

function fits(s: CardInput, inner: number, fit: Fit, now?: number): boolean {
  const { left, right } = ends(s)
  const sep = 2 * fit.gap + 1
  const text = gauges(s, fit, now).reduce((n, g) => {
    const p = pctSeg(g.pct).text.length
    // The token count sits in a field of 6, so the bar keeps its length as the count grows.
    const tail = g.tail.length ? 2 + Math.max(g.label === 'CTX' ? 6 : 0, g.tail[0]!.text.length) + rowText(g.tail.slice(1)).length : 0
    return n + sep + g.label.length + 1 + (fit.bars ? 1 + Math.max(4, p) : Math.max(3, p)) + tail
  }, left.text.length + sep + rowText(right).length)
  const free = inner - text
  if (!fit.bars) return free >= 0
  const ctx = Math.round(free * 0.4)
  return Math.min(ctx, Math.floor((free - ctx) / 2)) >= MIN_BAR
}

export function rail(s: CardInput, columns: number, now?: number) {
  const paddingX = columns >= 60 ? 2 : 1
  const inner = Math.max(columns, 4) - 2 - paddingX * 2
  const fit = FITS.find(f => fits(s, inner, f, now)) ?? FITS[FITS.length - 1]!
  const stacked = inner < ROW_FROM
  return {
    paddingX,
    gap: fit.gap,
    bars: !stacked && (fit.bars || inner >= BARS_FROM),
    stacked,
    ...ends(s),
    gauges: gauges(s, fit, now).map(g => ({ label: seg(g.label, 'muted'), fill: fillPct(g.pct), pct: pctSeg(g.pct), tail: g.tail })),
  }
}


export type FooterOptions = {
  model: boolean
  effort: boolean
  week: boolean
  clock: boolean
  resetAlways: boolean
  noticeAt: number
  alertAt: number
  hour12: boolean
  timeZone: string
  utc: boolean
}
export const FOOTER_DEFAULTS: FooterOptions = { model: true, effort: false, week: true, clock: true, resetAlways: false, noticeAt: 75, alertAt: 95, timeZone: '', ...MACHINE }

function reading(label: string, pct: number | null, o: FooterOptions, width = 0): Row {
  const text = pct === null ? DASH : `${Math.floor(pct)}%`
  const strip = width ? [...bar(pct, width), seg(' ', 'muted')] : []
  if (pct === null || pct < o.noticeAt) return [seg(`${label} `, 'muted'), ...strip, seg(text, 'muted')]
  return [seg(`${label} `), ...strip, { text, tone: pct < o.alertAt ? 'text' : 'accent', bold: true }]
}

// The footer after `drop` steps of narrowing: the reset's time of day goes first, then the model,
// the bar and the effort, the countdown, 7d, and 5h.
function footerAt(s: CardInput, drop: number, o: FooterOptions, now?: number): Row[] {
  const parts: Row[] = []
  if (drop < 2 && o.model) parts.push([{ text: model(s), tone: s.model === null ? 'muted' : 'accent', press: 'model' }])
  parts.push(reading('ctx', s.ctxPercent, o, drop < 3 ? 6 : 0))
  WINDOWS.slice(0, drop > 5 ? 0 : o.week && drop < 5 ? 2 : 1).forEach(({ kind, label }, i) => {
    const limit = limitOf(s, kind)
    const pct = limit?.percentUsed ?? null
    const part = reading(label.toLowerCase(), pct, o)
    const left = i === 0 && drop < 4 && pct !== null && (o.resetAlways || pct >= o.noticeAt) && now !== undefined && limit?.resetsAt ? fmtIn(limit.resetsAt, now) : null
    if (left !== null) {
      const at = drop < 1 && o.clock ? fmtClock(limit!.resetsAt!, o.hour12, o.timeZone) : null
      part.push(seg(` resets in ${left}${at === null ? '' : ` at ${at}${o.utc && !o.timeZone ? ' UTC' : ''}`}`, 'muted'))
    }
    parts.push(part)
  })
  if (drop < 3 && o.effort) parts.push([{ ...(s.effort === null ? dash : seg(s.effort, 'accent')), press: 'effort' }])
  return parts
}

export function footer(s: CardInput, room: number, now?: number, o = FOOTER_DEFAULTS): Row[] {
  for (let drop = 0; drop < 7; drop++) {
    const groups = footerAt(s, drop, o, now)
    if (groups.map(rowText).join('  ').length <= room) return groups
  }
  return []
}
