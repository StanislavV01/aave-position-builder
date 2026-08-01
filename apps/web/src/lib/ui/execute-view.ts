import type { OpenFlowState } from '../open-position/execute'

/**
 * The execute panel must stay mounted while a flow is in progress or showing its outcome,
 * even when the plan is no longer valid. The post-success refetch shrinks the wallet
 * balance, which invalidates the still-populated amounts — unmounting on that would
 * destroy the "Position opened" confirmation seconds after it appeared.
 */
export function shouldMountExecutePanel(planValid: boolean, phase: OpenFlowState['phase']): boolean {
  return planValid || phase !== 'idle'
}

/**
 * Validation reasons are hidden until the user has typed something: a pristine form is
 * incomplete, not wrong. Also keeps the form calm right after a successful open, when
 * the inputs are programmatically cleared.
 */
export function visiblePlanReasons(reasons: string[], dirty: boolean): string[] {
  return dirty ? reasons : []
}
