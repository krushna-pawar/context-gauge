import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer } from 'claude-code'

import type { Snap } from '../types'
import { footer, FOOTER_DEFAULTS, rail, type FooterOptions, type Row, type Seg, type Tone } from './format'

// Theme keys, not fixed colors, so the gauges read on light themes as well as dark ones.
const COLORS: Record<Tone, string> = {
  text: 'text',
  muted: 'inactive',
  accent: 'claude',
  critical: 'error',
  track: 'subtle',
}
const BORDER = 'claude'
// The desktop's bar thickness, in rows.
const BAR_HEIGHT = 0.25
// The shortest bar worth drawing, in cells: shorter reads as a dot.
const BAR_MIN = 4
// The terminal's footer shares its row with Claude Code's own hint at the left, whose length the
// engine does not report. These are the cells of that hint at its shortest in each permission
// mode, its indent included (`  ⏸ manual mode on · ? for shortcuts`); the footer keeps clear of
// them. Where the hint is longer, or the mode has moved since the last prompt, the engine
// shortens the hint itself.
const HINT_CELLS: Record<string, number> = { default: 37, acceptEdits: 41, plan: 37, auto: 38, bypassPermissions: 47 }
const HINT_CELLS_UNKNOWN = 41
// The least room between the hint and the footer.
const FOOTER_GAP = 2
// The columns assumed where the terminal has not measured yet.
const FOOTER_COLUMNS = 80

const EMPTY: Snap = {
  model: null,
  effort: null,
  mode: null,
  ctxTokens: null,
  ctxWindow: null,
  ctxPercent: null,
  limits: [],
}

const SNAP = { plugin: 'context-gauge', key: 'snap' } as const
const snap = atom(SNAP, EMPTY)

const patch = ($: EngineInterface, change: Partial<Snap>) =>
  update($, snap, s => ({ ...EMPTY, ...s, ...change }))

// The status line's figures, as pushed by session.measure or read by $.session.usage().
// The 5h/7d windows are the account's: a response that reports none (a fresh or resumed
// session before its first request) leaves the last readings standing.
const fromUsage = (u: Pick<SessionUsage, 'context' | 'rateLimits'>): Partial<Snap> => ({
  ctxTokens: u.context.tokens ?? null,
  ctxWindow: u.context.window ?? null,
  ctxPercent: u.context.percent ?? null,
  ...(u.rateLimits.length ? { limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })) } : {}),
})

const model = ($: EngineInterface) => $.session.model().catch(() => null)

// What settings.json may hold (its schema): `max` is session-only and never written there.
const EFFORTS = ['low', 'medium', 'high', 'xhigh']
const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'delegate']

const settings = ($: EngineInterface) => $.settings.read().catch(() => null)

const effortIn = (s: Record<string, unknown> | null): string | null =>
  typeof s?.effortLevel === 'string' && EFFORTS.includes(s.effortLevel) ? s.effortLevel : null

// `manual` is the settings alias for `default`.
function modeIn(s: Record<string, unknown> | null): string | null {
  const m = (s?.permissions as { defaultMode?: unknown } | undefined)?.defaultMode
  if (m === 'manual') return 'default'
  return typeof m === 'string' && MODES.includes(m) ? m : null
}

// Main thread only: a subagent's payload carries its own agent_id.
const noteMode = async ($: EngineInterface, e: { agent_id?: string; permission_mode?: string }) => {
  if (e.agent_id === undefined && e.permission_mode) await patch($, { mode: e.permission_mode })
}

// Redraws once a minute so the reset countdowns stay current; one per loaded module.
let tick: Timer | undefined

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
// A threshold in percent: anything else, as a number out of range, falls back.
const pct = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : fallback)

