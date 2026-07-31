import pino from 'pino'

/**
 * Pino factory with key redaction as a BACKSTOP. The real protection is that
 * DRPC_KEY only ever lives inside the makeUpstream closure (upstream.ts) and
 * is never placed on any object that could reach a log call.
 */
export function makeLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'DRPC_KEY',
          '*.DRPC_KEY',
          'config.DRPC_KEY',
          'headers["drpc-key"]',
          '*.headers["drpc-key"]',
          'req.headers["drpc-key"]',
          'err.options.headers["drpc-key"]',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  )
}
