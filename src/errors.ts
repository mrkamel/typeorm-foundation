import { singleton } from './singleton';

class FoundationErrorClass extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FoundationError';
  }
}

export const FoundationError = singleton('FoundationError', () => FoundationErrorClass);
export type FoundationError = FoundationErrorClass;
export const isFoundationError = (error: unknown): error is FoundationError => error instanceof FoundationError;

class NotFoundErrorClass extends FoundationError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NotFoundError';
  }
}

export const NotFoundError = singleton('NotFoundError', () => NotFoundErrorClass);
export type NotFoundError = NotFoundErrorClass;
export const isNotFoundError = (error: unknown): error is NotFoundError => error instanceof NotFoundError;

class ValidationErrorClass extends FoundationError {
  errors: Record<string, string[]>;

  constructor(errors: string | Record<string, string[]>) {
    const normalizedErrors = typeof errors === 'string' ? { base: [errors] } : errors;
    const message = typeof errors === 'string' ? errors : Object.entries(errors).map(([key, value]) => `${key}: ${value.join(', ')}`).join('; ');

    super(message);
    this.name = 'ValidationError';
    this.errors = normalizedErrors;
  }
}

export const ValidationError = singleton('ValidationError', () => ValidationErrorClass);
export type ValidationError = ValidationErrorClass;
export const isValidationError = (error: unknown): error is ValidationError => error instanceof ValidationError;
