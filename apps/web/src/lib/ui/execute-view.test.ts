import { describe, expect, it } from 'vitest'
import { isFlowInFlight, shouldMountExecutePanel, visiblePlanReasons } from './execute-view'

describe('isFlowInFlight', () => {
  it('is true exactly for the driver-running phases', () => {
    for (const phase of ['signing-permit', 'approving', 'simulating', 'confirm-wallet', 'pending', 'fallback-sequential'] as const) {
      expect(isFlowInFlight(phase)).toBe(true)
    }
    for (const phase of ['idle', 'error', 'confirmed'] as const) {
      expect(isFlowInFlight(phase)).toBe(false)
    }
  })
})

describe('shouldMountExecutePanel', () => {
  it('mounts for a valid plan regardless of phase', () => {
    expect(shouldMountExecutePanel(true, 'idle', false)).toBe(true)
    expect(shouldMountExecutePanel(true, 'pending', false)).toBe(true)
  })

  it('keeps the panel mounted after success even when the plan went invalid (post-success refetch)', () => {
    expect(shouldMountExecutePanel(false, 'confirmed', false)).toBe(true)
  })

  it('keeps the panel mounted mid-flight when editing inputs invalidates the plan', () => {
    for (const phase of ['signing-permit', 'approving', 'simulating', 'confirm-wallet', 'pending', 'fallback-sequential', 'error'] as const) {
      expect(shouldMountExecutePanel(false, phase, false)).toBe(true)
    }
  })

  it('a pending notice pins the panel even from idle — the mid-fallback cancel case', () => {
    // USER_REJECTED after a landed supply step resets to idle while the refetched
    // balance invalidates the plan; the notice is the only partial-progress explanation.
    expect(shouldMountExecutePanel(false, 'idle', true)).toBe(true)
  })

  it('unmounts only when the plan is invalid, no flow ran, and nothing is left to say', () => {
    expect(shouldMountExecutePanel(false, 'idle', false)).toBe(false)
  })
})

describe('visiblePlanReasons', () => {
  const reasons = ['enter a collateral amount', 'collateral amount exceeds wallet balance']

  it('suppresses reasons on a pristine form', () => {
    expect(visiblePlanReasons(reasons, false, false)).toEqual([])
  })

  it('shows reasons once the user has typed', () => {
    expect(visiblePlanReasons(reasons, true, false)).toEqual(reasons)
  })

  it('suppresses reasons while a flow is in flight — the mid-flight balance refetch case', () => {
    expect(visiblePlanReasons(reasons, true, true)).toEqual([])
  })
})
