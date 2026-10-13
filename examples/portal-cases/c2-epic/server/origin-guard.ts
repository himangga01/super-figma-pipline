import { type RequestHandler } from 'express'

export function epicMutationOriginGuard(applicationOrigin: string | undefined): RequestHandler {
  if (typeof applicationOrigin !== 'string' || new URL(applicationOrigin).origin !== applicationOrigin)
    throw Error('Exact APPLICATION_ORIGIN required')
  const origin = new URL(applicationOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw Error('HTTP application origin required')
  return (request, response, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.headers.origin !== applicationOrigin) {
      response.status(403).json({ error: 'ORIGIN_REJECTED' })
      return
    }
    next()
  }
}
