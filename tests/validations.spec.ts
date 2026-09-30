import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import { ValidationError } from '../src';
import { ValidateUniqueness, isChanged, isDirty, isNew, validateOrFail, validationContext } from '../src/validations';
import { UserRepository } from './repositories/UserRepository';
import { TeamRepository } from './repositories/TeamRepository';

describe('ValidationError', () => {
  it('collects one message per invalid property', async () => {
    const user = UserRepository.create({ email: 'not-an-email', age: -5, teamId: null });

    await expect(UserRepository.insertEntity(user)).rejects.toMatchObject({
      errors: {
        email: expect.any(Array),
        age: ['must not be negative'],
      },
    });
  });

  it('accepts a plain message, filing it under the "base" key', () => {
    const error = new ValidationError('something went wrong');

    expect(error.message).toBe('something went wrong');
    expect(error.errors).toEqual({ base: ['something went wrong'] });
  });
});

describe('ValidateWith', () => {
  it('uses the custom message option instead of the message returned by the validator', async () => {
    const user = UserRepository.create({ email: 'msg@example.com', age: null, teamId: null, displayName: 'reserved' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('is not allowed');
  });

  it('passes when the validator returns no message', async () => {
    const user = UserRepository.create({ email: 'msg2@example.com', age: null, teamId: null, displayName: 'Ada' });

    await expect(UserRepository.insertEntity(user)).resolves.toBeDefined();
  });
});

describe('ValidateRelation', () => {
  it('fails with the default message when the referenced team does not exist', async () => {
    const user = UserRepository.create({ email: 'norelation@example.com', age: null, teamId: '00000000-0000-0000-0000-000000000000' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('teamId: reference is invalid');
  });

  it('fails with the message from the with callback when the team is archived', async () => {
    const team = await TeamRepository.insertEntity(TeamRepository.create({ name: 'Retired', code: 'retired-2', archived: true }));
    const user = UserRepository.create({ email: 'withcallback@example.com', age: null, teamId: team.id });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('team is archived');
  });

  it('passes when the with callback returns no message', async () => {
    const team = await TeamRepository.insertEntity(TeamRepository.create({ name: 'Active', code: 'active-1', archived: false }));
    const user = UserRepository.create({ email: 'withcallback2@example.com', age: null, teamId: team.id });

    await expect(UserRepository.insertEntity(user)).resolves.toBeDefined();
  });

  it('skips the lookup entirely when validateIf returns false', async () => {
    const user = UserRepository.create({ email: 'novalidate@example.com', age: null, teamId: null });

    await expect(UserRepository.insertEntity(user)).resolves.toBeDefined();
  });
});

describe('ValidateUniqueness', () => {
  it('allows saving an entity when the unique field is untouched', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'stable@example.com', age: null, teamId: null }));

    await expect(UserRepository.updateEntity(user, { age: 99 })).resolves.toMatchObject({ age: 99 });
  });

  it('re-validates the unique field once it changes', async () => {
    await UserRepository.insertEntity(UserRepository.create({ email: 'first@example.com', age: null, teamId: null }));
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'second@example.com', age: null, teamId: null }));

    await expect(UserRepository.updateEntity(user, { email: 'first@example.com' })).rejects.toThrow(ValidationError);
  });

  it('scopes uniqueness to the given fields, allowing the same code across scopes', async () => {
    await TeamRepository.insertEntity(TeamRepository.create({ name: 'Archived Sales', code: 'sales', archived: true }));

    await expect(
      TeamRepository.insertEntity(TeamRepository.create({ name: 'Active Sales', code: 'sales', archived: false }))
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate code within the same scope', async () => {
    await TeamRepository.insertEntity(TeamRepository.create({ name: 'Support', code: 'support', archived: false }));

    await expect(
      TeamRepository.insertEntity(TeamRepository.create({ name: 'Support 2', code: 'support', archived: false }))
    ).rejects.toThrow(ValidationError);
  });

  it('skips re-validation when the scoped field is untouched by the update', async () => {
    await TeamRepository.insertEntity(TeamRepository.create({ name: 'Existing', code: 'existing', archived: false }));
    const team = await TeamRepository.insertEntity(TeamRepository.create({ name: 'Other', code: 'other', archived: false }));

    await expect(TeamRepository.updateEntity(team, { name: 'Renamed' })).resolves.toBeDefined();
  });

  it('lets validateIf skip the check even when the value is undefined', async () => {
    class SkippableEntity {
      @ValidateUniqueness({ validateIf: () => false })
      name?: string;
    }

    const entity = new SkippableEntity();

    await expect(validateOrFail({ entity, entityManager: {} as EntityManager, original: null })).resolves.toBe(entity);
  });
});

describe('isNew', () => {
  it('returns true when there is no original snapshot', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {} }, () => {
      expect(isNew({ name: 'test' })).toBe(true);
    });
  });

  it('returns false when an original snapshot exists', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'test' }, customErrors: {} }, () => {
      expect(isNew({ name: 'test' })).toBe(false);
    });
  });
});

describe('isChanged', () => {
  it('treats a defined property as changed when there is no original snapshot', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {} }, () => {
      expect(isChanged({ name: 'test' }, 'name')).toBe(true);
    });
  });

  it('treats an undefined property as unchanged when there is no original snapshot', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {} }, () => {
      expect(isChanged({ name: undefined }, 'name')).toBe(false);
    });
  });

  it('compares the property against the original snapshot when one exists', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'old' }, customErrors: {} }, () => {
      expect(isChanged({ name: 'new' }, 'name')).toBe(true);
      expect(isChanged({ name: 'old' }, 'name')).toBe(false);
    });
  });
});

describe('isDirty', () => {
  it('is dirty for a new entity even when the property matches its default', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {} }, () => {
      expect(isDirty({ name: undefined }, 'name')).toBe(true);
    });
  });

  it('is dirty when an existing entity changed the property', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'old' }, customErrors: {} }, () => {
      expect(isDirty({ name: 'new' }, 'name')).toBe(true);
    });
  });

  it('is not dirty when an existing entity did not change the property', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'old' }, customErrors: {} }, () => {
      expect(isDirty({ name: 'old' }, 'name')).toBe(false);
    });
  });
});
