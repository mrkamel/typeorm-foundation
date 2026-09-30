import { describe, expect, it, vi } from 'vitest';
import { NotFoundError, BaseError, ValidationError, createRepositoryFactory } from '../src';
import { database, dataSource } from './dataSource';
import { UserRepository } from './repositories/UserRepository';
import { TeamRepository } from './repositories/TeamRepository';
import { createBaseRepository } from './repositories/createBaseRepository';
import { UserEntity } from './entities/UserEntity';

describe('BaseError', () => {
  it('is the base class every library error extends', () => {
    expect(new NotFoundError('not found')).toBeInstanceOf(BaseError);
    expect(new ValidationError({})).toBeInstanceOf(BaseError);
  });
});

describe('insertEntity', () => {
  it('inserts a valid entity', async () => {
    const user = UserRepository.create({ email: 'ada@example.com', age: 30, teamId: null });

    await UserRepository.insertEntity(user);

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.email).toBe('ada@example.com');
  });

  it('throws a ValidationError for an invalid entity', async () => {
    const user = UserRepository.create({ email: 'not-an-email', age: -1, teamId: null });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow(ValidationError);
  });

  it('calls validateEntityOrFail with null to run all field validations', async () => {
    const repository = createBaseRepository(UserEntity);
    const validateEntityOrFailSpy = vi.spyOn(repository, 'validateEntityOrFail');
    const user = repository.create({ email: 'spy@example.com', age: null, teamId: null });

    await repository.insertEntity(user);

    expect(validateEntityOrFailSpy).toHaveBeenCalledWith(user, null);
  });

  it('rejects a duplicate email', async () => {
    await UserRepository.insertEntity(UserRepository.create({ email: 'dup@example.com', age: null, teamId: null }));

    await expect(
      UserRepository.insertEntity(UserRepository.create({ email: 'dup@example.com', age: null, teamId: null }))
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a teamId that does not exist', async () => {
    const user = UserRepository.create({ email: 'noteam@example.com', age: null, teamId: '00000000-0000-0000-0000-000000000000' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow(ValidationError);
  });

  it('rejects a teamId belonging to an archived team', async () => {
    const team = await TeamRepository.insertEntity(TeamRepository.create({ name: 'Retired', code: 'retired-1', archived: true }));
    const user = UserRepository.create({ email: 'archived@example.com', age: null, teamId: team.id });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('team is archived');
  });

  it('accepts a teamId that exists and is not archived', async () => {
    const team = await TeamRepository.insertEntity(TeamRepository.create({ name: 'Engineering', code: 'eng-1', archived: false }));
    const user = UserRepository.create({ email: 'hasteam@example.com', age: null, teamId: team.id });

    await UserRepository.insertEntity(user);

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.teamId).toBe(team.id);
  });

  it('rejects a reserved display name with its custom message', async () => {
    const user = UserRepository.create({ email: 'reserved@example.com', age: null, teamId: null, displayName: 'reserved' });

    await expect(UserRepository.insertEntity(user)).rejects.toThrow('is not allowed');
  });
});

describe('updateEntity', () => {
  it('is a no-op when there are no updates', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'noop@example.com', age: null, teamId: null }));
    const updatedAt = user.updatedAt;

    await UserRepository.updateEntity(user, {});

    expect(user.updatedAt).toEqual(updatedAt);
  });

  it('persists changes and bumps every update-date column', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'change@example.com', age: 20, teamId: null }));
    const updatedAt = user.updatedAt;
    const syncedAt = user.syncedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await UserRepository.updateEntity(user, { age: 21 });

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.age).toBe(21);
    expect(stored.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    expect(stored.syncedAt.getTime()).toBeGreaterThan(syncedAt.getTime());
  });

  it('does not override an explicitly provided update-date column', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'explicit@example.com', age: null, teamId: null }));
    const explicitDate = new Date('2020-01-01T00:00:00Z');

    await UserRepository.updateEntity(user, { age: 1, updatedAt: explicitDate });

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.updatedAt).toEqual(explicitDate);
  });

  it('skips the update call when no registered column actually changed', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'unchanged-value@example.com', age: 5, teamId: null }));
    const updatedAt = user.updatedAt;

    const result = await UserRepository.updateEntity(user, { age: 5 });

    expect(result.updatedAt).toEqual(updatedAt);
  });

  it('does not re-validate an unchanged unique field', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'unchanged@example.com', age: null, teamId: null }));

    await expect(UserRepository.updateEntity(user, { age: 5 })).resolves.toBeDefined();
  });

  it('rejects updating to an email already taken by another row', async () => {
    await UserRepository.insertEntity(UserRepository.create({ email: 'taken@example.com', age: null, teamId: null }));
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'free@example.com', age: null, teamId: null }));

    await expect(UserRepository.updateEntity(user, { email: 'taken@example.com' })).rejects.toThrow(ValidationError);
  });

  it('runs beforeUpdate then afterUpdate listeners around the persisted change', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'listeners@example.com', age: 1, teamId: null }));

    await UserRepository.updateEntity(user, { age: 2 });

    expect(UserEntity.hookCalls).toEqual(['before', 'after']);
  });

  it('still runs listeners even when no registered column actually changed', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'listeners-noop@example.com', age: 3, teamId: null }));

    await UserRepository.updateEntity(user, { age: 3 });

    expect(UserEntity.hookCalls).toEqual(['before', 'after']);
  });

  it('skips validation and listeners when the updates object is empty', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'listeners-skip@example.com', age: null, teamId: null }));

    await UserRepository.updateEntity(user, {});

    expect(UserEntity.hookCalls).toEqual([]);
  });
});

