import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderNode } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const props = (bodyColumns: number, extra: { isWorking?: boolean; hasSurvey?: boolean; maxRows?: number } = {}) => ({
  hasSurvey: extra.hasSurvey ?? false,
  isWorking: extra.isWorking ?? false,
  maxRows: extra.maxRows ?? 20,
  bodyColumns,
  scroll: { offset: 0, bodyRows: extra.maxRows ?? 20 },
  view: {},
})

const flat = (node: RenderNode): string =>
  typeof node === 'string' ? node : ((node as { children?: RenderNode[] }).children ?? []).map(flat).join('')

const draw = async ($: Engine, columns: number, extra = {}) => {
  const ui = await $.ui.mount({ plugin: 'main-card', surface: 'terminal', component: 'AbovePrompt', props: props(columns, extra) })
  const tree = await ui.drawn()
  await ui.unmount()
  const box = tree as { type: string; props?: Record<string, unknown>; children?: RenderNode[] }
  return { box, rows: (box.children ?? []).map(flat) }
}

// What the engine itself answers beneath the plugin, for the events this test raises.
// `settings` stands for the merged settings.json; `/effort` writes into it as it runs.
const engine = (on: On, settings: Record<string, unknown> = {}) => {
  on('settings.read', () => ({ value: { ...settings } }))
  on('command.run', { command: 'effort' }, (_$, e) => {
    if (e.args) settings.effortLevel = e.args
    return { text: '' }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.PostToolUse', () => ({}))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.UserPromptSubmit', () => ({}))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
}

const inner = (box: { props?: Record<string, unknown> }) =>
  (box.props?.width as number) - 2 - 2 * (box.props?.paddingX as number)

describe('band', () => {
  test('before any data: one bordered row of dashes at the full body width', async ($, on) => {
    engine(on)
    const { box, rows } = await draw($, 150)
    expect(box.type).toBe('Box')
    expect(box.props?.borderStyle).toBe('round')
    expect(box.props?.borderColor).toBe('#D97757')
    expect(box.props?.width).toBe(150)
    expect(rows.length).toBe(1)
    expect(rows[0]!.startsWith('—  │  CTX ')).toBe(true)
    expect(rows[0]!.endsWith('— / —')).toBe(true)
  })

  test('real events fill it in', async ($, on) => {
    engine(on)

    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) void _
    // A subagent's request does not change the main thread's effort.
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'x', effort: 'low', messageCount: 1, agentId: 'a1' })) void _
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'auto' } as never)
    await $.session.measure({
      context: { tokens: 84_123, window: 200_000, percent: 42 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 31 },
        { kind: 'seven_day', percentUsed: 92 },
      ],
      cost: { usd: 1.844 },
      changed: ['context', 'rateLimits', 'cost'],
    })

    const { box, rows } = await draw($, 150, { isWorking: true })
    expect(rows.length).toBe(1)
    expect(rows[0]!.length).toBe(inner(box))
    expect(rows[0]!).toMatch(/^OPUS 5\.5  │  CTX ━+  42%   84\.1k \/ 200k  │  5H ━+  31%  │  7D ━+  92%  │  HIGH \/ AUTO$/)
    expect(rows[0]!).not.toContain('$')
  })

  test('/clear empties the context but keeps 5H/7D, model, effort and mode', async ($, on) => {
    engine(on)
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) void _
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' } as never)
    await $.session.measure({
      context: { tokens: 84_123, window: 200_000, percent: 42 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 31 },
        { kind: 'seven_day', percentUsed: 92 },
      ],
      cost: { usd: 1.844 },
      changed: ['context', 'rateLimits', 'cost'],
    })

    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    await $.session.start({ source: 'clear', cwd: '/work' } as never)

    const { rows } = await draw($, 150)
    expect(rows[0]!).toMatch(/^OPUS 5\.5  │  CTX ━+ +— +— \/ 200k  │  5H ━+  31%  │  7D ━+  92%  │  HIGH \/ PLAN$/)
  })

  test('settings seed effort and mode before any request or prompt', async ($, on) => {
    engine(on, { effortLevel: 'xhigh', permissions: { defaultMode: 'acceptEdits' } })
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    const { rows } = await draw($, 150)
    expect(rows[0]!.endsWith('XHIGH / ACCEPT EDITS')).toBe(true)
  })

  test('settings that are missing, unknown or unreadable leave a dash', async ($, on) => {
    engine(on, { effortLevel: 'max', permissions: { defaultMode: 'nonsense' } })
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    expect((await draw($, 150)).rows[0]!.endsWith('— / —')).toBe(true)
  })

  test('settings never overwrite what a request or a hook reported', async ($, on) => {
    engine(on, { effortLevel: 'low', permissions: { defaultMode: 'default' } })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'max', messageCount: 1 })) void _
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'auto' } as never)
    await $.session.start({ source: 'resume', cwd: '/work' } as never)
    expect((await draw($, 150)).rows[0]!.endsWith('MAX / AUTO')).toBe(true)
  })

  test('/effort shows the new level at once; turn.step still has the last word', async ($, on) => {
    engine(on, { effortLevel: 'medium' })
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    await $.command.run({ command: 'effort', args: 'high' } as never)
    expect((await draw($, 150)).rows[0]!.endsWith('HIGH / —')).toBe(true)

    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) void _
    expect((await draw($, 150)).rows[0]!.endsWith('MEDIUM / —')).toBe(true)
  })

  test('/effort that leaves settings unchanged (a picker not yet answered) keeps the shown level', async ($, on) => {
    engine(on, { effortLevel: 'medium' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'max', messageCount: 1 })) void _
    await $.command.run({ command: 'effort', args: '' } as never)
    expect((await draw($, 150)).rows[0]!.endsWith('MAX / —')).toBe(true)
  })

  test('mode follows each main-thread hook payload, not a subagent', async ($, on) => {
    engine(on)
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
    await $.classic.PostToolUse({ tool_name: 'Bash', permission_mode: 'acceptEdits' } as never)
    expect((await draw($, 150)).rows[0]!.endsWith('— / ACCEPT EDITS')).toBe(true)
    await $.classic.PostToolUse({ tool_name: 'Bash', permission_mode: 'plan', agent_id: 'a1' } as never)
    expect((await draw($, 150)).rows[0]!.endsWith('— / ACCEPT EDITS')).toBe(true)
  })

  test('one row at every width, never wider than the box', async ($, on) => {
    engine(on)
    for (const columns of [200, 100, 64, 44, 32]) {
      const { box, rows } = await draw($, columns)
      expect(box.props?.width).toBe(columns)
      expect(rows.length).toBe(1)
      expect(rows[0]!.length <= inner(box)).toBe(true)
    }
  })

  test('desktop: a flex row that fills the box, with every value', async ($, on) => {
    engine(on)
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) void _
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'auto' } as never)
    await $.session.measure({
      context: { tokens: 60_900, window: 1_000_000, percent: 6 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 4 },
        { kind: 'seven_day', percentUsed: 40 },
      ],
      changed: ['context', 'rateLimits'],
    } as never)
    const ui = await $.ui.mount({ plugin: 'main-card', surface: 'desktop', component: 'AbovePrompt', props: props(150) })
    const tree = (await ui.drawn()) as { type: string; props?: Record<string, unknown>; children?: RenderNode[] }
    await ui.unmount()
    expect(tree.props?.flexDirection).toBe('row')
    expect(tree.props?.width).toBe(150)
    expect(tree.props?.borderStyle).toBe('round')
    const text = flat(tree as RenderNode)
    for (const part of ['OPUS 5.5', 'CTX', '6%', '60.9k', '1.0M', '5H', '4%', '7D', '40%', 'MEDIUM', 'AUTO']) expect(text).toContain(part)
    // The 4% bar still shows a filled part.
    const fills: unknown[] = []
    const walk = (n: RenderNode) => {
      if (typeof n === 'string' || !n) return
      const el = n as { props?: Record<string, unknown>; children?: RenderNode[] }
      if (typeof el.props?.width === 'string') fills.push(el.props.width)
      ;(el.children ?? []).forEach(walk)
    }
    walk(tree as RenderNode)
    expect(fills).toEqual(['6%', '4%', '40%'])
  })

  test('desktop: narrow widths still draw one row', async ($, on) => {
    engine(on)
    for (const columns of [200, 64, 32]) {
      const ui = await $.ui.mount({ plugin: 'main-card', surface: 'desktop', component: 'AbovePrompt', props: props(columns) })
      const tree = (await ui.drawn()) as { props?: Record<string, unknown> }
      await ui.unmount()
      expect(tree.props?.flexDirection).toBe('row')
    }
  })

  test('yields the band to a survey', async ($, on) => {
    engine(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>survey</Text>
    })
    const ui = await $.ui.mount({ plugin: 'main-card', surface: 'terminal', component: 'AbovePrompt', props: props(100, { hasSurvey: true }) })
    expect(await ui.find({ type: 'Text', text: /survey/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeUndefined()
    await ui.unmount()
  })
})
