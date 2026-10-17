import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer } from 'claude-code'

import type { Snap } from '../types'
import { buildCard, DESKTOP_FITS, ends, fillPct, gauges, pctSeg, seg, type Row, type Seg, type Tone } from './format'

// Theme keys, not fixed colors, so the card reads on light themes as well as dark ones.
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
// The desktop's proportional text is narrower than the code font's cells, but its gaps are
// wider, so what fits is judged on bodyColumns as is. Its bars keep at least this many cells:
// below that, token counts go first, then the reset countdown.
const DESKTOP_MIN_BAR = 6

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

export const register: Register = on => {
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const data = { ...EMPTY, ...s }
    const now = await $.clock.now()
    const card = buildCard(data, e.props.bodyColumns, now)
    const box = { borderStyle: 'round', borderColor: BORDER, paddingX: card.paddingX, width: card.width } as const
    const span = (part: Seg, key?: string) => (
      <Text key={key} color={COLORS[part.tone]} bold={part.bold}>
        {part.text}
      </Text>
    )
    const spans = (row: Row) => row.map((p, j) => span(p, String(j)))

    // The desktop sets text in a proportional font, so cell-counted padding comes up short:
    // lay the same rail out with flex instead, the bars taking whatever room is left.
    if (e.surface !== 'terminal') {
      const { fit } = buildCard(data, e.props.bodyColumns, now, { minBar: DESKTOP_MIN_BAR, fits: DESKTOP_FITS })
      const sep = <Text color={COLORS.muted}>│</Text>
      const { left, right } = ends(data)
      return (
        // marginTop: a little air between the card and any row another plugin draws above it.
        // columnGap: the terminal's spaces around each │, but never none.
        <Box {...box} marginTop={1} flexDirection="row" alignItems="center" columnGap={Math.max(1, fit.gap)}>
          <Box flexShrink={0}>{span(left)}</Box>
          {gauges(data, fit, now).flatMap(g => [
            sep,
            <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={fit.bars ? 1 : 0} flexShrink={1} minWidth={0}>
              <Box flexShrink={0}>{span(seg(g.label, 'muted'))}</Box>
              {fit.bars ? (
                // A thin strip, not a run of ━: the desktop sets glyphs in a proportional font.
                <Box flexGrow={1} width={0} minWidth={3} height={1} alignItems="center">
                  <Box flexGrow={1} height={BAR_HEIGHT} backgroundColor={COLORS.track} flexDirection="row" overflow="hidden">
                    {fillPct(g.pct) > 0 ? (
                      <Box width={`${fillPct(g.pct)}%`} height="100%" backgroundColor={COLORS.accent} />
                    ) : null}
                  </Box>
                </Box>
              ) : null}
              {/* Left-aligned in a fixed slot: the same gap after every bar, whatever the digits. */}
              <Box flexShrink={0} width={4}>
                {span(pctSeg(g.pct))}
              </Box>
              {g.tail.length ? (
                <Box flexShrink={0} flexDirection="row">
                  {spans(g.tail)}
                </Box>
              ) : null}
            </Box>,
          ])}
          {sep}
          <Box flexShrink={0} flexDirection="row">
            {spans(right)}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" {...box}>
        {card.rows.map(row => (
          <Text wrap="truncate-end">
            {row.length === 0 ? ' ' : spans(row)}
          </Text>
        ))}
      </Box>
    )
  })
}
