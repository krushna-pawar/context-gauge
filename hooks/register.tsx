import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer } from 'claude-code'

import type { Snap } from '../types'
import { footer, FOOTER_DEFAULTS, isZone, rail, type FooterOptions, type Row, type Seg, type Tone } from './format'

const COLORS: Record<Tone, string> = { text: 'text', muted: 'inactive', accent: 'claude', critical: 'error', track: 'subtle' }

// The footer shares its row with Claude Code's own hint, whose length the engine does not report.
// These are that hint's cells at its shortest in each permission mode (`  ⏸ manual mode on · ? for
// shortcuts`); where it is longer, the engine shortens it.
const HINT_CELLS: Record<string, number> = { default: 37, acceptEdits: 41, plan: 37, auto: 38, bypassPermissions: 47 }
// A gap of 2 after the hint, and the 2 cells the engine keeps empty at the row's right edge.
const FOOTER_MARGINS = 4

const EMPTY: Snap = { model: null, effort: null, mode: null, ctxTokens: null, ctxWindow: null, ctxPercent: null, limits: [] }
const snap = atom({ plugin: 'context-gauge', key: 'snap' } as const, EMPTY)

const patch = ($: EngineInterface, change: Partial<Snap>) => update($, snap, s => ({ ...EMPTY, ...s, ...change }))

// A response that reports no 5h/7d windows (a session before its first request) keeps the last readings.
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fromUsage = (u: Pick<SessionUsage, 'context' | 'rateLimits'>): Partial<Snap> => {
  const limits = u.rateLimits.filter(r => num(r.percentUsed) !== null).map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
  return {
    ctxTokens: num(u.context.tokens),
    ctxWindow: num(u.context.window),
    ctxPercent: num(u.context.percent),
    ...(limits.length ? { limits } : {}),
  }
}

const model = ($: EngineInterface) => $.session.model().catch(() => null)
const settings = ($: EngineInterface) => $.settings.read().catch(() => null)

const EFFORTS = ['low', 'medium', 'high', 'xhigh']
const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'delegate']

const effortIn = (s: Record<string, unknown> | null): string | null =>
  typeof s?.effortLevel === 'string' && EFFORTS.includes(s.effortLevel) ? s.effortLevel : null

function modeIn(s: Record<string, unknown> | null): string | null {
  const m = (s?.permissions as { defaultMode?: unknown } | undefined)?.defaultMode
  if (m === 'manual') return 'default'
  return typeof m === 'string' && MODES.includes(m) ? m : null
}

const noteMode = async ($: EngineInterface, e: { agent_id?: string; permission_mode?: string }) => {
  if (e.agent_id === undefined && e.permission_mode) await patch($, { mode: e.permission_mode })
}

let tick: Timer | undefined

export const register: Register = (on, options) => {
  const percent = (v: unknown, fallback: number) => (typeof v === 'number' ? Math.min(100, Math.max(0, v)) : fallback)
  const alertAt = percent(options?.alertAt, FOOTER_DEFAULTS.alertAt)
  const shown: FooterOptions = {
    model: options?.showModel !== false,
    effort: options?.showEffort === true,
    week: options?.showWeek !== false,
    clock: options?.showResetClock !== false,
    noticeAt: Math.min(percent(options?.noticeAt, FOOTER_DEFAULTS.noticeAt), alertAt),
    alertAt,
    hour12: options?.clockStyle === '12-hour' || (options?.clockStyle !== '24-hour' && FOOTER_DEFAULTS.hour12),
    timeZone: typeof options?.timeZone === 'string' && isZone(options.timeZone.trim()) ? options.timeZone.trim() : '',
    utc: FOOTER_DEFAULTS.utc,
  }

  on('session.start', async ($, e, next) => {
    tick ??= $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    const [name, usage, set] = await Promise.all([model($), $.session.usage().catch(() => null), settings($)])
    await update($, snap, s => {
      const was = { ...EMPTY, ...s }
      return { ...was, model: name, ...(usage ? fromUsage(usage) : {}), effort: was.effort ?? effortIn(set), mode: was.mode ?? modeIn(set) }
    })
    return next(e)
  })

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

  on('classic.SessionStart', async ($, e, next) => (await noteMode($, e), next(e)))
  on('classic.UserPromptSubmit', async ($, e, next) => (await noteMode($, e), next(e)))
  on('classic.PostToolUse', async ($, e, next) => (await noteMode($, e), next(e)))
  on('classic.Stop', async ($, e, next) => (await noteMode($, e), next(e)))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = { ...EMPTY, ...(await read($, snap)) }
    const modes = e.props.modes.join(' & ')
    const room = (e.viewport?.columns ?? 80) - ((s.mode && HINT_CELLS[s.mode]) || 41) - FOOTER_MARGINS - (modes ? modes.length + 2 : 0)
    const groups = footer(s, room, await $.clock.now(), shown)
    if (!groups.length) return next(e)
    if (modes) groups.push([{ text: modes, tone: 'muted' }])
    return (
      <Box flexDirection="row" columnGap={2}>
        {groups.map((group, i) => {
          const press = group[0]!.press
          const spans = group.map((p, j) => (
            <Text key={String(j)} color={COLORS[p.tone]} bold={p.bold}>
              {p.text}
            </Text>
          ))
          return press ? (
            <Button key={press} plain onPress={() => void $.command.run({ command: press, args: '' }).catch(() => $.ui.toast(`Couldn't open the picker. Type /${press} instead.`))}>
              {spans}
            </Button>
          ) : (
            <Text key={String(i)}>{spans}</Text>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface === 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const r = rail({ ...EMPTY, ...(await read($, snap)) }, e.props.bodyColumns, await $.clock.now())
    const span = (part: Seg, key?: string) => (
      <Text key={key} color={COLORS[part.tone]} bold={part.bold}>
        {part.text}
      </Text>
    )
    // One Text around the spans: as flex items of their own, the spaces at their ends (" / ") are dropped.
    const spans = (row: Row) => <Text>{row.map((p, j) => span(p, String(j)))}</Text>
    const sep = <Text color={COLORS.muted}>│</Text>
    const gauges = r.gauges.map((g, i) => (
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" columnGap={r.gap}>
        {i > 0 ? sep : null}
        <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" justifyContent="center" columnGap={r.gap}>
          <Box flexShrink={0}>{span(g.label)}</Box>
          {r.bars ? (
            // A thin strip, not ━ glyphs (the font is proportional), never under 4 cells: shorter reads as a dot.
            <Box flexGrow={1} width={0} minWidth={4} height={1} alignItems="center">
              <Box flexGrow={1} height={0.25} backgroundColor={COLORS.track} flexDirection="row" overflow="hidden">
                {g.fill > 0 ? <Box width={`${g.fill}%`} height="100%" backgroundColor={COLORS.accent} /> : null}
              </Box>
            </Box>
          ) : null}
          <Box flexShrink={0}>{span(g.pct)}</Box>
          {g.tail.length ? <Box flexShrink={0}>{spans(g.tail)}</Box> : null}
        </Box>
      </Box>
    ))
    const box = { borderStyle: 'round', borderColor: 'claude', paddingX: r.paddingX, marginTop: 1 } as const
    const left = <Box flexShrink={0}>{span(r.left)}</Box>
    const right = <Box flexShrink={0}>{spans(r.right)}</Box>
    if (r.stacked) {
      return (
        <Box {...box} flexDirection="column">
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
      <Box {...box} flexDirection="row" alignItems="center" columnGap={r.gap}>
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
