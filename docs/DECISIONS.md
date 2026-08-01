# Decisions

## 1. What "optimal" means here
Options: cheapest gas; best rate across markets; max capital efficiency + risk-calibrated sizing.
Chosen: financial optimality of the position itself — eMode detection when the pair shares a
category (higher LTV, a concrete gain), borrow amount derived from a target health factor
(bidirectional), atomic single-tx execution with minimum signatures, simulated client-side
before any wallet prompt. Rate shopping/looping are out of scope.
Would change my mind: a brief that weights gas or multi-market yield.

## 2. RPC proxy for key secrecy
Options: key in the browser (VITE_ var); serverless edge proxy; own Fastify proxy.
Chosen: Fastify proxy with a method allowlist. A bundled key is public — anything shipped to the
browser is readable. The key is read once into a closure (`upstream.ts`) and sent
as the `Drpc-Key` header; `eth_sendRawTransaction` is not proxied — the wallet broadcasts through
its own provider. Would change my mind: a provider issuing domain-locked browser keys with hard
spend caps.

## 3. wagmi pinned to v2 (not v3)
wagmi 3 shipped recently; v2 is mature, peer-compatible with viem 2.x and react-query 5, and all
reference material targets it. Would change my mind: v3 reaching the same ecosystem maturity.

## 4. Per-network ABIs — verified against the deployment, not the repo tag
The biggest finding of the build, and a reversal of an earlier decision. Original plan: pin two
`getEModes` ABIs from `aave-v3-origin` repo tags (v3.6.0 vs v3.7/main), assuming the only
cross-version difference was `EModeCategory` gaining `bool isolated` in v3.7 (7 → 8 fields), with
`AggregatedReserveData` byte-identical everywhere.

That assumption was wrong, and it failed loudly first: decoding a real Base Sepolia
`getReservesData()` payload threw `InvalidBytesBooleanError`. Ground truth (Blockscout-verified
source, cross-checked against a captured payload): deployed Base Sepolia
`AggregatedReserveData` has 42 fields (extra `unbacked`, `virtualAccActive`) vs 40 on Base
mainnet. `getEModes` is worse — **neither** network uses the `isolated`-bearing 8-field shape the
plan called "v3.7"; Sepolia is a previously-unmodeled 6-field shape, Base mainnet is 7-field (has
`ltvzeroBitmap`, no `isolated`). Worst: `label: string` makes the eMode tuple dynamic, so decoding
the wrong network's shape doesn't throw — it silently fabricates a bogus trailing `ltvzeroBitmap`
field.

Chosen: both ABIs are now vendored per network from verified source, proven by two tests:
`packages/shared/src/abis/ui-pool-data-provider.test.ts` asserts per-network shapes/field
positions and the cross-network shape-mismatch rejection (base-shaped data decoded as sepolia,
and vice versa, both throw — the silent-corruption guard); `apps/web/src/lib/derived.test.ts`
decodes one captured real on-chain payload (`__fixtures__/base-sepolia.json`) through the same
code path the app uses. The eMode zod schemas are `z.strictObject`, not just required-field
checks — `.strict()` catches the corrupting direction (an unrecognized extra key).

Would change my mind: nothing — measured fact, reproducible via `scripts/capture-fixtures.mjs`
against a live endpoint. General lesson: for a testnet especially, verify against the deployment,
not the repo tag.

## 5. Reserve ids via getReserveAddressById multicall
`AggregatedReserveData` carries no reserve-id field, yet eMode bitmaps index by the TRUE reserve
id — and `Pool.getReservesList()` COMPACTS dropped reserves, so "array index == id" holds only
until the first reserve is dropped, after which bitmap lookups point at the wrong asset. We probe
`getReserveAddressById(0..len+7)` once per network via Multicall3, build an address→id map, and
hard-error if any listed reserve is missing. Cost: one multicall, cached forever.
Would change my mind: the data provider exposing ids directly (it doesn't, on either verified
deployment).

## 6. WS push + query invalidation (not SSE, not raw polling, not WS-as-state)
The chain is the single source of truth. The server watches Pool logs over one upstream WSS per
network and pushes tiny `position-event` triggers; the client invalidates react-query keys
(`['reservesData', chainId]`…) and refetches through the proxy. No mirror store — that's where
stale-HF bugs are born. Every read hook is a plain `useQuery` calling `readContract`/`multicall`
from `wagmi/actions`, not wagmi's own `useReadContract`, whose opaque keys can't be invalidated
by family. Failures converge to a visible degraded mode with 5s polling. SSE needs a second
channel for status; raw client polling costs O(tabs) upstream CUs.
Would change my mind: a hosted indexer with guaranteed latency AND key secrecy, or wagmi exposing
stable custom query keys.

## 7. Own bigint aave-math instead of @aave/math-utils
@aave/math-utils drags the ethers-v5-era stack and BigNumber.js into a viem app, and hides
rounding rules this task is graded on. We reimplemented WadRayMath/PercentageMath (half-up),
GenericLogic HF aggregation and eMode LT/LTV substitution in ~280 lines of pure bigint,
table-tested against Solidity semantics. Would change my mind: an official viem-native Aave math
package.

## 8. HF boundary semantics
Spec says "hard floor HF > 1.0, warning zone < 1.1" but is silent on HF exactly 1.0 — the
protocol's own liquidation trigger is HF < 1.0, not <=.
Chosen: block HF == 1.0 client-side (`predictedHfWad <= WAD` fails validation) — zero margin is
liquidated by the next index tick or price move, defeating the point of a target-HF UX. Warning
zone is `1.0 < HF < 1.1` (`WARN_HF_WAD = 1.1e18`, `plan.ts`).
Would change my mind: a brief that wants a "maximum leverage" mode.

## 9. Correctness hardening beyond the spec
Three defensive fixes found by tracing edge cases, not by design debate — short form: context →
what we do → would change my mind (noted once, for all three).

- **Receipt-status discipline.** viem's `waitForTransactionReceipt` resolves on any *mined* tx,
  including a reverted one; unchecked, a revert would have reported as a successful open.
  `ensureReceiptSuccess(receipt, label)` now gates every wait — single-tx path and each sequential
  fallback step — and a unit test proves the fallback loop stops immediately on a step revert (no
  later `write()` call). Would change my mind: nothing, a correctness bug class, not a preference.
- **eMode toggle gating.** Spec wants eMode on by default only when it strictly improves the
  position; nothing enforces that once it's UI state a rendering bug could flip.
  `eModeRecommended = best.ltvBps > collateralView.ltvBps` gates the form default AND is
  re-derived inside the pure `planOpenPosition` core — the same function whose output becomes the
  executed calls — so a form bug can't apply it when it wouldn't strictly help. Would change my
  mind: a tying category that still helps via LT (not observed on either target network).
- **Watcher resilience.** Three edge cases the spec's reconnect description didn't name: backoff
  resets only on the first live `newHeads` event, not on socket `open` (else an accept-then-drop
  endpoint gets hammered forever); a failed gap-repair range is retried via a low-water mark
  instead of being silently superseded by a later block; `stop()` mid-handshake attaches a
  permanent error sink before `close()`, since an unlistened `'error'` event on a still-connecting
  socket otherwise crashes the process. Would change my mind: nothing — confirmed against
  `ws`/Node's documented event semantics.
