import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import { IsString } from 'class-validator';
import { ValidationError } from '../src';
import { isChanged, isDirty, isNew, validateOrFail, validationContext, ValidateWith } from '../src/validations';
import { UserRepository } from './repositories/UserRepository';
import { TeamRepository } from './repositories/TeamRepository';
import { UserEntity } from './entities/UserEntity';
import { TeamEntity } from './entities/TeamEntity';

describe('ValidationError', () => {
  it('collects one message per invalid property', async () => {
    const user = new UserEntity({ email: 'not-an-email', age: -5, teamId: null });

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
  it('fails with the message returned by the validator', async () => {
    const user = new UserEntity({ email: 'msg@example.com', age: null, teamId: null, displayName: 'reserved' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('displayName: is not allowed');
  });


  it('passes when the validator returns no message', async () => {
    const user = new UserEntity({ email: 'msg2@example.com', age: null, teamId: null, displayName: 'Ada' });

    await expect(UserRepository.insertEntity(user)).resolves.toBeDefined();
  });
});

describe('References', () => {
  it('fails with the default message when the referenced team does not exist', async () => {
    const user = new UserEntity({ email: 'norelation@example.com', age: null, teamId: '00000000-0000-0000-0000-000000000000' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('teamId: reference is invalid');
  });

  it('fails with the message from the validate callback when the team is archived', async () => {
    const team = await TeamRepository.insertEntity(new TeamEntity({ name: 'Retired', code: 'retired-2', archived: true }));
    const user = new UserEntity({ email: 'withcallback@example.com', age: null, teamId: team.id });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('team is archived');
  });

  it('passes when the validate callback returns no message', async () => {
    const team = await TeamRepository.insertEntity(new TeamEntity({ name: 'Active', code: 'active-1', archived: false }));
    const user = new UserEntity({ email: 'withcallback2@example.com', age: null, teamId: team.id });

    await expect(UserRepository.insertEntity(user)).resolves.toBeDefined();
  });

  it('skips the lookup entirely when validateIf returns false', async () => {
    const user = new UserEntity({ email: 'novalidate@example.com', age: null, teamId: null });

    await expect(UserRepository.insertEntity(user)).resolves.toBeDefined();
  });
});

describe('IsUnique', () => {
  it('allows saving an entity when the unique field is untouched', async () => {
    const user = await UserRepository.insertEntity(new UserEntity({ email: 'stable@example.com', age: null, teamId: null }));

    await expect(UserRepository.updateEntity(user, { age: 99 })).resolves.toMatchObject({ age: 99 });
  });

  it('re-validates the unique field once it changes', async () => {
    await UserRepository.insertEntity(new UserEntity({ email: 'first@example.com', age: null, teamId: null }));
    const user = await UserRepository.insertEntity(new UserEntity({ email: 'second@example.com', age: null, teamId: null }));

    await expect(UserRepository.updateEntity(user, { email: 'first@example.com' })).rejects.toThrow(ValidationError);
  });

  it('scopes uniqueness to the given fields, allowing the same code across scopes', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Archived Sales', code: 'sales', archived: true }));

    await expect(
      TeamRepository.insertEntity(new TeamEntity({ name: 'Active Sales', code: 'sales', archived: false }))
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate code within the same scope', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Support', code: 'support', archived: false }));

    await expect(
      TeamRepository.insertEntity(new TeamEntity({ name: 'Support 2', code: 'support', archived: false }))
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a duplicate that differs only in case when caseInsensitive is set', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Design', code: 'design', slug: 'Design-Team', archived: false }));

    await expect(
      TeamRepository.insertEntity(new TeamEntity({ name: 'Design 2', code: 'design-2', slug: 'design-TEAM', archived: false }))
    ).rejects.toThrow(ValidationError);
  });

  it('still allows a genuinely different value when caseInsensitive is set', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Legal', code: 'legal', slug: 'legal-team', archived: false }));

    await expect(
      TeamRepository.insertEntity(new TeamEntity({ name: 'Legal 2', code: 'legal-2', slug: 'legal-team-2', archived: false }))
    ).resolves.toBeDefined();
  });

  it('ignores case differences against the entity itself when caseInsensitive is set', async () => {
    const team = await TeamRepository.insertEntity(new TeamEntity({ name: 'Ops', code: 'ops', slug: 'ops-team', archived: false }));

    await expect(TeamRepository.updateEntity(team, { slug: 'OPS-TEAM' })).resolves.toMatchObject({ slug: 'OPS-TEAM' });
  });

  it('skips re-validation when the scoped field is untouched by the update', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Existing', code: 'existing', archived: false }));
    const team = await TeamRepository.insertEntity(new TeamEntity({ name: 'Other', code: 'other', archived: false }));

    await expect(TeamRepository.updateEntity(team, { name: 'Renamed' })).resolves.toBeDefined();
  });
});

