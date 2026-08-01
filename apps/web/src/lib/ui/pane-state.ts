/**
 * Pure pane-state resolution from query flags, so app-level branching is testable
 * without a DOM. Ordering rule: stale data beats an error screen — degraded mode
 * refetches every 5s, and a transient refetch failure must not blank a pane that
 * already has content (the failure still surfaces via the status chip). An error
 * state is shown only when there is nothing to render at all.
 */
export interface QueryFlags {
  isError: boolean
  isPending: boolean
}

export type MarketPaneState = 'error' | 'loading' | 'ready'

export function marketPaneState(deps: QueryFlags[], hasView: boolean): MarketPaneState {
  if (hasView) return 'ready'
  if (deps.some((d) => d.isError)) return 'error'
  return 'loading'
}

export type PositionPaneState = 'disconnected' | 'error' | 'loading' | 'ready'

export function positionPaneState(connected: boolean, deps: QueryFlags[], hasView: boolean): PositionPaneState {
  if (!connected) return 'disconnected'
  if (hasView) return 'ready'
  if (deps.some((d) => d.isError)) return 'error'
  return 'loading'
}
