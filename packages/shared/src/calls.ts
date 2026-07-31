// The one and only place the open-position transaction is assembled.
// UI preview, Pool.multicall(calls) execution, and the fork E2E all consume this
// output — the preview can never drift from what is sent.
// Order: [supplyWithPermit | supply, setUserEMode?, borrow]
//   - supply first (collateral must exist before borrowing against it)
//   - setUserEMode before borrow (borrow validates against the category's LTV)
//   - borrow last, interestRateMode ALWAYS 2n (variable), referralCode 0
import { encodeFunctionData } from 'viem'
import type { Address, Hex } from 'viem'
import { POOL_ABI } from './abis/pool'
import type { MarketConfig } from './networks'

export interface OpenPositionArgs {
  market: MarketConfig
  user: Address
  collateralAsset: Address
  collateralAmount: bigint
  borrowAsset: Address
  borrowAmount: bigint
  eModeCategoryToSet: number | null // null = don't touch eMode
  permit: { deadline: bigint; v: number; r: Hex; s: Hex } | null // null = plain supply (approve path)
}

export interface OpenPositionStep {
  kind: 'supplyWithPermit' | 'supply' | 'setUserEMode' | 'borrow'
  data: Hex
}

const REFERRAL_CODE = 0
const VARIABLE_RATE_MODE = 2n

export function buildOpenPositionCalls(args: OpenPositionArgs): { calls: Hex[]; steps: OpenPositionStep[] } {
  if (args.collateralAmount <= 0n) throw new Error('buildOpenPositionCalls: collateralAmount must be > 0')
  if (args.borrowAmount <= 0n) throw new Error('buildOpenPositionCalls: borrowAmount must be > 0')

  const supplyStep: OpenPositionStep =
    args.permit !== null
      ? {
          kind: 'supplyWithPermit',
          data: encodeFunctionData({
            abi: POOL_ABI,
            functionName: 'supplyWithPermit',
            args: [
              args.collateralAsset,
              args.collateralAmount,
              args.user,
              REFERRAL_CODE,
              args.permit.deadline,
              args.permit.v,
              args.permit.r,
              args.permit.s,
            ],
          }),
        }
      : {
          kind: 'supply',
          data: encodeFunctionData({
            abi: POOL_ABI,
            functionName: 'supply',
            args: [args.collateralAsset, args.collateralAmount, args.user, REFERRAL_CODE],
          }),
        }

  const eModeSteps: OpenPositionStep[] =
    args.eModeCategoryToSet !== null
      ? [
          {
            kind: 'setUserEMode',
            data: encodeFunctionData({
              abi: POOL_ABI,
              functionName: 'setUserEMode',
              args: [args.eModeCategoryToSet],
            }),
          },
        ]
      : []

  const borrowStep: OpenPositionStep = {
    kind: 'borrow',
    data: encodeFunctionData({
      abi: POOL_ABI,
      functionName: 'borrow',
      args: [args.borrowAsset, args.borrowAmount, VARIABLE_RATE_MODE, REFERRAL_CODE, args.user],
    }),
  }

  const steps: OpenPositionStep[] = [supplyStep, ...eModeSteps, borrowStep]
  return { calls: steps.map((step) => step.data), steps }
}
