export class BaseError extends Error { }

export class NotFoundError extends BaseError { }

export class ValidationError extends BaseError {
  errors: Record<string, string[]>;

  constructor(errors: string | Record<string, string[]>) {
    const normalizedErrors = typeof errors === 'string' ? { base: [errors] } : errors;
    const message = typeof errors === 'string' ? errors : Object.entries(errors).map(([key, value]) => `${key}: ${value.join(', ')}`).join('; ');

    super(message);
    this.name = 'ValidationError';
    this.errors = normalizedErrors;
  }
}
