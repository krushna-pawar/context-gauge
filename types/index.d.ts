export type Limit = { kind: string; percentUsed: number }

export type Snap = {
  model: string | null
  effort: string | null
  mode: string | null
  requests: number
  requestsPartial: boolean
  ctxTokens: number | null
  ctxWindow: number | null
  ctxPercent: number | null
  costUsd: number | null
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'main-card': { snap: Snap }
  }
}
