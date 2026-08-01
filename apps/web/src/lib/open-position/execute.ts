import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { BaseError, UserRejectedRequestError, parseSignature, type Address, type Hex } from 'viem'
import { useConfig } from 'wagmi'
import { readContract, signTypedData, simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ERC20_ABI, POOL_ABI, buildOpenPositionCalls, type MarketConfig } from '@app/shared'

// ---------- state machine (pure) ----------

// The subset of phases that represent an in-flight step of the main (non-fallback) open
// flow. When an error interrupts one of these, the error variant below records which one
// so the UI can point at the step that actually failed instead of always blaming the first.
const IN_PROGRESS_PHASES = ['signing-permit', 'approving', 'simulating', 'confirm-wallet', 'pending'] as const
export type InProgressPhase = (typeof IN_PROGRESS_PHASES)[number]

function isInProgressPhase(phase: OpenFlowState['phase']): phase is InProgressPhase {
  return (IN_PROGRESS_PHASES as readonly string[]).includes(phase)
}

export type OpenFlowState =
  | { phase: 'idle' }
  | { phase: 'signing-permit' }
  | { phase: 'approving'; txHash?: Hex }
  | { phase: 'simulating' }
  | { phase: 'confirm-wallet' }
  | { phase: 'pending'; txHash: Hex }
  | { phase: 'confirmed'; txHash: Hex; blockNumber: bigint }
  | { phase: 'fallback-sequential'; step: number; totalSteps: number; currentTx?: Hex }
  | { phase: 'error'; message: string; canRetry: boolean; suggestSequential: boolean; failedPhase?: InProgressPhase }

export type OpenFlowEvent =
  | { type: 'START'; permit: boolean; needsApproval: boolean }
  | { type: 'PERMIT_SIGNED' }
  | { type: 'APPROVE_SUBMITTED'; txHash: Hex }
  | { type: 'APPROVE_CONFIRMED' }
  | { type: 'SIMULATION_OK' }
  | { type: 'SIMULATION_FAILED'; message: string }
  | { type: 'TX_SUBMITTED'; txHash: Hex }
  | { type: 'TX_CONFIRMED'; txHash: Hex; blockNumber: bigint }
  | { type: 'FALLBACK_START'; totalSteps: number }
  | { type: 'FALLBACK_STEP_SUBMITTED'; step: number; txHash: Hex }
  | { type: 'FALLBACK_STEP_CONFIRMED'; step: number; totalSteps: number }
  | { type: 'USER_REJECTED' }
  | { type: 'ERROR'; message: string; canRetry: boolean; suggestSequential: boolean }
  | { type: 'RESET' }

// The reducer accepts START only from these phases. The async drivers below check this
// BEFORE running: dispatch() gives no feedback, so without the check a click that the
// reducer ignores (e.g. after 'confirmed') would still run the full permit/approve/write
// flow — wallet popups included — while the UI stays pinned on the old state.
export function canStartOpenFlow(phase: OpenFlowState['phase']): boolean {
  return phase === 'idle' || phase === 'error'
}

export function openFlowReducer(state: OpenFlowState, event: OpenFlowEvent): OpenFlowState {
  switch (event.type) {
    case 'RESET':
    case 'USER_REJECTED':
      return { phase: 'idle' }
    case 'ERROR':
      return {
        phase: 'error',
        message: event.message,
        canRetry: event.canRetry,
        suggestSequential: event.suggestSequential,
        failedPhase: isInProgressPhase(state.phase) ? state.phase : undefined,
      }
    case 'START':
      if (!canStartOpenFlow(state.phase)) return state
      if (event.permit) return { phase: 'signing-permit' }
      if (event.needsApproval) return { phase: 'approving' }
      return { phase: 'simulating' }
    case 'PERMIT_SIGNED':
      return state.phase === 'signing-permit' ? { phase: 'simulating' } : state
    case 'APPROVE_SUBMITTED':
      return state.phase === 'approving' ? { phase: 'approving', txHash: event.txHash } : state
    case 'APPROVE_CONFIRMED':
      return state.phase === 'approving' ? { phase: 'simulating' } : state
    case 'SIMULATION_OK':
      return state.phase === 'simulating' ? { phase: 'confirm-wallet' } : state
    case 'SIMULATION_FAILED':
      return state.phase === 'simulating'
        ? { phase: 'error', message: event.message, canRetry: true, suggestSequential: true, failedPhase: 'simulating' }
        : state
    case 'TX_SUBMITTED':
      return state.phase === 'confirm-wallet' ? { phase: 'pending', txHash: event.txHash } : state
    case 'TX_CONFIRMED':
      return state.phase === 'pending' || state.phase === 'fallback-sequential'
        ? { phase: 'confirmed', txHash: event.txHash, blockNumber: event.blockNumber }
        : state
    case 'FALLBACK_START':
      return state.phase === 'error' || state.phase === 'idle'
        ? { phase: 'fallback-sequential', step: 1, totalSteps: event.totalSteps }
        : state
    case 'FALLBACK_STEP_SUBMITTED':
      return state.phase === 'fallback-sequential'
        ? { ...state, step: event.step, currentTx: event.txHash }
        : state
    case 'FALLBACK_STEP_CONFIRMED':
      return state.phase === 'fallback-sequential'
        ? { phase: 'fallback-sequential', step: event.step + 1, totalSteps: event.totalSteps }
        : state
  }
}

