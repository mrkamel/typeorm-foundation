import { describe, expect, it } from 'vitest';
import { FoundationError, NotFoundError, ValidationError, isFoundationError, isNotFoundError, isValidationError } from '../src/errors';

describe('isFoundationError', () => {
  it('accepts every error the library throws', () => {
    expect(isFoundationError(new FoundationError('message'))).toBe(true);
    expect(isFoundationError(new NotFoundError('message'))).toBe(true);
    expect(isFoundationError(new ValidationError('message'))).toBe(true);
  });

  it('rejects errors from outside the library', () => {
    expect(isFoundationError(new Error())).toBe(false);
  });
});

describe('isNotFoundError', () => {
  it('accepts a NotFoundError only', () => {
    expect(isNotFoundError(new NotFoundError('message'))).toBe(true);
    expect(isNotFoundError(new FoundationError('message'))).toBe(false);
  });

  it('rejects errors from outside the library', () => {
    expect(isNotFoundError(new Error())).toBe(false);
  });
});

describe('isValidationError', () => {
  it('accepts a ValidationError only', () => {
    expect(isValidationError(new ValidationError('message'))).toBe(true);
    expect(isValidationError(new FoundationError('message'))).toBe(false);
  });

  it('rejects errors from outside the library', () => {
    expect(isValidationError(new Error())).toBe(false);
  });
});
