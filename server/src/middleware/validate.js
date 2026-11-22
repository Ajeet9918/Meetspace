import { AppError } from '../utils/errors.js';

/** Validates req.body against a zod schema and replaces it with the parsed (trimmed, typed, stripped) result. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const err = new AppError(400, 'VALIDATION', 'Invalid input');
    err.details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(err);
  }
  req.body = result.data;
  return next();
};
