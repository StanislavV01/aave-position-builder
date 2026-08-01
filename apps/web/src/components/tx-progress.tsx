import type { OpenFlowState } from '../lib/execute'

type StepTone = 'done' | 'active' | 'error' | 'idle'

function Step({ tone, children }: { tone: StepTone; children: React.ReactNode }) {
  return <li className={`step-${tone}`}>{children}</li>
}

export function TxProgress({ state, permitPath }: { state: OpenFlowState; permitPath: boolean }) {
  if (state.phase === 'idle') return null
  if (state.phase === 'fallback-sequential') {
    return (
      <ol className="steps" aria-live="polite">
        {Array.from({ length: state.totalSteps }, (_, i) => {
          const n = i + 1
          const tone: StepTone = n < state.step ? 'done' : n === state.step ? 'active' : 'idle'
          return (
            <Step key={n} tone={tone}>
              Step {n} of {state.totalSteps}
              {n === state.step && state.currentTx ? ` — ${state.currentTx.slice(0, 10)}…` : ''}
            </Step>
          )
        })}
      </ol>
    )
  }
  const order = ['prepare', 'simulate', 'confirm', 'mined'] as const
  const reached: Record<OpenFlowState['phase'], number> = {
    'idle': -1, 'signing-permit': 0, 'approving': 0, 'simulating': 1,
    'confirm-wallet': 2, 'pending': 3, 'confirmed': 4, 'fallback-sequential': -1, 'error': -1,
  }
  const level = reached[state.phase]
  const labels = [
    permitPath ? 'Sign permit (gasless)' : 'Approve spending',
    'Simulate transaction',
    'Confirm in wallet',
    state.phase === 'pending' ? `Waiting for block — ${state.txHash.slice(0, 10)}…` : 'Mined',
  ]
  return (
    <ol className="steps" aria-live="polite">
      {order.map((key, i) => {
        const tone: StepTone =
          state.phase === 'error' ? (i === 0 ? 'error' : 'idle') : i < level ? 'done' : i === level ? 'active' : 'idle'
        return (
          <Step key={key} tone={tone}>
            {labels[i]}
          </Step>
        )
      })}
    </ol>
  )
}
