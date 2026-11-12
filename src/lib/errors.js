export class AppError extends Error {
  constructor(status, message, code = 'error', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, status, message, code) {
  if (!condition) throw new AppError(status, message, code);
}

export function notFound(message = 'Not found') {
  return new AppError(404, message, 'not_found');
}

export function forbidden(message = 'You do not have permission to do that.') {
  return new AppError(403, message, 'forbidden');
}

export function validation(message) {
  return new AppError(422, message, 'validation_error');
}
