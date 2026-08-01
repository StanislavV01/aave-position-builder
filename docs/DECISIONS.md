# Decisions

## 1. What "optimal" means here
Options: cheapest gas; best rate across markets; max capital efficiency + risk-calibrated sizing.
Chosen: financial optimality of the position itself — eMode detection when the pair shares a
category (higher LTV, shown as a concrete gain), borrow amount derived from a target health
factor (bidirectional), atomic single-tx execution with minimum signatures, all simulated
client-side before any wallet prompt. Rate shopping/looping are explicitly out of scope.
Would change my mind: a brief that weights gas or multi-market yield.

## 2. RPC proxy for key secrecy
Options: key in the browser (VITE_ var); serverless edge proxy; own Fastify proxy.
Chosen: Fastify proxy with a method allowlist. A bundled key is public by definition — anything
shipped to the browser is readable. The key is read once into a closure (`upstream.ts`), sent as
the `Drpc-Key` header (inert in URL logs), and `eth_sendRawTransaction` is not proxied — the
wallet broadcasts through its own provider. Would change my mind: a provider issuing
domain-locked browser keys with hard spend caps.

## 3. wagmi pinned to v2 (not v3)
wagmi 3 shipped recently; v2 is mature, peer-compatible with viem 2.x and react-query 5, and all
reference material targets it. A take-home is the wrong place to debug a fresh major.
Would change my mind: v3 reaching the same ecosystem maturity.

## 4. Per-network ABIs — verified against the deployment, not the repo tag
This is the biggest finding of the build, and it reversed an earlier decision. The original plan
was to pin two `getEModes` ABI variants derived from `aave-v3-origin` repo tags (v3.6.0 vs
v3.7/main), on the assumption that the only cross-version difference was `EModeCategory` gaining
`bool isolated` in v3.7 (7 → 8 fields), with `AggregatedReserveData` byte-identical everywhere.

That assumption was wrong, and it did not fail quietly — decoding a real Base Sepolia
`getReservesData()` payload threw `InvalidBytesBooleanError` outright. Ground truth (Blockscout-
verified deployed source for both target networks, cross-checked by decoding a captured real
payload) turned out to be: `AggregatedReserveData` is **not** identical across networks — the
deployed Base Sepolia `UiPoolDataProvider` returns 42 fields (extra `unbacked` right after
`accruedToTreasury`, extra `virtualAccActive` right after `borrowableInIsolation`) vs 40 on Base
mainnet. `getEModes` is worse: **neither** deployed network uses the `isolated`-bearing 8-field
shape the plan assumed was "v3.7". Base Sepolia is a previously-unmodeled 6-field shape (no
`isolated`, no `ltvzeroBitmap`); Base mainnet is a 7-field shape (no `isolated`, but it does have
`ltvzeroBitmap`). Worse still: because `label: string` makes the eMode tuple dynamic, decoding
one network's shape with the other's ABI does **not** throw — it silently fabricates a bogus
trailing `ltvzeroBitmap` field instead of reverting or raising a decode error.

Chosen: abandon repo-tag-derived ABIs. Both `getReservesData` and `getEModes` are now vendored
per network from Blockscout-verified deployed source, proven by decoding one captured real
on-chain payload per call in a committed fixture
(`apps/web/src/lib/__fixtures__/base-sepolia.json`), exercised by
`packages/shared/src/abis/ui-pool-data-provider.test.ts` on every test run — no live RPC required
to catch a regression. The per-network eMode zod schemas are `z.strictObject`, not just
required-field checks, because `.strict()` is what catches the silently-corrupting direction (an
unrecognized extra key); a missing-field check alone only catches the direction that throws.

Would change my mind: nothing — this is measured fact, reproducible any time by re-running
`scripts/capture-fixtures.mjs` against a live endpoint. General lesson, stated plainly because it
generalizes past this task: for a testnet especially, verify against the deployment, not the repo
tag. Testnets accrete deployer-specific fields that never make it back into the canonical repo.

## 5. Reserve ids via getReserveAddressById multicall
`AggregatedReserveData` carries no reserve-id field at all, yet eMode bitmaps
(`collateralBitmap`/`borrowableBitmap`) index by the TRUE reserve id — and `Pool.getReservesList()`
COMPACTS dropped reserves, so "array index == id" is only true until the first reserve is ever
dropped from a market, after which every downstream bitmap lookup silently points at the wrong
asset. We probe `getReserveAddressById(0..len+7)` once per network via Multicall3, build an
address→id map, and hard-error if any reserve returned by `getReservesList` is missing from it.
Cost: one multicall, cached forever (`staleTime: Infinity`).
Would change my mind: the data provider exposing ids directly (it doesn't, on either verified
deployment).

## 6. WS push + query invalidation (not SSE, not raw polling, not WS-as-state)
The chain is the single source of truth. The server watches Pool logs over one upstream WSS per
network and pushes tiny `position-event` triggers; the client invalidates react-query keys and
refetches through the proxy. No mirror store — that is where stale-HF bugs are born. All failure
modes converge to a visible degraded mode with 5s polling. SSE would need a second push channel
for status; raw client polling costs O(tabs) upstream CUs.
Would change my mind: a hosted indexer with guaranteed latency AND key secrecy.

