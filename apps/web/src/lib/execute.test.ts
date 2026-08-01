import { describe, expect, it, vi } from 'vitest'
import {
  ensureReceiptSuccess,
  openFlowReducer,
  runSequentialSteps,
  sequentialStepLabels,
  type OpenFlowEvent,
  type OpenFlowState,
  type SequentialTxStep,
} from './execute'

const H = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

const step = (s: OpenFlowState, ...events: OpenFlowEvent[]) => events.reduce(openFlowReducer, s)

describe('openFlowReducer — happy paths', () => {
  it('permit path: idle → signing-permit → simulating → confirm-wallet → pending → confirmed', () => {
    let s: OpenFlowState = { phase: 'idle' }
    s = openFlowReducer(s, { type: 'START', permit: true, needsApproval: false })
    expect(s).toEqual({ phase: 'signing-permit' })
    s = openFlowReducer(s, { type: 'PERMIT_SIGNED' })
    expect(s).toEqual({ phase: 'simulating' })
    s = openFlowReducer(s, { type: 'SIMULATION_OK' })
    expect(s).toEqual({ phase: 'confirm-wallet' })
    s = openFlowReducer(s, { type: 'TX_SUBMITTED', txHash: H })
    expect(s).toEqual({ phase: 'pending', txHash: H })
    s = openFlowReducer(s, { type: 'TX_CONFIRMED', txHash: H, blockNumber: 123n })
    expect(s).toEqual({ phase: 'confirmed', txHash: H, blockNumber: 123n })
  })

  it('approve path: idle → approving (hash attaches) → simulating', () => {
    let s: OpenFlowState = { phase: 'idle' }
    s = openFlowReducer(s, { type: 'START', permit: false, needsApproval: true })
    expect(s).toEqual({ phase: 'approving' })
    s = openFlowReducer(s, { type: 'APPROVE_SUBMITTED', txHash: H })
    expect(s).toEqual({ phase: 'approving', txHash: H })
    s = openFlowReducer(s, { type: 'APPROVE_CONFIRMED' })
    expect(s).toEqual({ phase: 'simulating' })
  })

  it('sufficient allowance skips straight to simulating', () => {
    const s = openFlowReducer({ phase: 'idle' }, { type: 'START', permit: false, needsApproval: false })
    expect(s).toEqual({ phase: 'simulating' })
  })
})

describe('openFlowReducer — failure and fallback paths', () => {
  it('simulation failure suggests the sequential fallback', () => {
    const s = step(
      { phase: 'idle' },
      { type: 'START', permit: true, needsApproval: false },
      { type: 'PERMIT_SIGNED' },
      { type: 'SIMULATION_FAILED', message: 'execution reverted: 36' },
    )
    expect(s).toEqual({
      phase: 'error', message: 'execution reverted: 36', canRetry: true, suggestSequential: true,
    })
  })

  it('user rejection resets calmly to idle from any interactive phase', () => {
    for (const phase of [
      { phase: 'signing-permit' },
      { phase: 'confirm-wallet' },
      { phase: 'approving' },
    ] as OpenFlowState[]) {
      expect(openFlowReducer(phase, { type: 'USER_REJECTED' })).toEqual({ phase: 'idle' })
    }
  })

  it('fallback: error → fallback-sequential, steps advance, final tx confirms', () => {
    let s: OpenFlowState = { phase: 'error', message: 'x', canRetry: true, suggestSequential: true }
    s = openFlowReducer(s, { type: 'FALLBACK_START', totalSteps: 3 })
    expect(s).toEqual({ phase: 'fallback-sequential', step: 1, totalSteps: 3 })
    s = openFlowReducer(s, { type: 'FALLBACK_STEP_SUBMITTED', step: 1, txHash: H })
    expect(s).toEqual({ phase: 'fallback-sequential', step: 1, totalSteps: 3, currentTx: H })
    s = openFlowReducer(s, { type: 'FALLBACK_STEP_CONFIRMED', step: 1, totalSteps: 3 })
    expect(s).toEqual({ phase: 'fallback-sequential', step: 2, totalSteps: 3 })
    s = step(s,
      { type: 'FALLBACK_STEP_SUBMITTED', step: 2, txHash: H },
      { type: 'FALLBACK_STEP_CONFIRMED', step: 2, totalSteps: 3 },
      { type: 'FALLBACK_STEP_SUBMITTED', step: 3, txHash: H },
      { type: 'TX_CONFIRMED', txHash: H, blockNumber: 99n },
    )
    expect(s).toEqual({ phase: 'confirmed', txHash: H, blockNumber: 99n })
  })

  it('fallback step list ALWAYS includes approve when allowance is short — even for a permit-capable token', () => {
    const labels = sequentialStepLabels({
      permit: { version: '2', name: 'USDC' },
      currentAllowance: 0n,
      collateralAmount: 1_000_000n,
      eModeCategoryToSet: 1,
    })
    expect(labels).toEqual(['approve', 'supply', 'setUserEMode', 'borrow'])
    expect(labels.length).toBe(4) // FALLBACK_START totalSteps — the fallback never uses permit
  })

  it('ERROR is reachable from any phase and RESET returns to idle', () => {
    const err: OpenFlowEvent = { type: 'ERROR', message: 'boom', canRetry: true, suggestSequential: false }
    expect(openFlowReducer({ phase: 'pending', txHash: H }, err)).toEqual({
      phase: 'error', message: 'boom', canRetry: true, suggestSequential: false,
    })
    expect(openFlowReducer({ phase: 'error', message: 'boom', canRetry: true, suggestSequential: false }, { type: 'RESET' })).toEqual({ phase: 'idle' })
  })

  it('stray events are ignored (no phantom transitions)', () => {
    expect(openFlowReducer({ phase: 'idle' }, { type: 'TX_CONFIRMED', txHash: H, blockNumber: 1n })).toEqual({ phase: 'idle' })
    expect(openFlowReducer({ phase: 'idle' }, { type: 'PERMIT_SIGNED' })).toEqual({ phase: 'idle' })
    expect(openFlowReducer({ phase: 'confirmed', txHash: H, blockNumber: 1n }, { type: 'SIMULATION_OK' })).toEqual({ phase: 'confirmed', txHash: H, blockNumber: 1n })
  })

  it('START is accepted from idle and error only', () => {
    const start: OpenFlowEvent = { type: 'START', permit: true, needsApproval: false }
    expect(openFlowReducer({ phase: 'error', message: 'x', canRetry: true, suggestSequential: false }, start)).toEqual({ phase: 'signing-permit' })
    expect(openFlowReducer({ phase: 'pending', txHash: H }, start)).toEqual({ phase: 'pending', txHash: H })
  })
})

