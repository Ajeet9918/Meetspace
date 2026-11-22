import logger from '../utils/logger.js';

export const notFound = (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Payload too large' } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON' } });

  if (err.expose) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  // Unexpected: log server-side with a request id, return a generic message. No stack traces to clients.
  logger.error({ reqId: req.id, err: { name: err.name, message: err.message, stack: err.stack } }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
}
