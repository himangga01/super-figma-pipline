/* eslint-disable import/no-duplicates */
import 'react-router'
import { createRequestHandler } from '@react-router/express'
import express from 'express'
import { type ServerBuild } from 'react-router'
import { epicMutationOriginGuard } from './origin-guard.ts'

declare module 'react-router' {
  interface AppLoadContext {
    serverBuild: ServerBuild
  }
}

export const app = express()

app.use(epicMutationOriginGuard(process.env['APPLICATION_ORIGIN']))
app.use(
  createRequestHandler({
    mode: process.env.NODE_ENV ?? 'development',
    build: () => import('virtual:react-router/server-build'),
    getLoadContext: async () => ({
      serverBuild: await import('virtual:react-router/server-build'),
    }),
  }),
)
