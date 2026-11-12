import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderNode } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const props = (bodyColumns: number, extra: { isWorking?: boolean; hasSurvey?: boolean; maxRows?: number } = {}) => ({
  hasSurvey: extra.hasSurvey ?? false,
  isCollapsed: false,
  isWorking: extra.isWorking ?? false,
  maxRows: extra.maxRows ?? 20,
  bodyColumns,
  scroll: { offset: 0, bodyRows: extra.maxRows ?? 20 },
  view: {},
})

const flat = (node: RenderNode): string =>
  typeof node === 'string' ? node : ((node as { children?: RenderNode[] }).children ?? []).map(flat).join('')

// The card above the prompt, on the desktop unless told otherwise.
const draw = async ($: Engine, columns: number, extra = {}, surface: 'terminal' | 'desktop' = 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'context-gauge', surface, component: 'AbovePrompt', props: props(columns, extra) })
  const tree = await ui.drawn()
  await ui.unmount()
  const box = tree as { type: string; props?: Record<string, unknown>; children?: RenderNode[] }
  return { box, text: flat(box as RenderNode) }
}

// The terminal's row under the prompt, right of the engine's own hint, as text.
const line = async ($: Engine, columns: number, modes: string[] = [], surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'context-gauge', surface, component: 'SessionMode', props: { modes }, viewport: { columns, rows: 40 } })
  const tree = (await ui.drawn()) as { type: string; props?: Record<string, unknown>; children?: RenderNode[] }
  await ui.unmount()
  // Our row is a Box of the model, the gauges and the effort, one cell between them.
  return tree.type === 'Box' ? (tree.children ?? []).map(flat).join(' '.repeat(tree.props?.columnGap as number)) : flat(tree as RenderNode)
}

// The cells the footer leaves for the engine's hint at its left.
const RESERVE = 42

// What the engine itself answers beneath the plugin, for the events this test raises.
// `settings` stands for the merged settings.json; `/effort` writes into it as it runs.
const NOW = Date.parse('2026-10-17T12:00:00Z')

// The slash commands the engine was asked to run, in order; emptied by each engine().
const ran: string[] = []

