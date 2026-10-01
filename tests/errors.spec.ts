import { describe, expect, it } from 'vitest';
import {
  ArgumentError,
  MissingValidationContextError,
  NotFoundError,
  ValidationError,
  isArgumentError,
  isFoundationError,
  isMissingValidationContextError,
  isNotFoundError,
  isValidationError,
} from '../src/errors';

describe('isFoundationError', () => {
  it('accepts every error the library throws', () => {
    expect(isFoundationError(new NotFoundError('message'))).toBe(true);
    expect(isFoundationError(new ValidationError('message'))).toBe(true);
    expect(isFoundationError(new ArgumentError('message'))).toBe(true);
    expect(isFoundationError(new MissingValidationContextError('message'))).toBe(true);
  });

  it('rejects errors from outside the library', () => {
    expect(isFoundationError(new Error())).toBe(false);
  });
});

describe('isArgumentError', () => {
  it('accepts an ArgumentError only', () => {
    expect(isArgumentError(new ArgumentError('message'))).toBe(true);
    expect(isArgumentError(new ValidationError('message'))).toBe(false);
  });

  it('rejects errors from outside the library', () => {
    expect(isArgumentError(new Error())).toBe(false);
  });
});

describe('isMissingValidationContextError', () => {
  it('accepts a MissingValidationContextError only', () => {
    expect(isMissingValidationContextError(new MissingValidationContextError('message'))).toBe(true);
    expect(isMissingValidationContextError(new ValidationError('message'))).toBe(false);
  });

  it('rejects errors from outside the library', () => {
    expect(isMissingValidationContextError(new Error())).toBe(false);
  });
});

describe('isNotFoundError', () => {
  it('accepts a NotFoundError only', () => {
    expect(isNotFoundError(new NotFoundError('message'))).toBe(true);
    expect(isNotFoundError(new ValidationError('message'))).toBe(false);
  });

  it('rejects errors from outside the library', () => {
    expect(isNotFoundError(new Error())).toBe(false);
  });
});

describe('isValidationError', () => {
  it('accepts a ValidationError only', () => {
    expect(isValidationError(new ValidationError('message'))).toBe(true);
    expect(isValidationError(new NotFoundError('message'))).toBe(false);
  });

  it('rejects errors from outside the library', () => {
    expect(isValidationError(new Error())).toBe(false);
  });
});
