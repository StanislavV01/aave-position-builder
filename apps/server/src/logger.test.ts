import { describe, expect, it } from 'vitest'
import { makeLogger } from './logger.js'

describe('makeLogger', () => {
  it('redacts drpc-key headers and DRPC_KEY fields wherever they appear', () => {
    const lines: string[] = []
    const logger = makeLogger({ write: (msg: string) => { lines.push(msg) } })
    logger.info({ headers: { 'drpc-key': 'CANARY_abc123' } }, 'outbound request')
    logger.info({ config: { DRPC_KEY: 'CANARY_abc123' } }, 'boot')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).not.toContain('CANARY_abc123')
    }
    expect(lines[0]).toContain('[REDACTED]')
  })
})
