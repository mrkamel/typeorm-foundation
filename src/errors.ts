import { singleton } from './singleton';

abstract class FoundationErrorClass extends Error {
  readonly isFoundationError = true; // Prevents TypeScript from narrowing the error type to "never"
}

export const FoundationError = singleton('FoundationError', () => FoundationErrorClass);
export type FoundationError = FoundationErrorClass;

class ArgumentErrorClass extends FoundationError {
  override readonly name = 'ArgumentError';
}

export const ArgumentError = singleton('ArgumentError', () => ArgumentErrorClass);
export type ArgumentError = ArgumentErrorClass;

class MissingValidationContextErrorClass extends FoundationError {
  override readonly name = 'MissingValidationContextError';
}

export const MissingValidationContextError = singleton('MissingValidationContextError', () => MissingValidationContextErrorClass);
export type MissingValidationContextError = MissingValidationContextErrorClass;

class NotFoundErrorClass extends FoundationError {
  override readonly name = 'NotFoundError';
}

export const NotFoundError = singleton('NotFoundError', () => NotFoundErrorClass);
export type NotFoundError = NotFoundErrorClass;

class ValidationErrorClass extends FoundationError {
  override readonly name = 'ValidationError';
  readonly errors: Record<string, string[]>;

  constructor(errors: string | Record<string, string[]>) {
    const normalizedErrors = typeof errors === 'string' ? { base: [errors] } : errors;
    const message = typeof errors === 'string' ? errors : Object.entries(errors).map(([key, value]) => `${key}: ${value.join(', ')}`).join('; ');

    super(message);

    this.errors = normalizedErrors;
  }
}

export const ValidationError = singleton('ValidationError', () => ValidationErrorClass);
export type ValidationError = ValidationErrorClass;
