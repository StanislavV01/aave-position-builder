import { describe, expect, it } from 'vitest'
import { marketPaneState, positionPaneState, type QueryFlags } from './pane-state'

const ok: QueryFlags = { isError: false, isPending: false }
const err: QueryFlags = { isError: true, isPending: false }
const pending: QueryFlags = { isError: false, isPending: true }

describe('marketPaneState', () => {
  it('is loading while queries are pending and nothing failed', () => {
    expect(marketPaneState([pending, pending], false)).toBe('loading')
  })

  it('is error when any dependency failed and there is no view to show', () => {
    expect(marketPaneState([ok, err], false)).toBe('error')
    expect(marketPaneState([err, pending], false)).toBe('error')
  })

  it('stale data wins over a refetch error — never blank a pane that has content', () => {
    expect(marketPaneState([err, ok], true)).toBe('ready')
  })

  it('is ready when the view is built', () => {
    expect(marketPaneState([ok, ok], true)).toBe('ready')
  })
})

describe('positionPaneState', () => {
  it('is disconnected without a wallet, regardless of query state', () => {
    expect(positionPaneState(false, [err, err], false)).toBe('disconnected')
  })

  it('a connected user with a failed query sees error — not the connect prompt', () => {
    expect(positionPaneState(true, [ok, err, ok, ok], false)).toBe('error')
  })

  it('is loading while connected and queries are in flight', () => {
    expect(positionPaneState(true, [pending, ok], false)).toBe('loading')
  })

  it('shows the (possibly stale) position even when a refetch errored', () => {
    expect(positionPaneState(true, [err, ok], true)).toBe('ready')
  })
})
