import type { Snap } from '../types'

export type Tone = 'text' | 'muted' | 'accent' | 'critical' | 'track'
export type Seg = { text: string; tone: Tone; bold?: boolean }
export type Row = Seg[]
export type CardInput = Snap
export type Card = { width: number; inner: number; paddingX: number; rows: Row[]; fit: Fit }

const MIN_BAR = 3
// The least share of a bar any use fills, so 4% never reads as empty.
const MIN_FILL = 2
const CRITICAL = 90
const DASH = '—'

const WINDOWS: [kind: string, label: string][] = [
  ['five_hour', '5H'],
  ['seven_day', '7D'],
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

// How much of the rail survives as the band narrows, roomiest first.
// `resets`: the 5H gauge's reset countdown.
export type Fit = { gap: number; tokens: boolean; resets: boolean; bars: boolean }
const FITS: Fit[] = [
  { gap: 2, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: true, resets: true, bars: true },
  { gap: 1, tokens: false, resets: false, bars: true },
  { gap: 1, tokens: false, resets: false, bars: false },
  { gap: 0, tokens: false, resets: false, bars: false },
]

// The desktop keeps the 5H countdown a step longer than the token count.
const DESKTOP_FITS: Fit[] = [
  FITS[0]!,
  FITS[1]!,
  { gap: 1, tokens: false, resets: true, bars: true },
  ...FITS.slice(2),
]

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
    ...WINDOWS.map(([kind, label]) => {
      const limit = s.limits.find(l => l.kind === kind)
      // Only the 5-hour window shows its reset: the 7-day one is days off and rarely the question.
      const resets = kind === 'five_hour' && fit.resets && now !== undefined && limit?.resetsAt ? fmtIn(limit.resetsAt, now) : null
      return { label, pct: limit?.percentUsed ?? null, tail: resets === null ? [] : [seg(`↻ ${resets}`, 'muted')] }
    }),
  ]
}

const gauge = (g: Gauge, width: number | null): Row => [
  seg(g.label, 'muted'),
  ...(width === null ? [] : [spaces(1), ...bar(g.pct, width), spaces(1)]),
  ...percent(g.pct),
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
const ends = (s: CardInput): { left: Seg; right: Row } => ({
  left: s.model === null ? seg(DASH, 'muted') : { text: fmtModel(s.model).toUpperCase(), tone: 'text', bold: true },
  right: [upper(s.effort), seg(' / ', 'muted'), upper(s.mode === null ? null : fmtMode(s.mode))],
})

function line(s: CardInput, inner: number, fit: Fit, minBar: number, now?: number, force = false): Row | null {
  const sep = seg(`${' '.repeat(fit.gap)}│${' '.repeat(fit.gap)}`, 'muted')
  const { left, right } = ends(s)
  const gs = gauges(s, fit, now)

  // `pads` widens each separator's two sides, so leftover cells spread evenly rather than pool.
  const build = (widths: (number | null)[], pads: number[] = []): Row => {
    const sepAt = (i: number) => [spaces(pads[2 * i] ?? 0), sep, spaces(pads[2 * i + 1] ?? 0)]
    return [left, ...gs.flatMap((g, i) => [...sepAt(i), ...gauge(g, widths[i] ?? null)]), ...sepAt(gs.length), ...right]
  }

  if (fit.bars) {
    const free = inner - rowLength(build([0, 0, 0]))
    const widths = split(free)
    if (widths.some(w => w < minBar)) return null
    return build(widths)
  }
  const pad = inner - rowLength(build([null, null, null]))
  if (pad < 0 && !force) return null
  const slots = (gs.length + 1) * 2
  return build([null, null, null], Array.from({ length: slots }, (_, i) => Math.floor(Math.max(0, pad) / slots) + (i < Math.max(0, pad) % slots ? 1 : 0)))
}

// One full-width line: model │ CTX bar │ 5H bar │ 7D bar │ EFFORT / MODE.
// `minBar`: the fewest cells a bar may have before the next fit is tried; `fits`: the fits to try.
export function buildCard(
  s: CardInput,
  columns: number,
  now?: number,
  { minBar = MIN_BAR, fits = FITS }: { minBar?: number; fits?: Fit[] } = {},
): Card {
  const width = Math.max(columns, 4)
  const paddingX = columns >= 60 ? 2 : 1
  const inner = width - 2 - paddingX * 2
  for (const fit of fits) {
    const row = line(s, inner, fit, minBar, now)
    if (row) return { width, inner, paddingX, rows: [clip(row, inner)], fit }
  }
  const fit = fits[fits.length - 1]!
  return { width, inner, paddingX, rows: [clip(line(s, inner, fit, minBar, now, true)!, inner)], fit }
}

// The desktop's proportional text is narrower than the code font's cells, but its gaps are
// wider, so what fits is judged on bodyColumns as is. Its bars keep at least this many cells:
// below that, token counts go first, then the reset countdown.
const DESKTOP_MIN_BAR = 6

export type FlexGauge = { label: Seg; fill: number; pct: Seg; tail: Row }

// What a surface draws. The terminal gets cell-counted rows. Any other surface (desktop,
// vscode, mobile) sets text in a proportional font, where cell-counted padding comes up short,
// so it gets the parts to lay out with flex: `gap` between every two items, the bars taking
// whatever room is left when `bars`, and each gauge's `fill` in percent.
export type Rail = { width: number; paddingX: number } & (
  | { surface: 'terminal'; rows: Row[] }
  | { surface: 'flex'; gap: number; bars: boolean; left: Seg; gauges: FlexGauge[]; right: Row }
)

export function rail(s: CardInput, surface: string, columns: number, now?: number): Rail {
  const card = buildCard(s, columns, now)
  const box = { width: card.width, paddingX: card.paddingX }
  if (surface === 'terminal') return { ...box, surface: 'terminal', rows: card.rows }
  const { fit } = buildCard(s, columns, now, { minBar: DESKTOP_MIN_BAR, fits: DESKTOP_FITS })
  const { left, right } = ends(s)
  return {
    ...box,
    surface: 'flex',
    // One gap everywhere, around each │ and inside each gauge alike: the terminal's spaces
    // around each │, but never none.
    gap: Math.max(1, fit.gap),
    bars: fit.bars,
    left,
    gauges: gauges(s, fit, now).map(g => ({ label: seg(g.label, 'muted'), fill: fillPct(g.pct), pct: pctSeg(g.pct), tail: g.tail })),
    right,
  }
}