const engine = (on: On, settings: Record<string, unknown> = {}) => {
  ran.length = 0
  const clock = mock.clock(on, { now: NOW })
  on('settings.read', () => ({ value: { ...settings } }))
  on('command.run', { command: 'effort' }, (_$, e) => {
    ran.push(`/${e.command}`)
    if (e.args) settings.effortLevel = e.args
    return { text: '' }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.PostToolUse', () => ({}))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.SessionStart', () => ({}))
  // What the engine draws of its own: its mode labels under the prompt, nothing above it.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine:${e.props.modes.join(' & ')}`}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>no band</Text>
  })
  // The pickers /model and /effort open: the test only needs to see them asked for.
  on('command.run', { command: 'model' }, (_$, e) => {
    ran.push(`/${e.command}`)
    return { text: '' }
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  return clock
}

describe('band', () => {
  test('before any data: the terminal draws one row of dashes under the prompt, and no card above it', async ($, on) => {
    engine(on)
    expect(await line($, 150)).toBe('— · ctx ━━━━━━ — · 5h — · 7d — · —')
    expect((await draw($, 150, {}, 'terminal')).text).toBe('no band')
  })

  test('before any data: the desktop draws one bordered card of dashes', async ($, on) => {
    engine(on)
    const { box, text } = await draw($, 150)
    expect(box.type).toBe('Box')
    expect(box.props?.borderStyle).toBe('round')
    expect(box.props?.borderColor).toBe('claude')
    expect(text.startsWith('—')).toBe(true)
    expect(text.endsWith('— / —')).toBe(true)
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

    expect(await line($, 150)).toBe('OPUS 5.5 · ctx ━━━━━━ 42% · 5h 31% · 7d 92% · high')
    const { text } = await draw($, 150, { isWorking: true })
    expect(text.startsWith('OPUS 5.5')).toBe(true)
    expect(text).toContain('84.1k / 200k')
    expect(text.endsWith('HIGH / AUTO')).toBe(true)
    expect(text).not.toContain('$')
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

    expect(await line($, 150)).toBe('OPUS 5.5 · ctx ━━━━━━ — · 5h 31% · 7d 92% · high')
    const { text } = await draw($, 150)
    expect(text).toContain('— / 200k')
    expect(text.endsWith('HIGH / PLAN')).toBe(true)
  })

  test('settings seed effort and mode before any request or prompt', async ($, on) => {
    engine(on, { effortLevel: 'xhigh', permissions: { defaultMode: 'acceptEdits' } })
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    expect((await draw($, 150)).text.endsWith('XHIGH / ACCEPT EDITS')).toBe(true)
    expect((await line($, 150)).endsWith(' · xhigh')).toBe(true)
  })

  test('settings that are missing, unknown or unreadable leave a dash', async ($, on) => {
    engine(on, { effortLevel: 'max', permissions: { defaultMode: 'nonsense' } })
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    expect((await draw($, 150)).text.endsWith('— / —')).toBe(true)
  })

  test('settings never overwrite what a request or a hook reported', async ($, on) => {
    engine(on, { effortLevel: 'low', permissions: { defaultMode: 'default' } })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'max', messageCount: 1 })) void _
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'auto' } as never)
    await $.session.start({ source: 'resume', cwd: '/work' } as never)
    expect((await draw($, 150)).text.endsWith('MAX / AUTO')).toBe(true)
  })

  test('/effort shows the new level at once; turn.step still has the last word', async ($, on) => {
    engine(on, { effortLevel: 'medium' })
    await $.session.start({ source: 'startup', cwd: '/work' } as never)
    await $.command.run({ command: 'effort', args: 'high' } as never)
    expect((await draw($, 150)).text.endsWith('HIGH / —')).toBe(true)

    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) void _
    expect((await draw($, 150)).text.endsWith('MEDIUM / —')).toBe(true)
  })

  test('/effort that leaves settings unchanged (a picker not yet answered) keeps the shown level', async ($, on) => {
    engine(on, { effortLevel: 'medium' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'max', messageCount: 1 })) void _
    await $.command.run({ command: 'effort', args: '' } as never)
    expect((await draw($, 150)).text.endsWith('MAX / —')).toBe(true)
  })

  test('mode follows each main-thread hook payload, not a subagent', async ($, on) => {
    engine(on)
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
    await $.classic.PostToolUse({ tool_name: 'Bash', permission_mode: 'acceptEdits' } as never)
    expect((await draw($, 150)).text.endsWith('— / ACCEPT EDITS')).toBe(true)
    await $.classic.PostToolUse({ tool_name: 'Bash', permission_mode: 'plan', agent_id: 'a1' } as never)
    expect((await draw($, 150)).text.endsWith('— / ACCEPT EDITS')).toBe(true)
  })

  test('terminal: one row that leaves the engine\'s hint its room, and the engine\'s own row where nothing fits', async ($, on) => {
    engine(on)
    for (const columns of [200, 120, 100, 80, 64]) {
      const text = await line($, columns)
      expect(text.startsWith('engine:')).toBe(false)
      expect(text.length <= columns - RESERVE).toBe(true)
    }
    expect(await line($, 44)).toBe('engine:')
    expect(await line($, 44, ['focus'])).toBe('engine:focus')
  })

  test('terminal: the engine\'s own mode labels follow the gauges', async ($, on) => {
    engine(on)
    expect(await line($, 150, ['focus', 'memory paused'])).toBe('— · ctx ━━━━━━ — · 5h — · 7d — · — · focus & memory paused')
    // They take their share of the room: without them this width keeps every gauge.
    expect(await line($, 80)).toBe('— · ctx ━━━━━━ — · 5h — · 7d — · —')
    expect(await line($, 80, ['focus', 'memory paused'])).toBe('ctx — · 5h — · focus & memory paused')
  })

  test('terminal: a click on the model or the effort opens its picker, as /model and /effort do', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'context-gauge', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: { columns: 150, rows: 40 } })
    expect((await ui.findAll({ type: 'Button' })).length).toBe(2)
    await ui.press({ key: 'model' })
    expect(ran).toEqual(['/model'])
    await ui.press({ key: 'effort' })
    expect(ran).toEqual(['/model', '/effort'])
    await ui.unmount()
  })

  test('terminal: where the model and the effort no longer fit, nothing is left to click', async ($, on) => {
    engine(on)
    await $.session.measure({
      context: { tokens: 5_000, window: 200_000, percent: 2 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 31 }, { kind: 'seven_day', percentUsed: 92 }],
      changed: ['context', 'rateLimits'],
    } as never)
    const ui = await $.ui.mount({ plugin: 'context-gauge', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: { columns: 70, rows: 40 } })
    expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
    await ui.unmount()
    expect(await line($, 70)).toBe('ctx 2% · 5h 31% · 7d 92%')
  })

  test('desktop: the row under the prompt is the engine\'s own', async ($, on) => {
    engine(on)
    expect(await line($, 150, ['focus'], 'desktop')).toBe('engine:focus')
  })

  // What the desktop shows at which width is rail()'s, tested in format.test.ts; this checks the drawing.
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
    const { box: tree } = await draw($, 150, {}, 'desktop')
    expect(tree.props?.flexDirection).toBe('row')
    expect(tree.props?.borderStyle).toBe('round')
    expect(tree.props?.marginTop).toBe(1)
    const text = flat(tree as RenderNode)
    for (const part of ['OPUS 5.5', 'CTX', '6%', '60.9k', '1.0M', '5H', '4%', '7D', '40%', 'MEDIUM', 'AUTO']) expect(text).toContain(part)
    // Each gauge's fill becomes its strip's width.
    const fills: unknown[] = []
    const walk = (n: RenderNode) => {
      if (typeof n === 'string' || !n) return
      const el = n as { props?: Record<string, unknown>; children?: RenderNode[] }
      if (typeof el.props?.width === 'string') fills.push(el.props.width)
      ;(el.children ?? []).forEach(walk)
    }
    walk(tree as RenderNode)
    expect(fills).toEqual(['6%', '4%', '40%'])
    // One gap everywhere, the terminal's spacing around each separator, and no fixed-width slots
    // padding text.
    const gaps = new Set<unknown>()
    const slots: unknown[] = []
    const walkGaps = (n: RenderNode) => {
      if (typeof n === 'string' || !n) return
      const el = n as { props?: Record<string, unknown>; children?: RenderNode[] }
      if (el.props?.columnGap !== undefined) gaps.add(el.props.columnGap)
      if (typeof el.props?.width === 'number' && el !== tree) slots.push(el.props.width)
      ;(el.children ?? []).forEach(walkGaps)
    }
    walkGaps(tree as RenderNode)
    expect([...gaps]).toEqual([2])
    expect(slots.filter(w => w !== 0)).toEqual([])
    // A part made of several spans is one Text, so the spaces in " / " survive a flex layout.
    const texts: string[] = []
    const walkTexts = (n: RenderNode) => {
      if (typeof n === 'string' || !n) return
      const el = n as { type?: string; children?: RenderNode[] }
      if (el.type === 'Text') return void texts.push(flat(n))
      ;(el.children ?? []).forEach(walkTexts)
    }
    walkTexts(tree as RenderNode)
    expect(texts).toContain('60.9k / 1.0M')
    expect(texts).toContain('MEDIUM / AUTO')
  })

  test('desktop and vscode: one row, or two on a narrow pane, every value in it, never a fixed width', async ($, on) => {
    engine(on)
    for (const surface of ['desktop', 'vscode'] as const) {
      for (const columns of [200, 64, 36, 24]) {
        const { box } = await draw($, columns, {}, surface as 'desktop')
        // The card picks its rows: the desktop's own wrapping broke lines with room to spare.
        expect(box.props?.flexDirection).toBe(columns < 44 ? 'column' : 'row')
        expect(box.props?.flexWrap).toBeUndefined()
        // bodyColumns are the code font's cells: VS Code counted 36 across a 490px panel.
        expect(box.props?.width).toBeUndefined()
        expect(box.props?.marginTop).toBe(1)
        const text = flat(box as RenderNode)
        for (const part of ['CTX', '5H', '7D', '— / —']) expect(text).toContain(part)
        expect(text.startsWith('—')).toBe(true)
      }
    }
  })

  test('a new or resumed session shows its mode before the first prompt', async ($, on) => {
    engine(on)
    await $.classic.SessionStart({ source: 'resume', permission_mode: 'plan' } as never)
    expect((await draw($, 150)).text.endsWith('— / PLAN')).toBe(true)
  })

  test('a measurement with no 5h/7d readings keeps the last ones', async ($, on) => {
    engine(on)
    const measure = (rateLimits: { kind: string; percentUsed: number }[]) =>
      $.session.measure({ context: { tokens: 5_000, window: 200_000, percent: 2 }, rateLimits, changed: ['context', 'rateLimits'] } as never)
    await measure([{ kind: 'five_hour', percentUsed: 31 }, { kind: 'seven_day', percentUsed: 12 }])
    await measure([])
    expect(await line($, 150)).toContain('5h 31% · 7d 12%')
    const { text } = await draw($, 150)
    expect(text).toContain('5H')
    expect(text).toContain('31%')
    expect(text).toContain('12%')
  })

  test('5H says when it resets, 7D does not, and the countdown moves with the clock', async ($, on) => {
    const clock = engine(on)
    const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
    await $.session.measure({
      context: { tokens: 5_000, window: 200_000, percent: 2 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 62, resetsAt: at(80) },
        { kind: 'seven_day', percentUsed: 12, resetsAt: at(3 * 24 * 60 + 4 * 60) },
      ],
      changed: ['context', 'rateLimits'],
    } as never)
    let row = await line($, 160)
    expect(row).toContain('5h 62% ↻ 1:20 → ')
    expect(row).toContain(' · 7d 12% · ')
    expect(row).not.toContain('76:00')
    const desktop = (await draw($, 160)).text
    expect(desktop).toContain('↻ 1:20')
    expect(desktop).not.toContain('76:00')
    await clock.advance(60 * 60_000)
    row = await line($, 160)
    expect(row).toContain('5h 62% ↻ 0:20 → ')
    await clock.advance(30 * 60_000)
    expect(await line($, 160)).toContain('5h 62% · 7d')
  })

  test('yields the band to a survey', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'context-gauge', surface: 'desktop', component: 'AbovePrompt', props: props(100, { hasSurvey: true }) })
    expect(await ui.find({ type: 'Text', text: /no band/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeUndefined()
    await ui.unmount()
  })
})
