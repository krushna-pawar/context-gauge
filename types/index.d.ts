export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snap = {
  model: string | null
  effort: string | null
  mode: string | null
  ctxTokens: number | null
  ctxWindow: number | null
  ctxPercent: number | null
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': { snap: Snap }
  }
}
