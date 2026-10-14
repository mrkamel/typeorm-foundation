import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import { IsString } from 'class-validator';
import { ArgumentError, ValidationError } from '../src';
import { References, validateOrFail, validationContext, ValidateWith } from '../src/validations';
import type { ValidationOperation } from '../src/validations';
import { dataSource } from './dataSource';
import { UserRepository } from './repositories/UserRepository';
import { TeamRepository } from './repositories/TeamRepository';
import { MembershipRepository } from './repositories/MembershipRepository';
import { AssignmentRepository } from './repositories/AssignmentRepository';
import { UserEntity } from './entities/UserEntity';
import { TeamEntity } from './entities/TeamEntity';
import { MembershipEntity } from './entities/MembershipEntity';
import { AssignmentEntity } from './entities/AssignmentEntity';

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
    const user = new UserEntity({ email: 'message@example.com', age: null, teamId: null, displayName: 'reserved' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('displayName: is not allowed');
  });


  it('passes when the validator returns no message', async () => {
    const user = new UserEntity({ email: 'message2@example.com', age: null, teamId: null, displayName: 'Ada' });

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

  it('passes the full related row to the validate callback', async () => {
    const team = await TeamRepository.insertEntity(new TeamEntity({ name: 'Research', code: 'research', slug: 'research-team', archived: false }));
    const relatedRows: TeamEntity[] = [];

    class FullRowEntity {
      @References<FullRowEntity, 'teamId', TeamEntity>(() => TeamEntity, { validate: (related) => void relatedRows.push(related) })
      teamId = team.id;
    }

    await validateOrFail({ entity: new FullRowEntity(), entityManager: dataSource.manager, operation: { type: 'insert' } });

    expect(relatedRows).toEqual([{ id: team.id, name: 'Research', code: 'research', slug: 'research-team', archived: false }]);
  });

  it('looks the reference up by a custom primaryKey', async () => {
    await TeamRepository.insertEntity(new TeamEntity({ name: 'Platform', code: 'platform', archived: false }));
    await MembershipRepository.insertEntity(new MembershipEntity({ organizationId: 'organization-1', id: 'membership-1' }));

    await expect(
      AssignmentRepository.insertEntity(new AssignmentEntity({ organizationId: 'organization-1', membershipId: 'membership-1', teamCode: 'platform' }))
    ).resolves.toBeDefined();

    await expect(
      AssignmentRepository.insertEntity(new AssignmentEntity({ organizationId: 'organization-1', membershipId: 'membership-1', teamCode: 'missing' }))
    ).rejects.toThrow('teamCode: reference is invalid');
  });

  it('matches every column of a composite key', async () => {
    await MembershipRepository.insertEntity(new MembershipEntity({ organizationId: 'organization-1', id: 'membership-1' }));

    await expect(
      AssignmentRepository.insertEntity(new AssignmentEntity({ organizationId: 'organization-1', membershipId: 'membership-1' }))
    ).resolves.toBeDefined();

    await expect(
      AssignmentRepository.insertEntity(new AssignmentEntity({ organizationId: 'organization-2', membershipId: 'membership-1' }))
    ).rejects.toThrow('membershipId: reference is invalid');
  });

  it('fails when part of a composite foreign key is missing', async () => {
    await MembershipRepository.insertEntity(new MembershipEntity({ organizationId: 'organization-1', id: 'membership-1' }));

    await expect(
      AssignmentRepository.insertEntity(new AssignmentEntity({ organizationId: 'organization-1', membershipId: null }))
    ).rejects.toThrow('membershipId: reference is invalid');
  });

  it('skips the lookup when a foreign key column is invalid', async () => {
    const error = await AssignmentRepository
      .insertEntity(new AssignmentEntity({ organizationId: 42 as unknown as string, membershipId: 'membership-1' }))
      .catch((error: unknown) => error) as ValidationError;

    expect(Object.keys(error.errors)).toEqual(['organizationId']);
  });

  it('rejects mismatched foreignKey and primaryKey columns at declaration', () => {
    expect(() => {
      class MismatchedEntity {
        @References<MismatchedEntity, 'membershipId', MembershipEntity>(() => MembershipEntity, { foreignKey: ['organizationId', 'membershipId'], primaryKey: 'id' })
        membershipId = 'membership-1';

        organizationId = 'organization-1';
      }

      return MismatchedEntity;
    }).toThrow(new ArgumentError('MismatchedEntity.membershipId: foreignKey and primaryKey must have the same number of columns'));
  });

  it('rejects a single foreign key against a composite primary key', async () => {
    class SingleKeyEntity {
      @References<SingleKeyEntity, 'membershipId', MembershipEntity>(() => MembershipEntity)
      membershipId = 'membership-1';
    }

    await expect(
      validateOrFail({ entity: new SingleKeyEntity(), entityManager: dataSource.manager, operation: { type: 'insert' } })
    ).rejects.toThrow(new ArgumentError(
      'SingleKeyEntity.membershipId: references 2 primary key column(s) of MembershipEntity with 1 foreign key column(s)'
    ));
  });

  it('rejects a misconfigured decorator even when the lookup would be skipped', async () => {
    class SkippedSingleKeyEntity {
      @References<SkippedSingleKeyEntity, 'membershipId', MembershipEntity>(() => MembershipEntity, { validateIf: (entity) => entity.membershipId != null })
      membershipId: string | null = null;
    }

    await expect(
      validateOrFail({ entity: new SkippedSingleKeyEntity(), entityManager: dataSource.manager, operation: { type: 'insert' } })
    ).rejects.toThrow(new ArgumentError(
      'SkippedSingleKeyEntity.membershipId: references 2 primary key column(s) of MembershipEntity with 1 foreign key column(s)'
    ));
  });

  it('rejects a foreignKey without the decorated property at declaration', () => {
    expect(() => {
      class ForeignKeyWithoutPropertyEntity {
        @References<ForeignKeyWithoutPropertyEntity, 'membershipId', MembershipEntity>(() => MembershipEntity, { foreignKey: ['organizationId', 'otherMembershipId'] })
        membershipId = 'membership-1';

        organizationId = 'organization-1';

        otherMembershipId = 'membership-1';
      }

      return ForeignKeyWithoutPropertyEntity;
    }).toThrow(new ArgumentError('ForeignKeyWithoutPropertyEntity.membershipId: foreignKey must include the decorated property'));
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
    const team = await TeamRepository.insertEntity(new TeamEntity({ name: 'Operations', code: 'operations', slug: 'operations-team', archived: false }));

    await expect(TeamRepository.updateEntity(team, { slug: 'OPERATIONS-TEAM' })).resolves.toMatchObject({ slug: 'OPERATIONS-TEAM' });
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

    await expect(validateOrFail({ entity: new OwnPropertyEntity(), entityManager: {} as EntityManager, operation: { type: 'insert' } })).rejects.toThrow(ValidationError);
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

    await expect(validateOrFail({ entity: new DeclaredDependencyEntity(), entityManager: {} as EntityManager, operation: { type: 'insert' } })).rejects.toThrow(ValidationError);
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

    await expect(validateOrFail({ entity: new UndeclaredDependencyEntity(), entityManager: {} as EntityManager, operation: { type: 'insert' } })).rejects.toThrow(ValidationError);
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

    await validateOrFail({ entity: new ContextProbeEntity(), entityManager: {} as EntityManager, operation: { type: 'insert' } });

    expect(seen).toEqual([true]);
  });
});

