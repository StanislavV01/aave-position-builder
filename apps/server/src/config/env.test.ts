import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'

describe('loadEnv', () => {
  it('parses a fully specified environment', () => {
    const env = loadEnv({
      DRPC_KEY: 'k1',
      PORT: '9000',
      HOST: '0.0.0.0',
      DRPC_HTTP_BASE: 'https://example.test',
      DRPC_WSS_BASE: 'wss://example.test',
    })
    expect(env).toEqual({
      DRPC_KEY: 'k1',
      PORT: 9000,
      HOST: '0.0.0.0',
      DRPC_HTTP_BASE: 'https://example.test',
      DRPC_WSS_BASE: 'wss://example.test',
    })
  })

  it('applies defaults when only DRPC_KEY is set', () => {
    const env = loadEnv({ DRPC_KEY: 'k1' })
    expect(env.PORT).toBe(8787)
    expect(env.HOST).toBe('127.0.0.1')
    expect(env.DRPC_HTTP_BASE).toBe('https://lb.drpc.live')
    expect(env.DRPC_WSS_BASE).toBe('wss://lb.drpc.live')
  })

  it('throws an actionable message when DRPC_KEY is missing', () => {
    expect(() => loadEnv({})).toThrowError(/DRPC_KEY missing — see \.env\.example/)
  })

  it('throws the same message when DRPC_KEY is empty', () => {
    expect(() => loadEnv({ DRPC_KEY: '' })).toThrowError(/DRPC_KEY missing — see \.env\.example/)
  })

  it('rejects a non-numeric PORT with a message naming PORT', () => {
    expect(() => loadEnv({ DRPC_KEY: 'k1', PORT: 'abc' })).toThrowError(/PORT/)
  })
})