// ---------- hook (async driver) ----------

export interface ExecutablePlan {
  market: MarketConfig
  user: Address
  collateralAsset: Address
  collateralAmount: bigint
  borrowAsset: Address
  borrowAmount: bigint
  eModeCategoryToSet: number | null
  permit: { version: '1' | '2'; name: string } | null // from usePermitSupport; null → approve path
  currentAllowance: bigint
}

// Pure derivation of the sequential-fallback step list (mirrored by runSequential below —
// keep the two in sync). The fallback deliberately never uses permit, so an approve step
// is ALWAYS included when allowance is short, even for permit-capable tokens.
export function sequentialStepLabels(
  p: Pick<ExecutablePlan, 'permit' | 'currentAllowance' | 'collateralAmount' | 'eModeCategoryToSet'>,
): ('approve' | 'supply' | 'setUserEMode' | 'borrow')[] {
  const labels: ('approve' | 'supply' | 'setUserEMode' | 'borrow')[] = []
  if (p.currentAllowance < p.collateralAmount) labels.push('approve')
  labels.push('supply')
  if (p.eModeCategoryToSet !== null) labels.push('setUserEMode')
  labels.push('borrow')
  return labels
}

function isUserRejection(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError) !== null
}

function describeError(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage
  if (err instanceof Error) return err.message
  return String(err)
}

// viem's waitForTransactionReceipt RESOLVES for a transaction that mined but reverted —
// it only rejects on RPC-level failure (dropped, timeout, etc). Every call site MUST
// check receipt.status explicitly; a mined-but-reverted tx is not a success.
export class ReceiptRevertedError extends Error {
  constructor(public readonly label: string) {
    super(`${label} transaction reverted on-chain`)
    this.name = 'ReceiptRevertedError'
  }
}

export function ensureReceiptSuccess(receipt: { status: 'success' | 'reverted' }, label: string): void {
  if (receipt.status !== 'success') {
    throw new ReceiptRevertedError(label)
  }
}

async function invalidateAfterTx(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['userReservesData'] }),
    queryClient.invalidateQueries({ queryKey: ['reservesData'] }),
    queryClient.invalidateQueries({ queryKey: ['tokenState'] }),
  ])
}

export interface SequentialTxStep {
  label: string
  write: () => Promise<Hex>
}

interface SequentialReceipt {
  status: 'success' | 'reverted'
  blockNumber: bigint
}