describe('ensureReceiptSuccess', () => {
  it('passes silently for a successful receipt', () => {
    expect(() => ensureReceiptSuccess({ status: 'success' }, 'approve')).not.toThrow()
  })

  it('throws with the step label in the message when the receipt mined but reverted', () => {
    expect(() => ensureReceiptSuccess({ status: 'reverted' }, 'multicall')).toThrow(
      'multicall transaction reverted on-chain',
    )
    expect(() => ensureReceiptSuccess({ status: 'reverted' }, 'approve')).toThrow(
      'approve transaction reverted on-chain',
    )
  })
})

describe('runSequentialSteps', () => {
  it('happy path: FALLBACK_START, per-step submit/confirm, then a final TX_CONFIRMED', async () => {
    const events: OpenFlowEvent[] = []
    const steps: SequentialTxStep[] = [
      { label: 'approve', write: async () => H },
      { label: 'supply', write: async () => H },
    ]
    await runSequentialSteps(steps, {
      waitReceipt: async () => ({ status: 'success', blockNumber: 7n }),
      dispatch: (e) => events.push(e),
    })
    expect(events).toEqual([
      { type: 'FALLBACK_START', totalSteps: 2 },
      { type: 'FALLBACK_STEP_SUBMITTED', step: 1, txHash: H },
      { type: 'FALLBACK_STEP_CONFIRMED', step: 1, totalSteps: 2 },
      { type: 'FALLBACK_STEP_SUBMITTED', step: 2, txHash: H },
      { type: 'TX_CONFIRMED', txHash: H, blockNumber: 7n },
    ])
  })

  it('stops the loop when a step mines but reverts — later steps are never invoked', async () => {
    const events: OpenFlowEvent[] = []
    const step2Write = vi.fn(async () => H)
    const steps: SequentialTxStep[] = [
      { label: 'approve', write: async () => H },
      { label: 'supply', write: step2Write },
    ]
    await expect(
      runSequentialSteps(steps, {
        waitReceipt: async () => ({ status: 'reverted', blockNumber: 1n }),
        dispatch: (e) => events.push(e),
      }),
    ).rejects.toThrow('approve transaction reverted on-chain')

    expect(step2Write).not.toHaveBeenCalled()
    expect(events).toEqual([
      { type: 'FALLBACK_START', totalSteps: 2 },
      { type: 'FALLBACK_STEP_SUBMITTED', step: 1, txHash: H },
    ])
  })

  it('a later step reverting still stops before any subsequent step, with earlier steps already confirmed', async () => {
    const events: OpenFlowEvent[] = []
    const step3Write = vi.fn(async () => H)
    const steps: SequentialTxStep[] = [
      { label: 'approve', write: async () => H },
      { label: 'supply', write: async () => H },
      { label: 'borrow', write: step3Write },
    ]
    let call = 0
    await expect(
      runSequentialSteps(steps, {
        waitReceipt: async () => {
          call += 1
          // step 1 succeeds, step 2 mines-but-reverts, step 3 must never run
          return { status: call === 2 ? 'reverted' : 'success', blockNumber: 1n }
        },
        dispatch: (e) => events.push(e),
      }),
    ).rejects.toThrow('supply transaction reverted on-chain')

    expect(step3Write).not.toHaveBeenCalled()
    expect(events).toEqual([
      { type: 'FALLBACK_START', totalSteps: 3 },
      { type: 'FALLBACK_STEP_SUBMITTED', step: 1, txHash: H },
      { type: 'FALLBACK_STEP_CONFIRMED', step: 1, totalSteps: 3 },
      { type: 'FALLBACK_STEP_SUBMITTED', step: 2, txHash: H },
    ])
  })
})
