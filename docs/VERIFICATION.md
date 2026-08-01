# Manual verification — Base Sepolia (P0 acceptance)

Prereqs: `.env` with a real `DRPC_KEY`; MetaMask or Rabby with a throwaway account;
`foundry` installed only if you prefer `cast` over wallet UIs (any step using `cast` can
also be done via Basescan's "Write Contract" tab). Set once in your shell:

```bash
export PK=<throwaway-private-key>
export RPC=https://sepolia.base.org        # public RPC is fine for funding txs
export ME=<your-address>
```

Contract addresses below are Base Sepolia, from @bgd-labs/aave-address-book 4.44.22 (the app
itself always imports them; these are copied here only for cast convenience and may drift):
WETH `0x4200000000000000000000000000000000000006` ·
USDC `0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f` ·
Aave faucet `0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc` ·
Pool `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27`

## 1. Boot
- [ ] `pnpm install && pnpm dev` → server prints its boot table (chainId ok, pool code ok,
      POOL_REVISION 10 on base-sepolia / 11 on base), vite serves :5173.
- [ ] Open http://localhost:5173 → market pane lists ~6 Sepolia assets with APYs.
- [ ] DevTools → Network → filter `drpc`: ZERO browser requests to lb.drpc.live; all reads hit
      `localhost:5173/rpc/base-sepolia`. No `Drpc-Key` header anywhere in browser requests.

## 2. Fund the wallet
- [ ] Get ≥0.1 Base Sepolia ETH: https://www.alchemy.com/faucets/base-sepolia
- [ ] Wrap 0.05 ETH → WETH:
      `cast send 0x4200000000000000000000000000000000000006 "deposit()" --value 0.05ether --rpc-url $RPC --private-key $PK`
      Expected: app shows WETH balance 0.05 in the form's wallet line within ~10s.
- [ ] If the USDC borrow row says "no liquidity", seed it yourself: mint and supply USDC
      directly (borrowable liquidity comes from suppliers):
      `cast send 0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc "mint(address,address,uint256)" 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f $ME 10000000000 --rpc-url $RPC --private-key $PK`
      `cast send 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f "approve(address,uint256)" 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27 10000000000 --rpc-url $RPC --private-key $PK`
      `cast send 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27 "supply(address,uint256,address,uint16)" 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f 10000000000 $ME 0 --rpc-url $RPC --private-key $PK`

## 3. Open a WETH-collateral / USDC-borrow position (approve path — WETH has no permit)
- [ ] Select WETH (supply) + USDC (borrow); enter 0.02 WETH; leave target HF at 2.0.
- [ ] Note the predicted values: borrow amount B and "Health factor after borrow: 2.00".
- [ ] Button reads "Approve & open position (2 transactions)". Click; confirm BOTH wallet
      prompts (approve, then Pool.multicall). Progress steps tick: approve → simulate →
      confirm → mined.
- [ ] Success line shows block number + Basescan link. Open the link: the tx is a Pool
      `multicall` whose logs include `Supply` AND `Borrow` (single atomic tx).
- [ ] Position summary now shows ~0.02 WETH supplied, B USDC borrowed, HF within ±0.02 of the
      2.00 prediction (small drift = index accrual between simulate and mine; more than that
      = a math bug — stop and investigate).

## 4. Permit path (USDC collateral — Sepolia mock USDC is EIP-2612)
- [ ] Select USDC (supply) + WETH (borrow), amount 10 USDC, target HF 2.0.
- [ ] Button reads "Sign permit & open position (1 transaction)": one SIGNATURE prompt
      (typed data, no gas) then ONE transaction prompt. Confirm both.
- [ ] Reject-path check: repeat with 5 USDC but REJECT the signature in the wallet →
      calm notice "Request cancelled in wallet — nothing was sent.", button re-enabled,
      no error card, no stuck spinner.

## 5. eMode detection (WETH + cbETH)
- [ ] Select WETH (supply) + cbETH (borrow) → eMode checkbox appears pre-checked with the
      concrete LTV gain (e.g. "LTV 75% → 90%") IF Base Sepolia currently has an
      ETH-correlated category listing both (check `getEModes` output if unsure).
- [ ] Toggle it off → max borrow drops; toggle on → rises. (Executing this position too is a
      bonus check; logs then also include `UserEModeSet`.)

## 6. Two-window live update (the money shot)
- [ ] Window A: normal browser profile, connected, position visible.
- [ ] Window B: second browser profile (or another browser) at http://localhost:5173,
      SAME wallet account connected, "Your position" pane visible.
- [ ] In window A open a small additional position (e.g. 0.005 WETH / target HF 2.5).
- [ ] Expected: window B's summary updates within ~2–5s of the tx confirming, WITHOUT reload —
      footer chip stays "Live", and the updated HF/balances flash in. If window B only updates
      after ~5s+, check its chip: "Degraded — polling every 5s" means the WS watch path is
      broken, polling is carrying it.

## 7. Degraded mode
- [ ] Kill the server (Ctrl-C on `pnpm dev`'s server process) with the app open.
- [ ] Expected: chip flips amber "Degraded — polling every 5s", then after a second
      consecutive failed reconnect attempt, red "Disconnected — polling every 5s";
      last-good data stays on screen (no blank panes, no crash).
- [ ] Restart the server. Expected: within ~15s (client backoff cap) the chip returns to
      green "Live" without reload; data refreshes.

## 8. The reverted-tx scenario
- [ ] Force a revert on a real submitted transaction — easiest repeatable way: open the
      approve-path flow (WETH supply / USDC borrow), submit the approve, then before the
      multicall step is sent, drain the wallet's ETH to another address (or otherwise make the
      second tx unaffordable / invalid) so the Pool.multicall step mines but reverts, or use a
      stale/expired preflight by waiting well past a permit deadline before signing.
- [ ] Expected: the app never reports "confirmed" for a receipt whose on-chain `status` is
      `reverted` — `waitForTransactionReceipt` resolving is not treated as success anywhere in
      the flow. A reverted single-tx multicall surfaces as an error card offering "Try
      step-by-step instead" (the sequential fallback), not a false success line.
- [ ] Run the sequential fallback and force a revert on an early step (e.g. approve a smaller
      allowance than the supply amount so the `supply` step reverts): expected — the stepper
      stops immediately after the reverted step; no later step (`setUserEMode`/`borrow`) is
      ever submitted; the error names which step failed.
- [ ] This scenario is also covered offline by unit tests (`ensureReceiptSuccess`,
      `runSequentialSteps` step-reverts-mid-sequence) — this manual step is a live confirmation
      that the same logic holds against a real mined revert, not just a mocked receipt.

## 9. Offline test suite
- [ ] `pnpm test` (server may be OFF) → all workspaces green: aave-math, proxy allowlist,
      watcher, hub, web derived/plan/execute/ws-client/format suites.
- [ ] `pnpm typecheck` → clean.
