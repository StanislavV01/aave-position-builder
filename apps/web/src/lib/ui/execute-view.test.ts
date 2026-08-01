import { describe, expect, it } from 'vitest'
import { shouldMountExecutePanel, visiblePlanReasons } from './execute-view'

describe('shouldMountExecutePanel', () => {
  it('mounts for a valid plan regardless of phase', () => {
    expect(shouldMountExecutePanel(true, 'idle')).toBe(true)
    expect(shouldMountExecutePanel(true, 'pending')).toBe(true)
  })

  it('keeps the panel mounted after success even when the plan went invalid (post-success refetch)', () => {
    expect(shouldMountExecutePanel(false, 'confirmed')).toBe(true)
  })

  it('keeps the panel mounted mid-flight when editing inputs invalidates the plan', () => {
    for (const phase of ['signing-permit', 'approving', 'simulating', 'confirm-wallet', 'pending', 'fallback-sequential', 'error'] as const) {
      expect(shouldMountExecutePanel(false, phase)).toBe(true)
    }
  })

  it('unmounts only when the plan is invalid and no flow ran', () => {
    expect(shouldMountExecutePanel(false, 'idle')).toBe(false)
  })
})

describe('visiblePlanReasons', () => {
  const reasons = ['enter a collateral amount', 'nothing to borrow — set a target HF or amount']

  it('suppresses reasons on a pristine form', () => {
    expect(visiblePlanReasons(reasons, false)).toEqual([])
  })

  it('shows reasons once the user has typed', () => {
    expect(visiblePlanReasons(reasons, true)).toEqual(reasons)
  })
})