describe('dependencies', () => {
  it('skips the uniqueness lookup when a scope property is invalid', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Taken', code: 'taken', archived: false }));

    const team = new TeamEntity({ name: 'Second', code: 'taken', archived: 'maybe' as unknown as boolean });
    const error = await TeamRepository.insertEntity(team).catch((error: unknown) => error) as ValidationError;

    expect(Object.keys(error.errors)).toEqual(['archived']);
  });

  it('still validates properties whose dependencies came through the standard pass', async () => {
    const user = new UserEntity({ email: 'not-an-email', age: null, teamId: '00000000-0000-0000-0000-000000000000' });
    const error = await UserRepository.insertEntity(user).catch((error: unknown) => error) as ValidationError;

    expect(Object.keys(error.errors).sort()).toEqual(['email', 'teamId']);
  });

  it('skips a validator when its own property is invalid', async () => {
    const calls: unknown[] = [];

    class OwnPropertyEntity {
      @IsString()
      @ValidateWith<OwnPropertyEntity, 'name'>((value) => void calls.push(value))
      name: unknown = 42;
    }

    await expect(validateOrFail({ entity: new OwnPropertyEntity(), entityManager: {} as EntityManager, original: null })).rejects.toThrow(ValidationError);
    expect(calls).toEqual([]);
  });

  it('skips a validator when a declared dependency is invalid', async () => {
    const calls: unknown[] = [];

    class DeclaredDependencyEntity {
      @IsString()
      code: unknown = 42;

      @ValidateWith<DeclaredDependencyEntity, 'label'>((value) => void calls.push(value), { dependencies: ['code'] })
      label = 'fine';
    }

    await expect(validateOrFail({ entity: new DeclaredDependencyEntity(), entityManager: {} as EntityManager, original: null })).rejects.toThrow(ValidationError);
    expect(calls).toEqual([]);
  });

  it('runs a validator when an invalid sibling property is not declared as a dependency', async () => {
    const calls: unknown[] = [];

    class UndeclaredDependencyEntity {
      @IsString()
      code: unknown = 42;

      @ValidateWith<UndeclaredDependencyEntity, 'label'>((value) => void calls.push(value))
      label = 'fine';
    }

    await expect(validateOrFail({ entity: new UndeclaredDependencyEntity(), entityManager: {} as EntityManager, original: null })).rejects.toThrow(ValidationError);
    expect(calls).toEqual(['fine']);
  });
});

describe('validationContext', () => {
  it('is reachable from a decorator running inside a validateOrFail context', async () => {
    const seen: boolean[] = [];

    class ContextProbeEntity {
      @ValidateWith<ContextProbeEntity, 'name'>(() => {
        seen.push(Boolean(validationContext.getStore()));
      })
      name = 'probe';
    }

    await validateOrFail({ entity: new ContextProbeEntity(), entityManager: {} as EntityManager, original: null });

    expect(seen).toEqual([true]);
  });
});

describe('isNew', () => {
  it('returns true when there is no original snapshot', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isNew({ name: 'test' })).toBe(true);
    });
  });

  it('returns false when an original snapshot exists', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'test' }, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isNew({ name: 'test' })).toBe(false);
    });
  });
});

describe('isChanged', () => {
  it('treats a defined property as changed when there is no original snapshot', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isChanged({ name: 'test' }, 'name')).toBe(true);
    });
  });

  it('treats an undefined property as unchanged when there is no original snapshot', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isChanged({ name: undefined }, 'name')).toBe(false);
    });
  });

  it('compares the property against the original snapshot when one exists', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'old' }, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isChanged({ name: 'new' }, 'name')).toBe(true);
      expect(isChanged({ name: 'old' }, 'name')).toBe(false);
    });
  });
});

describe('isDirty', () => {
  it('is dirty for a new entity even when the property matches its default', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: null, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isDirty({ name: undefined }, 'name')).toBe(true);
    });
  });

  it('is dirty when an existing entity changed the property', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'old' }, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isDirty({ name: 'new' }, 'name')).toBe(true);
    });
  });

  it('is not dirty when an existing entity did not change the property', () => {
    validationContext.run({ entityManager: {} as EntityManager, original: { name: 'old' }, customErrors: {}, firstPassInvalidProperties: null }, () => {
      expect(isDirty({ name: 'old' }, 'name')).toBe(false);
    });
  });
});