describe.skipIf(database !== 'postgres')('upsertEntity', () => {
  it('inserts a new row on conflict-free values', async () => {
    const user = UserRepository.create({ email: 'fresh@example.com', age: null, teamId: null });

    await UserRepository.upsertEntity(user, { updates: ['age'], key: ['id'] });

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.email).toBe('fresh@example.com');
  });

  it('updates the row on a conflicting key', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'conflict@example.com', age: 1, teamId: null }));

    await UserRepository.upsertEntity(UserRepository.create({ id: user.id, email: user.email, age: 2, teamId: null }), { updates: ['age'], key: ['id'] });

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.age).toBe(2);
  });

  it('accepts an object of values for updates, merging them onto the entity', async () => {
    const user = UserRepository.create({ email: 'objectform@example.com', teamId: null });

    await UserRepository.upsertEntity(user, { updates: { age: 7 }, key: ['id'] });

    expect(user.age).toBe(7);
    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.age).toBe(7);
  });

  it('throws a BaseError when no update fields are given', async () => {
    const user = UserRepository.create({ email: 'noupdates@example.com', age: null, teamId: null });

    await expect(UserRepository.upsertEntity(user, { updates: [] as any })).rejects.toThrow(BaseError);
    await expect(UserRepository.upsertEntity(user, { updates: [] as any })).rejects.toThrow('At least one update field must be specified for upsertEntity');
  });

  it('automatically bumps update-date columns not already in updates', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'autobump@example.com', age: 1, teamId: null }));
    const updatedAt = user.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await UserRepository.upsertEntity(UserRepository.create({ id: user.id, email: user.email, age: 2, teamId: null }), { updates: ['age'], key: ['id'] });

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
  });

  it('does not override an explicitly provided update-date column', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'explicit-upsert@example.com', age: null, teamId: null }));
    const explicitDate = new Date('2020-01-01T00:00:00Z');

    await UserRepository.upsertEntity(
      UserRepository.create({ id: user.id, email: user.email, age: 1, teamId: null, updatedAt: explicitDate }),
      { updates: ['age', 'updatedAt'] as any, key: ['id'] }
    );

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.updatedAt).toEqual(explicitDate);
  });

  it('uses the @Column({ name }) database name in the conflict clause and RETURNING * hydration', async () => {
    const user = UserRepository.create({ email: 'dbname@example.com', age: null, teamId: null, displayName: 'Ada' });

    await UserRepository.upsertEntity(user, { updates: ['displayName'] as any, key: ['id'] });

    const [rawRow] = await dataSource.query('SELECT display_name FROM users WHERE id = $1', [user.id]);
    expect(rawRow.display_name).toBe('Ada');

    const stored = await UserRepository.findOneOrFail({ where: { id: user.id } });
    expect(stored.displayName).toBe('Ada');
  });

  it('applies the column transformer to values returned from RETURNING * before assigning them onto the entity', async () => {
    const user = UserRepository.create({ email: 'transformer@example.com', age: null, teamId: null, score: 42 });

    const result = await UserRepository.upsertEntity(user, { updates: ['score'] as any, key: ['id'] });

    expect(result.score).toBe(42);
    expect(typeof result.score).toBe('number');
  });
});