## 7. Own bigint aave-math instead of @aave/math-utils
@aave/math-utils drags the ethers-v5-era stack and BigNumber.js into a viem app, and hides the
rounding rules this task is graded on. We reimplemented WadRayMath/PercentageMath (half-up),
GenericLogic HF aggregation and eMode LT/LTV substitution in ~280 lines of pure bigint,
table-tested against verbatim Solidity semantics. Would change my mind: an official
viem-native Aave math package.

## 8. Web data layer: TanStack useQuery + wagmi core actions
The live-update layer invalidates by key family (`['reservesData', chainId]`…). wagmi's
`useReadContract` owns its own opaque keys, so every read hook is a `useQuery` with the mandated
key calling `readContract`/`multicall` from `wagmi/actions` — same transports, same proxy.
Would change my mind: wagmi exposing stable custom query keys.

## 9. Receipt-status discipline
Code review caught that every wallet-tx wait path treated a resolved
`waitForTransactionReceipt` as success. It doesn't mean that: viem's
`waitForTransactionReceipt` resolves once a transaction is **mined**, including when it mined
with `status: 'reverted'`. Left unchecked, a reverted approve or a reverted multicall would have
been reported to the user as a successfully opened position.
Chosen: `ensureReceiptSuccess(receipt, label)` throws a `ReceiptRevertedError` on any non-success
status, called after every receipt wait — the single-tx approve/multicall path and each step of
the sequential fallback. The fallback's step loop is a plain `for`-await, so a thrown revert stops
it immediately; a unit test asserts by `vi.fn` call count that no later step's `write()` is ever
invoked after an earlier step reverts. A reverted single-tx multicall surfaces as an error that
offers the step-by-step fallback (`suggestSequential: true`) — the same recovery path as a failed
preflight simulation, not a dead end.
Would change my mind: nothing — this is a correctness bug class (silent false-success), not a
judgment call.

## 10. HF boundary semantics
Spec: "hard floor HF > 1.0, warning zone < 1.1" — silent on whether HF exactly 1.0 is acceptable.
Options: allow HF == 1.0 (matches the protocol's own liquidation trigger, which fires at HF < 1.0,
not <=); or block it client-side as stricter-than-protocol.
Chosen: HF == 1.0 is blocked (`predictedHfWad <= WAD` is a validation error, not just a warning).
A position opened exactly at the liquidation boundary has no real margin — any single price tick
or index-accrual moment between simulate and mine liquidates it, which defeats the point of a
target-HF UX built around user-chosen safety margin. Warning zone is `1.0 < HF < 1.1`
(`WARN_HF_WAD = 1.1e18`, `apps/web/src/lib/plan.ts`).
Would change my mind: a brief that explicitly wants a "maximum leverage" mode.

## 11. eMode toggle gating
Spec says eMode should default on "when it strictly improves the position" but doesn't say what
enforces that once the toggle exists as UI state a user (or a bug) could flip.
Chosen: eMode is offered only when a shared category exists between the two picked assets, and it
defaults ON only when the category's LTV is **strictly** greater than the collateral's normal LTV
(`eModeRecommended = best.ltvBps > collateralView.ltvBps`). The check is enforced twice — once in
the form to set the default toggle state, and again, redundantly, inside the pure
`planOpenPosition` core, which re-derives `eModeRecommended` itself and only ever sets
`eModeCategoryToSet` when it holds. So even if a caller passed `eModeEnabled: true` for a
non-improving candidate, the pure planner — the same function whose output becomes the executed
call array — would not apply it. Belt-and-braces: the UI toggle is advisory; the planner is the
enforcement point.
Would change my mind: a category that ties on LTV but still helps via LT — not observed on either
target network's real listings.

## 12. Watcher resilience beyond the spec
Three failure modes surfaced only while implementing the WS watcher, not while writing the spec:
- **Backoff resets on proof-of-life, not on socket open.** Resetting the reconnect-attempt counter
  on `open` would let an endpoint that accepts-then-drops the connection hammer the upstream near
  the base backoff interval forever — each "successful" open would reset the counter before
  anything actually worked. The counter resets only on the first `newHeads` event, which is proof
  the connection is live, not just handshaked.
- **Gap repair has a low-water mark.** A failed `eth_getLogs` repair (rate limit, oversized range,
  timeout) must not silently lose the block range it was meant to cover. `#pendingRepairFromBlock`
  is set before the repair request and cleared only on success; a failed attempt leaves it set so
  the next reconnect retries from the original `fromBlock`, not from wherever `lastBlockSeen` has
  since advanced to.
- **`stop()` mid-connect can't crash the process.** A socket still in the CONNECTING readyState
  emits an `'error'` event asynchronously when closed early. Stripping all listeners before
  `close()` — the natural cleanup order — removes the handler that would have caught it, and an
  `'error'` event with zero listeners throws inside Node's `EventEmitter`. A permanent no-op error
  sink is attached immediately before `close()`/`terminate()` so this can't happen regardless of
  socket state at shutdown.
Would change my mind: none of these are judgment calls — each is a specific edge case confirmed
against `ws`/Node's documented event semantics, not a preference.