export const register: Register = (on, options) => {
  const shown: FooterOptions = {
    model: bool(options?.showModel, FOOTER_DEFAULTS.model),
    effort: bool(options?.showEffort, FOOTER_DEFAULTS.effort),
    week: bool(options?.showWeek, FOOTER_DEFAULTS.week),
    clock: bool(options?.showResetClock, FOOTER_DEFAULTS.clock),
    noticeAt: pct(options?.noticeAt, FOOTER_DEFAULTS.noticeAt),
    alertAt: pct(options?.alertAt, FOOTER_DEFAULTS.alertAt),
  }

  on('session.start', async ($, e, next) => {
    tick ??= $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    const [name, usage, set] = await Promise.all([model($), $.session.usage().catch(() => null), settings($)])
    // Settings only seed what nothing has reported yet: a request's effort and a hook's mode are truer.
    await update($, snap, s => {
      const was = { ...EMPTY, ...s }
      return {
        ...was,
        model: name,
        ...(usage ? fromUsage(usage) : {}),
        effort: was.effort ?? effortIn(set),
        mode: was.mode ?? modeIn(set),
      }
    })
    return next(e)
  })

  // /clear empties the conversation, not the account: the 5h/7d windows, model, effort and mode stand.
  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await patch($, { ctxTokens: null, ctxPercent: null })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await patch($, { model: await model($) })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await patch($, { effort: e.effort === undefined ? null : String(e.effort) })
    return yield* next(e)
  })

  // `next(e)` may resolve once the picker opens, before a choice: only a setting that moved is news.
  // turn.step still has the last word on what a request actually used.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const before = effortIn(await settings($))
    const out = await next(e)
    const after = effortIn(await settings($))
    if (after !== null && after !== before) await patch($, { effort: after })
    return out
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await patch($, fromUsage(e))
    return next(e)
  })

  // Permission mode rides the classic hook payloads, SessionStart's included, so a new or
  // resumed session shows it before the first prompt; no event fires on Shift+Tab itself.
  on('classic.SessionStart', async ($, e, next) => (await noteMode($, e), next(e)))
  on('classic.UserPromptSubmit', async ($, e, next) => (await noteMode($, e), next(e)))
  on('classic.PostToolUse', async ($, e, next) => (await noteMode($, e), next(e)))
  on('classic.Stop', async ($, e, next) => (await noteMode($, e), next(e)))

  // The terminal draws the gauges at the right of the row under the prompt, after any mode
  // labels the engine has there (`focus`, `memory paused`); every other surface keeps the card.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const modes = e.props.modes.join(' & ')
    const hint = (s?.mode ? HINT_CELLS[s.mode] : undefined) ?? HINT_CELLS_UNKNOWN
    const room = (e.viewport?.columns ?? FOOTER_COLUMNS) - hint - FOOTER_GAP - (modes ? modes.length + 2 : 0)
    const row = footer({ ...EMPTY, ...s }, room, await $.clock.now(), shown)
    if (!row.length) return next(e)

    // The model and the effort are Buttons: a click opens Claude Code's own picker for it, as
    // /model and /effort do. Between them, runs of plain spans are one Text each. The spaces at a
    // run's ends would be dropped where it meets a Button, so a Box of two cells stands in for
    // the gap between groups.
    const span = (part: Seg, key: string) => (
      <Text key={key} color={COLORS[part.tone]} bold={part.bold}>
        {part.text}
      </Text>
    )
    const items: Seg[][] = []
    for (const part of modes ? [...row, { text: `  ${modes}`, tone: 'muted' as const }] : row) {
      const last = items[items.length - 1]
      if (part.press || !last || last[0]!.press) items.push([part])
      else last.push(part)
    }
    return (
      <Box flexDirection="row" columnGap={2}>
        {items.map((run, i) => {
          const press = run[0]!.press
          if (press) {
            return (
              <Button key={press} plain onPress={() => void $.command.run({ command: press, args: '' }).catch(() => {})}>
                {span(run[0]!, press)}
              </Button>
            )
          }
          // Only the ends that meet a Button: every other space is the run's own.
          const head = i > 0
          const tail = i < items.length - 1
          const trimmed = run.map((part, j) => {
            let text = part.text
            if (head && j === 0) text = text.trimStart()
            if (tail && j === run.length - 1) text = text.trimEnd()
            return { ...part, text }
          })
          return <Text key={String(i)}>{trimmed.map((part, j) => span(part, String(j)))}</Text>
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface === 'terminal') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const r = rail({ ...EMPTY, ...s }, e.props.bodyColumns, await $.clock.now())
    const box = { borderStyle: 'round', borderColor: BORDER, paddingX: r.paddingX } as const
    const span = (part: Seg, key?: string) => (
      <Text key={key} color={COLORS[part.tone]} bold={part.bold}>
        {part.text}
      </Text>
    )
    // One Text around the spans: as flex items of their own, the spaces at their ends (" / ") are dropped.
    const spans = (row: Row) => <Text>{row.map((p, j) => span(p, String(j)))}</Text>

    // The card picks its rows itself: the desktop's own wrapping broke a line with room to
    // spare. One row that never wraps, or, on a narrow pane, two: model and EFFORT / MODE,
    // then the gauges. No width: bodyColumns are the code font's cells, and VS Code counted
    // 36 across a 490px panel.
    const sep = <Text color={COLORS.muted}>│</Text>
    const gauges = r.gauges.map((g, i) => (
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" columnGap={r.gap}>
        {i > 0 ? sep : null}
        {/* Centered: without bars, the room left over sits evenly either side of each │. */}
        <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" justifyContent="center" columnGap={r.gap}>
          <Box flexShrink={0}>{span(g.label)}</Box>
          {r.bars ? (
            // A thin strip, not a run of ━: the desktop sets glyphs in a proportional font.
            // It takes the room left, never less than BAR_MIN, so never a dot. (Hiding a bar
            // too short to show, by wrapping it out of sight, drew none at all on the desktop.)
            <Box flexGrow={1} width={0} minWidth={BAR_MIN} height={1} alignItems="center">
              <Box flexGrow={1} height={BAR_HEIGHT} backgroundColor={COLORS.track} flexDirection="row" overflow="hidden">
                {g.fill > 0 ? (
                  <Box width={`${g.fill}%`} height="100%" backgroundColor={COLORS.accent} />
                ) : null}
              </Box>
            </Box>
          ) : null}
          <Box flexShrink={0}>{span(g.pct)}</Box>
          {g.tail.length ? <Box flexShrink={0}>{spans(g.tail)}</Box> : null}
        </Box>
      </Box>
    ))
    const left = <Box flexShrink={0}>{span(r.left)}</Box>
    const right = <Box flexShrink={0}>{spans(r.right)}</Box>
    // marginTop: air between the card and any row drawn above it.
    if (r.stacked) {
      return (
        <Box {...box} marginTop={1} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={r.gap}>
            {left}
            {right}
          </Box>
          <Box flexDirection="row" alignItems="center" columnGap={r.gap}>
            {gauges}
          </Box>
        </Box>
      )
    }
    return (
      <Box {...box} marginTop={1} flexDirection="row" alignItems="center" columnGap={r.gap}>
        {left}
        {sep}
        <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" columnGap={r.gap}>
          {gauges}
        </Box>
        {sep}
        {right}
      </Box>
    )
  })
}