describe('upsertOrFailBy', () => {
  it('inserts when no matching row exists', async () => {
    const user = await UserRepository.upsertOrFailBy({ email: 'created@example.com' }, { age: 1, teamId: null });

    expect(user.age).toBe(1);
  });

  it('updates when a matching row exists', async () => {
    await UserRepository.insertEntity(UserRepository.create({ email: 'existing@example.com', age: 1, teamId: null }));

    const user = await UserRepository.upsertOrFailBy({ email: 'existing@example.com' }, { age: 2 });

    expect(user.age).toBe(2);
  });
});

describe('removeEntity', () => {
  it('removes the row and leaves the original entity object with its primary key intact', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'removeme@example.com', age: null, teamId: null }));
    const id = user.id;

    const result = await UserRepository.removeEntity(user);

    expect(result).toBe(user);
    expect(result.id).toBe(id);
    await expect(UserRepository.findOneOrFail({ where: { id } })).rejects.toThrow();
  });
});

describe('reload', () => {
  it('throws NotFoundError once the row has been removed', async () => {
    const user = await UserRepository.insertEntity(UserRepository.create({ email: 'reloadme@example.com', age: null, teamId: null }));

    await UserRepository.removeEntity(user);

    await expect(UserRepository.reload(user)).rejects.toThrow(NotFoundError);
  });
});

describe('custom extensions passed into the factory', () => {
  it('exposes the extension function on every repository the factory creates', async () => {
    for (let index = 0; index < 3; index += 1) {
      await UserRepository.insertEntity(UserRepository.create({ email: `count${index}@example.com`, age: null, teamId: null }));
    }

    await expect(UserRepository.countAll()).resolves.toBe(3);
    await expect(TeamRepository.countAll()).resolves.toBe(0);
  });

  it('still works when the factory is given no extensions at all', async () => {
    const bareCreateBaseRepository = createRepositoryFactory(dataSource);
    const repository = bareCreateBaseRepository(UserEntity);

    const user = await repository.insertEntity(repository.create({ email: 'bare@example.com', age: null, teamId: null }));

    const stored = await repository.findOneOrFail({ where: { id: user.id } });
    expect(stored.email).toBe('bare@example.com');
  });
});

describe('override', () => {
  it('assigns custom methods onto the repository and returns the same reference', () => {
    const repository = createBaseRepository(UserEntity);
    const custom = { greet: () => 'hello' };

    const result = repository.override(custom);

    expect(result).toBe(repository);
    expect(result.greet()).toBe('hello');
  });

  it('replaces an existing method with the custom implementation', async () => {
    const repository = createBaseRepository(UserEntity);
    const customReload = vi.fn().mockResolvedValue('overridden');

    const result = repository.override({ reload: customReload });

    expect(result.reload).toBe(customReload);
    await expect(result.reload({} as any)).resolves.toBe('overridden');
  });

  it('lets a custom method call other repository methods via this', async () => {
    const repository = createBaseRepository(UserEntity);
    const user = await repository.insertEntity(repository.create({ email: 'override@example.com', age: null, teamId: null }));

    const result = repository.override({
      async touchAndReload(entity: UserEntity) {
        return dataSource.transaction(async (manager) => {
          const repoInTransaction = manager.withRepository(this as any);
          await repoInTransaction.updateEntity(entity, { age: 1 });
          return repoInTransaction.reload(entity);
        });
      },
    });

    const reloaded = await result.touchAndReload(user);

    expect(reloaded.age).toBe(1);
  });
});
