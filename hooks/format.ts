import type { RenderSurface } from 'claude-code'

import type { Snap } from '../types'

export type Tone = 'text' | 'muted' | 'accent' | 'critical' | 'track'
export type Seg = { text: string; tone: Tone; bold?: boolean }
export type Row = Seg[]
export type CardInput = Snap
export type Card = { width: number; inner: number; paddingX: number; row: Row; fit: Fit }

// The least share of a bar any use fills, so 4% never reads as empty.
const MIN_FILL = 2
const CRITICAL = 90
const DASH = '—'
// ASCII, not the box-drawing │: Terminal.app's SF Mono draws │ 2pt below its cell, and once it
// moves, that sliver stays on the unchanged border row beneath as a stray dot until ctrl+L.
const SEP = '|'

// Only the 5-hour window shows its reset: the 7-day one is days off and rarely the question.
const WINDOWS = [
  { kind: 'five_hour', label: '5H', countdown: true },
  { kind: 'seven_day', label: '7D', countdown: false },
]

const MODES: Record<string, string> = {
  acceptEdits: 'accept edits',
  bypassPermissions: 'bypass',
  dontAsk: "don't ask",
}

export const seg = (text: string, tone: Tone = 'text'): Seg => ({ text, tone })
const spaces = (n: number): Seg => seg(' '.repeat(Math.max(0, n)), 'muted')
export const rowText = (row: Row) => row.map(s => s.text).join('')
const rowLength = (row: Row) => rowText(row).length