// The loop mechanics extracted from runSequential below so they can be unit-tested without
// a real wagmi config/wallet: write + waitReceipt are injected. A step that mines-but-reverts
// throws (via ensureReceiptSuccess) and the loop stops — no later step is ever invoked.
export async function runSequentialSteps(
  steps: SequentialTxStep[],
  deps: {
    waitReceipt: (hash: Hex) => Promise<SequentialReceipt>
    dispatch: (event: OpenFlowEvent) => void
  },
): Promise<void> {
  deps.dispatch({ type: 'FALLBACK_START', totalSteps: steps.length })
  for (let i = 0; i < steps.length; i++) {
    const hash = await steps[i].write()
    deps.dispatch({ type: 'FALLBACK_STEP_SUBMITTED', step: i + 1, txHash: hash })
    const receipt = await deps.waitReceipt(hash)
    ensureReceiptSuccess(receipt, steps[i].label)
    if (i === steps.length - 1) {
      deps.dispatch({ type: 'TX_CONFIRMED', txHash: hash, blockNumber: receipt.blockNumber })
    } else {
      deps.dispatch({ type: 'FALLBACK_STEP_CONFIRMED', step: i + 1, totalSteps: steps.length })
    }
  }
}

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export function useOpenPosition() {
  const config = useConfig()
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(openFlowReducer, { phase: 'idle' } as OpenFlowState)
  const [notice, setNotice] = useState<string | null>(null)
  // Mirror of state.phase readable from the memoized callbacks (their closures would
  // otherwise see the phase from the render they were created in), plus a synchronous
  // in-flight lock covering the gap between dispatch(START) and the re-render.
  const phaseRef = useRef<OpenFlowState['phase']>(state.phase)
  phaseRef.current = state.phase
  const runningRef = useRef(false)

  const openInner = useCallback(
    async (p: ExecutablePlan) => {
      setNotice(null)
      const chainId = p.market.chainId
      const needsApproval = p.permit === null && p.currentAllowance < p.collateralAmount
      dispatch({ type: 'START', permit: p.permit !== null, needsApproval })
      // Tracks whether the approve tx actually landed on-chain, so a LATER failure/rejection
      // (simulation, multicall signature, revert) can invalidate the now-stale allowance and
      // report an accurate notice instead of implying nothing happened.
      let approveConfirmed = false
      try {
        let permitSig: { deadline: bigint; v: number; r: Hex; s: Hex } | null = null
        if (p.permit) {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
          const nonce = (await readContract(config, {
            chainId, address: p.collateralAsset, abi: ERC20_ABI, functionName: 'nonces', args: [p.user],
          })) as bigint
          const signature = await signTypedData(config, {
            domain: { name: p.permit.name, version: p.permit.version, chainId, verifyingContract: p.collateralAsset },
            types: PERMIT_TYPES,
            primaryType: 'Permit',
            message: { owner: p.user, spender: p.market.pool, value: p.collateralAmount, nonce, deadline },
          })
          const sig = parseSignature(signature)
          permitSig = { deadline, v: Number(sig.v ?? BigInt(sig.yParity) + 27n), r: sig.r, s: sig.s }
          dispatch({ type: 'PERMIT_SIGNED' })
        } else if (needsApproval) {
          const approveHash = await writeContract(config, {
            chainId, address: p.collateralAsset, abi: ERC20_ABI, functionName: 'approve',
            args: [p.market.pool, p.collateralAmount],
          })
          dispatch({ type: 'APPROVE_SUBMITTED', txHash: approveHash })
          const approveReceipt = await waitForTransactionReceipt(config, { chainId, hash: approveHash })
          ensureReceiptSuccess(approveReceipt, 'approve')
          approveConfirmed = true
          dispatch({ type: 'APPROVE_CONFIRMED' })
        }

        const { calls } = buildOpenPositionCalls({
          market: p.market, user: p.user,
          collateralAsset: p.collateralAsset, collateralAmount: p.collateralAmount,
          borrowAsset: p.borrowAsset, borrowAmount: p.borrowAmount,
          eModeCategoryToSet: p.eModeCategoryToSet, permit: permitSig,
        })

        try {
          // Preflight through the proxy — the wallet is only asked to sign a tx we know simulates clean.
          await simulateContract(config, {
            chainId, account: p.user, address: p.market.pool, abi: POOL_ABI,
            functionName: 'multicall', args: [calls],
          })
        } catch (err) {
          if (approveConfirmed) await invalidateAfterTx(queryClient) // allowance changed — refetch it
          dispatch({ type: 'SIMULATION_FAILED', message: describeError(err) })
          return
        }
        dispatch({ type: 'SIMULATION_OK' })

        const hash = await writeContract(config, {
          chainId, address: p.market.pool, abi: POOL_ABI, functionName: 'multicall', args: [calls],
        })
        dispatch({ type: 'TX_SUBMITTED', txHash: hash })
        const receipt = await waitForTransactionReceipt(config, { chainId, hash })
        ensureReceiptSuccess(receipt, 'multicall')
        dispatch({ type: 'TX_CONFIRMED', txHash: hash, blockNumber: receipt.blockNumber })
        await invalidateAfterTx(queryClient)
      } catch (err) {
        if (approveConfirmed) {
          // The approve tx already landed — the allowance changed even though the flow
          // didn't complete, so the cached tokenState is now stale regardless of why we're here.
          await invalidateAfterTx(queryClient)
        }
        if (isUserRejection(err)) {
          setNotice(
            approveConfirmed
              ? 'Approval confirmed, but the position transaction was not sent — you can retry without re-approving.'
              : 'Request cancelled in wallet — nothing was sent.',
          )
          dispatch({ type: 'USER_REJECTED' })
          return
        }
        // A reverted multicall (e.g. price moved between simulation and mining) is the same
        // class of failure as a failed preflight simulation — offer the sequential fallback.
        const suggestSequential = err instanceof ReceiptRevertedError && err.label === 'multicall'
        dispatch({ type: 'ERROR', message: describeError(err), canRetry: true, suggestSequential })
      }
    },
    [config, queryClient],
  )

  const runSequentialInner = useCallback(
    async (p: ExecutablePlan) => {
      setNotice(null)
      const chainId = p.market.chainId
      const txs: SequentialTxStep[] = []
      // The fallback deliberately never uses permit — approve whenever allowance is short,
      // even for permit-capable tokens (keep in sync with sequentialStepLabels above).
      if (p.currentAllowance < p.collateralAmount) {
        txs.push({
          label: 'approve',
          write: () => writeContract(config, {
            chainId, address: p.collateralAsset, abi: ERC20_ABI, functionName: 'approve',
            args: [p.market.pool, p.collateralAmount],
          }),
        })
      }
      txs.push({
        label: 'supply',
        write: () => writeContract(config, {
          chainId, address: p.market.pool, abi: POOL_ABI, functionName: 'supply',
          args: [p.collateralAsset, p.collateralAmount, p.user, 0],
        }),
      })
      const eModeCategoryToSet = p.eModeCategoryToSet
      if (eModeCategoryToSet !== null) {
        txs.push({
          label: 'setUserEMode',
          write: () => writeContract(config, {
            chainId, address: p.market.pool, abi: POOL_ABI, functionName: 'setUserEMode',
            args: [eModeCategoryToSet],
          }),
        })
      }
      txs.push({
        label: 'borrow',
        write: () => writeContract(config, {
          chainId, address: p.market.pool, abi: POOL_ABI, functionName: 'borrow',
          args: [p.borrowAsset, p.borrowAmount, 2n, 0, p.user],
        }),
      })

      try {
        await runSequentialSteps(txs, {
          waitReceipt: (hash) => waitForTransactionReceipt(config, { chainId, hash }),
          dispatch,
        })
        await invalidateAfterTx(queryClient)
      } catch (err) {
        await invalidateAfterTx(queryClient) // earlier steps may have landed — refetch truth
        if (isUserRejection(err)) {
          setNotice('Cancelled — steps already confirmed stay on-chain; the summary reflects them.')
          dispatch({ type: 'USER_REJECTED' })
          return
        }
        dispatch({ type: 'ERROR', message: describeError(err), canRetry: false, suggestSequential: false })
      }
    },
    [config, queryClient],
  )

  // Public entry points: refuse to run when the reducer would refuse START/FALLBACK_START
  // (see canStartOpenFlow) and hold a synchronous lock so a double-click cannot start a
  // second driver before the first render lands.
  const guard = useCallback(
    (inner: (p: ExecutablePlan) => Promise<void>) =>
      async (p: ExecutablePlan) => {
        if (runningRef.current || !canStartOpenFlow(phaseRef.current)) return
        runningRef.current = true
        try {
          await inner(p)
        } finally {
          runningRef.current = false
        }
      },
    [],
  )
  const open = useMemo(() => guard(openInner), [guard, openInner])
  const runSequential = useMemo(() => guard(runSequentialInner), [guard, runSequentialInner])

  const reset = useCallback(() => {
    setNotice(null)
    dispatch({ type: 'RESET' })
  }, [])

  return { state, notice, open, runSequential, reset }
}