describe('ValidationHelpers', () => {
  const probeHelpers = async (operation: ValidationOperation) => {
    const results: Record<string, unknown>[] = [];

    class HelpersProbeEntity {
      @ValidateWith<HelpersProbeEntity, 'name'>((_value, _entity, { manager, isInsert, isUpdate, isUpsert, isDirty }) => {
        results.push({
          manager,
          isInsert: isInsert(),
          isUpdate: isUpdate(),
          isUpdateName: isUpdate('name'),
          isUpdateLabel: isUpdate('label'),
          isUpsert: isUpsert(),
          isUpsertNameKey: isUpsert('unique_probe_name'),
          isUpsertLabelKey: isUpsert('unique_probe_label'),
          isDirtyName: isDirty('name'),
          isDirtyLabel: isDirty('label'),
        });
      })
      name = 'probe';

      label = 'label';
    }

    await validateOrFail({ entity: new HelpersProbeEntity(), entityManager: dataSource.manager, operation });

    return results;
  };

  it('passes the entity manager', async () => {
    const [helpers] = await probeHelpers({ type: 'insert' });

    expect(helpers!.manager).toBe(dataSource.manager);
  });

  it('reports an insert, with every property dirty', async () => {
    await expect(probeHelpers({ type: 'insert' })).resolves.toEqual([expect.objectContaining({
      isInsert: true,
      isUpdate: false,
      isUpdateName: false,
      isUpdateLabel: false,
      isUpsert: false,
      isUpsertNameKey: false,
      isUpsertLabelKey: false,
      isDirtyName: true,
      isDirtyLabel: true,
    })]);
  });

  it('reports an update, with only the updated properties dirty', async () => {
    await expect(probeHelpers({ type: 'update', properties: ['name'] })).resolves.toEqual([expect.objectContaining({
      isInsert: false,
      isUpdate: true,
      isUpdateName: true,
      isUpdateLabel: false,
      isUpsert: false,
      isUpsertNameKey: false,
      isUpsertLabelKey: false,
      isDirtyName: true,
      isDirtyLabel: false,
    })]);
  });

  it('reports an upsert on its keyName, with every property dirty', async () => {
    await expect(probeHelpers({ type: 'upsert', keyName: 'unique_probe_name' })).resolves.toEqual([expect.objectContaining({
      isInsert: false,
      isUpdate: false,
      isUpdateName: false,
      isUpdateLabel: false,
      isUpsert: true,
      isUpsertNameKey: true,
      isUpsertLabelKey: false,
      isDirtyName: true,
      isDirtyLabel: true,
    })]);
  });

  it('matches no keyName for an upsert on the primary key', async () => {
    await expect(probeHelpers({ type: 'upsert', keyName: undefined })).resolves.toEqual([expect.objectContaining({
      isUpsert: true,
      isUpsertNameKey: false,
      isUpsertLabelKey: false,
    })]);
  });
});
