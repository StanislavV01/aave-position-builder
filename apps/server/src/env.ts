import { z } from 'zod'

export interface Env {
  DRPC_KEY: string
  PORT: number
  DRPC_HTTP_BASE: string
  DRPC_WSS_BASE: string
  HOST: string
}

const envSchema = z.object({
  DRPC_KEY: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default('127.0.0.1'),
  DRPC_HTTP_BASE: z.string().min(1).default('https://lb.drpc.live'),
  DRPC_WSS_BASE: z.string().min(1).default('wss://lb.drpc.live'),
})

const HINTS: Record<string, string> = {
  DRPC_KEY: 'DRPC_KEY missing — see .env.example',
  PORT: 'PORT must be an integer between 1 and 65535 (default 8787)',
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse({
    DRPC_KEY: source.DRPC_KEY,
    PORT: source.PORT,
    HOST: source.HOST,
    DRPC_HTTP_BASE: source.DRPC_HTTP_BASE,
    DRPC_WSS_BASE: source.DRPC_WSS_BASE,
  })
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const field = String(issue.path[0] ?? 'env')
      return HINTS[field] ?? `${field}: ${issue.message}`
    })
    throw new Error(`Invalid environment:\n${[...new Set(lines)].join('\n')}`)
  }
  return result.data
}