export function fmtTokens(n: number): string {
  const short = (v: number) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1000) return String(n)
  // 999.5k and up would round to "1000k": those read as 1.0M.
  if (n < 999_500) return `${short(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// `claude-opus-5-5[1m]` → `Opus 5.5`, `claude-sonnet-4-20250514` → `Sonnet 4`;
// anything not spelled that way is shown as given.
export function fmtModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

export const fmtMode = (mode: string | null) => (mode === null ? DASH : (MODES[mode] ?? mode))

// How much of a bar to fill, in percent: none for no use, at least MIN_FILL for any.
const fillPct = (pct: number | null) => (pct === null || pct <= 0 ? 0 : Math.min(100, Math.max(MIN_FILL, pct)))

// Filled cells in Claude orange, the rest a dark track, whatever the percentage.
export function bar(pct: number | null, width: number): Seg[] {
  if (width <= 0) return []
  if (pct === null) return [seg('━'.repeat(width), 'track')]
  // At least one cell for any use, the same rule fillPct gives the desktop's strip.
  const filled = fillPct(pct) === 0 ? 0 : Math.min(width, Math.max(1, Math.round((pct / 100) * width)))
  const out: Seg[] = []
  if (filled > 0) out.push(seg('━'.repeat(filled), 'accent'))
  if (filled < width) out.push(seg('━'.repeat(width - filled), 'track'))
  return out
}

// A percentage as its own segment, so tone applies to the digits alone.
const pctSeg = (pct: number | null): Seg =>
  pct === null
    ? seg(DASH, 'muted')
    : seg(`${Math.floor(pct)}%`, pct >= CRITICAL ? 'critical' : 'text')

// The same, right-aligned in a field of cells.
function percent(pct: number | null, field = 4): Seg[] {
  const p = pctSeg(pct)
  return [spaces(field - p.text.length), p]
}

const value = (v: string | null): Seg => (v === null ? seg(DASH, 'muted') : seg(v))

function clip(row: Row, inner: number): Row {
  if (rowLength(row) <= inner) return row
  const out: Row = []
  let room = inner - 1
  for (const s of row) {
    if (room <= 0) break
    out.push({ ...s, text: s.text.slice(0, room) })
    room -= s.text.length
  }
  out.push(seg('…', 'muted'))
  return out
}

// How much of the rail survives as the band narrows, roomiest first; the last is used even if
// it doesn't fit. `resets`: the 5H gauge's reset countdown. `gauges`: how many to keep, of all
// three unless given. `shortEffort` writes MEDIUM as MED.
export type Fit = { gap: number; tokens: boolean; resets: boolean; bars: boolean; gauges?: number; shortEffort?: boolean }

const TERMINAL_FITS: Fit[] = [
  { gap: 2, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: false, resets: false, bars: true },
  { gap: 1, tokens: false, resets: false, bars: false },
  { gap: 0, tokens: false, resets: false, bars: false },
  // Too narrow for every gauge: EFFORT / MODE outlasts 7D, whose reading … would have cut anyway.
  { gap: 0, tokens: false, resets: false, bars: false, gauges: 2 },
  { gap: 0, tokens: false, resets: false, bars: false, gauges: 2, shortEffort: true },
  { gap: 0, tokens: false, resets: false, bars: false, gauges: 1, shortEffort: true },
]
const TERMINAL_MIN_BAR = 3

// The flex surfaces keep the 5H countdown a step longer than the token count. They draw at least
// one gap, so they never try none.
const FLEX_FITS: Fit[] = [
  { gap: 2, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: false, resets: true, bars: true },
  { gap: 1, tokens: false, resets: false, bars: true },
  { gap: 1, tokens: false, resets: false, bars: false },
]
// A flex surface's columns say little of its room: VS Code's panel counted 36 across about
// 490px, where proportional text fits twice that. So they choose only the extras, tokens, the
// countdown and the bars, and a wrong choice costs at most a wrapped line or bars left out.
// Everything else is laid out by the surface itself.
const FLEX_MIN_BAR = 6
// Bars stay from this many cells inside the card, even where the counted text leaves them none:
// desktop counted a 700px card as 64 cells, VS Code a 490px panel as 36, both with room for bars.
// The surface draws a bar no shorter than 4 cells and wraps a line that can't hold it. Narrower,
// as VS Code's sidebar, the gauges go without.
const FLEX_BARS_FROM = 30
// Under this many cells inside the card, a flex surface stacks: model and EFFORT / MODE on one
// row, the gauges on the next. The desktop's own wrapping broke a line with room to spare, so
// the card picks its rows itself. A 310px desktop card counted about 28.
const FLEX_ROW_FROM = 40

// `steady`: cells the tail's first segment is padded to, so the bar keeps its length as it grows.
type Gauge = { label: string; pct: number | null; tail: Row; steady?: number }

// Time until an ISO timestamp as hours:minutes, rounded up to the minute: `0:42`, `2:41`; null once past.
export function fmtIn(iso: string, now: number): string | null {
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return null
  const minutes = Math.ceil(ms / 60_000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

// `now` (ms) lets the 5h gauge say when it resets; without it it doesn't.
function gauges(s: CardInput, fit: Fit, now?: number): Gauge[] {
  const used = value(s.ctxTokens === null ? null : fmtTokens(s.ctxTokens))
  const tokens: Row = fit.tokens
    ? [
        { ...used, tone: 'muted' },
        seg(' / ', 'muted'),
        { ...value(s.ctxWindow === null ? null : fmtTokens(s.ctxWindow)), tone: 'muted' },
      ]
    : []
  return [
    // The used figure grows from "9.5k" to "84.1k".
    { label: 'CTX', pct: s.ctxPercent, tail: tokens, steady: 6 },
    ...WINDOWS.map(({ kind, label, countdown }) => {
      const limit = s.limits.find(l => l.kind === kind)
      const resets = countdown && fit.resets && now !== undefined && limit?.resetsAt ? fmtIn(limit.resetsAt, now) : null
      return { label, pct: limit?.percentUsed ?? null, tail: resets === null ? [] : [seg(`↻ ${resets}`, 'muted')] }
    }),
  ].slice(0, fit.gauges)
}

// Without a bar the percentage sits one space past the label, so "100%" never runs into it.
const gauge = (g: Gauge, width: number | null): Row => [
  seg(g.label, 'muted'),
  spaces(1),
  ...(width === null ? percent(g.pct, 3) : [...bar(g.pct, width), spaces(1), ...percent(g.pct)]),
  ...(g.tail.length ? [spaces(2 + Math.max(0, (g.steady ?? 0) - g.tail[0]!.text.length)), ...g.tail] : []),
]

// Context takes 40% of the free cells; the 5h and 7d bars share the rest.
function split(free: number): number[] {
  const ctx = Math.round(free * 0.4)
  const five = Math.floor((free - ctx) / 2)
  return [ctx, five, free - ctx - five]
}

const upper = (v: string | null): Seg =>
  v === null ? seg(DASH, 'muted') : { text: v.toUpperCase(), tone: 'accent', bold: true }

// The rail's two ends: the model, and EFFORT / MODE.
const SHORT_EFFORT: Record<string, string> = { medium: 'med', xhigh: 'xhi' }

const ends = (s: CardInput, short = false): { left: Seg; right: Row } => ({
  left: s.model === null ? seg(DASH, 'muted') : { text: fmtModel(s.model).toUpperCase(), tone: 'text', bold: true },
  right: [upper(short && s.effort !== null ? (SHORT_EFFORT[s.effort] ?? s.effort) : s.effort), seg(' / ', 'muted'), upper(s.mode === null ? null : fmtMode(s.mode))],
})

// The rail at one fit, and whether it fits `inner` with every bar at least `minBar` cells.
function line(s: CardInput, inner: number, fit: Fit, minBar: number, now?: number): { row: Row; fits: boolean } {
  const { left, right } = ends(s, fit.shortEffort)
  const gs = gauges(s, fit, now)

  // `pad` widens both sides of every separator alike.
  const build = (widths: (number | null)[], pad = 0): Row => {
    const sep = seg(`${' '.repeat(fit.gap + pad)}${SEP}${' '.repeat(fit.gap + pad)}`, 'muted')
    return [left, ...gs.flatMap((g, i) => [sep, ...gauge(g, widths[i] ?? null)]), sep, ...right]
  }

  if (fit.bars) {
    const widths = split(inner - rowLength(build([0, 0, 0])))
    return { row: build(widths), fits: widths.every(w => w >= minBar) }
  }
  // No bars: leftover cells widen every separator by the same amount, so the gaps stay even;
  // the few that can't be shared out evenly stay at the end.
  const spare = inner - rowLength(build([null, null, null]))
  const pad = spare > 0 ? Math.floor(spare / (2 * (gs.length + 1))) : 0
  return { row: build([null, null, null], pad), fits: spare >= 0 }
}

// The first fit whose rail fits, else the last.
function pick(s: CardInput, inner: number, fits: Fit[], minBar: number, now?: number): { fit: Fit; row: Row } {
  const tries = fits.map(fit => ({ fit, ...line(s, inner, fit, minBar, now) }))
  return tries.find(t => t.fits) ?? tries[tries.length - 1]!
}

// The card's border box: its width, side padding, and the cells left inside them.
function frame(columns: number): { width: number; paddingX: number; inner: number } {
  const width = Math.max(columns, 4)
  const paddingX = columns >= 60 ? 2 : 1
  return { width, paddingX, inner: width - 2 - paddingX * 2 }
}

// The terminal's one full-width line: model | CTX bar | 5H bar | 7D bar | EFFORT / MODE.
export function buildCard(s: CardInput, columns: number, now?: number): Card {
  const { width, paddingX, inner } = frame(columns)
  const { fit, row } = pick(s, inner, TERMINAL_FITS, TERMINAL_MIN_BAR, now)
  return { width, inner, paddingX, row: clip(row, inner), fit }
}

export type FlexGauge = { label: Seg; fill: number; pct: Seg; tail: Row }

// What a surface draws. The terminal gets its cell-counted row, `width` cells wide. Any other
// surface (desktop, vscode, mobile) sets text in a proportional font, where counted cells say
// little, so it gets the parts to lay out with flex at its full width: `gap` between every two
// items, the bars taking whatever room is left when `bars`, and each gauge's `fill` in percent.
export type Rail = { paddingX: number } & (
  | { surface: 'terminal'; width: number; row: Row }
  | { surface: 'flex'; gap: number; bars: boolean; stacked: boolean; left: Seg; gauges: FlexGauge[]; right: Row }
)

export function rail(s: CardInput, surface: RenderSurface, columns: number, now?: number): Rail {
  if (surface === 'terminal') {
    const { width, paddingX, row } = buildCard(s, columns, now)
    return { surface, width, paddingX, row }
  }
  const { paddingX, inner } = frame(columns)
  const picked = pick(s, inner, FLEX_FITS, FLEX_MIN_BAR, now).fit
  const stacked = inner < FLEX_ROW_FROM
  const fit = { ...picked, bars: !stacked && (picked.bars || inner >= FLEX_BARS_FROM) }
  const { left, right } = ends(s)
  return {
    surface: 'flex',
    paddingX,
    // One gap everywhere, around each separator and inside each gauge alike: the terminal's
    // spaces around each separator, but never none.
    gap: fit.gap,
    bars: fit.bars,
    stacked,
    left,
    gauges: gauges(s, fit, now).map(g => ({ label: seg(g.label, 'muted'), fill: fillPct(g.pct), pct: pctSeg(g.pct), tail: g.tail })),
    right,
  }
}
