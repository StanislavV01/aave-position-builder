import type { OpenFlowState } from '../open-position/execute'

/** Phases where an async driver is actively running — the form must freeze while true. */
export function isFlowInFlight(phase: OpenFlowState['phase']): boolean {
  return phase !== 'idle' && phase !== 'error' && phase !== 'confirmed'
}

/**
 * The execute panel must stay mounted while a flow is in progress or showing its
 * outcome, even when the plan is no longer valid. Two ways a valid outcome coexists
 * with an invalid plan: the post-success refetch shrinks the balance under the
 * still-populated amounts, and a mid-fallback cancel (USER_REJECTED → 'idle') can
 * do the same after a landed supply step — in that case the pending notice ("steps
 * already confirmed stay on-chain") is the only explanation the user gets, so an
 * unread notice also pins the panel.
 */
export function shouldMountExecutePanel(
  planValid: boolean,
  phase: OpenFlowState['phase'],
  hasNotice: boolean,
): boolean {
  return planValid || phase !== 'idle' || hasNotice
}

/**
 * Validation reasons are hidden until the user has typed something (a pristine form
 * is incomplete, not wrong) and while a flow is in flight — the live position-event
 * invalidation refetches the balance the moment supply lands, which would otherwise
 * flash "exceeds wallet balance" at the user mid-signature.
 */
export function visiblePlanReasons(reasons: string[], dirty: boolean, flowInFlight: boolean): string[] {
  return dirty && !flowInFlight ? reasons : []
}
