import { describe, expect, it } from 'vitest'
import { WS_PROTOCOL_VERSION, parseClientMessage } from './ws-protocol'

const valid = {
  v: 1,
  type: 'watch',
  network: 'base-sepolia',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
} as const

describe('parseClientMessage', () => {
  it('protocol version is 1', () => {
    expect(WS_PROTOCOL_VERSION).toBe(1)
  })
  it('accepts a valid watch object', () => {
    expect(parseClientMessage(valid)).toEqual(valid)
  })
  it('accepts a valid watch as JSON string', () => {
    expect(parseClientMessage(JSON.stringify(valid))).toEqual(valid)
  })
  it('accepts a valid watch as Buffer (what ws hands the server)', () => {
    const encoder = new TextEncoder()
    const buffer = encoder.encode(JSON.stringify(valid))
    expect(parseClientMessage(buffer)).toEqual(valid)
  })
  it('rejects wrong protocol version', () => {
    expect(parseClientMessage({ ...valid, v: 2 })).toBeNull()
  })
  it('rejects unknown type', () => {
    expect(parseClientMessage({ ...valid, type: 'subscribe' })).toBeNull()
  })
  it('rejects unknown network', () => {
    expect(parseClientMessage({ ...valid, network: 'ethereum' })).toBeNull()
  })
  it('rejects malformed address', () => {
    expect(parseClientMessage({ ...valid, address: '0x1234' })).toBeNull()
    expect(parseClientMessage({ ...valid, address: 'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })).toBeNull()
  })
  it('rejects garbage', () => {
    expect(parseClientMessage('not json')).toBeNull()
    expect(parseClientMessage(new Uint8Array([0xff, 0xfe]))).toBeNull()
    expect(parseClientMessage(null)).toBeNull()
    expect(parseClientMessage(42)).toBeNull()
    expect(parseClientMessage({})).toBeNull()
    expect(parseClientMessage({ v: 1, type: 'watch' })).toBeNull()
  })
})
