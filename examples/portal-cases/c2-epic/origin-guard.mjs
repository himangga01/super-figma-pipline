/** Mount before Epic's createRequestHandler. Origin is an explicit admitted environment value. */
export function epicMutationOriginGuard(applicationOrigin) {
  if (typeof applicationOrigin !== 'string' || new URL(applicationOrigin).origin !== applicationOrigin) throw Error('Exact APPLICATION_ORIGIN required');
  const value = new URL(applicationOrigin);
  if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) throw Error('HTTP application origin required');
  return (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin !== applicationOrigin) {
      res.status(403).json({ error: 'ORIGIN_REJECTED' }); return;
    }
    next();
  };
}
