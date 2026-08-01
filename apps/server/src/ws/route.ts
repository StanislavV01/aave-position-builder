import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Hub } from './hub.js'

export interface WsRouteOpts {
  hub: Hub
}

export async function wsRoutePlugin(app: FastifyInstance, opts: WsRouteOpts): Promise<void> {
  await app.register(websocket)
  // @fastify/websocket v11 handler signature: (socket, request) — socket is a ws.WebSocket
  app.get('/ws', { websocket: true }, (socket) => {
    opts.hub.handleSocket(socket)
  })
}
