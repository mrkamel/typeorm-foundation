# typeorm-foundation

This is an opinionated library to provide the missing pieces
in daily life with typeorm.

It provides a base repository and entity validation building blocks for TypeORM: a
`class-validator`-backed validation pipeline wired into insert/update/upsert,
plus a repository extension with safe upserts and a way to add your own
methods to every repository the factory creates.

## Install

```sh
pnpm add typeorm-foundation
```

Peer dependencies (bring your own versions): `typeorm`, `class-validator`.

## Quick start

```ts
import { DataSource } from 'typeorm';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { IsEmail } from 'class-validator';
import { createRepositoryFactory, isDirty, ValidateUniqueness } from 'typeorm-foundation';

@Entity('users')
class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  @IsEmail()
  @ValidateUniqueness({ validateIf: (user) => isDirty(user, 'email') })
  email!: string;
}

const dataSource = new DataSource({ /* ... */ });
const createBaseRepository = createRepositoryFactory(dataSource);
const UserRepository = createBaseRepository(UserEntity);

const user = await UserRepository.insertEntity(UserRepository.create({ email: 'ada@example.com' }));
await UserRepository.updateEntity(user, { email: 'ada@newdomain.com' });
```

A repository built this way validates on every
`insertEntity`/`updateEntity`/`upsertEntity` call and throws a
`ValidationError` (one message per invalid field) if any decorator fails.

## createRepositoryFactory

Takes a `DataSource` and returns `createBaseRepository(entityTarget)`, so one
factory call wires every repository in your app to the same `DataSource`. The
optional second argument is a function, called with the entity target each
time `createBaseRepository` builds a repository, returning a plain object of
extra methods added onto that repository. Inside those methods, `this` is
typed as the full repository — the underlying TypeORM `Repository<Entity>`,
every built-in method below, and every other extension method — so they can
call `this.createQueryBuilder(...)`, `this.insertEntity(...)`, `this.manager`,
or each other:

```ts
export const createBaseRepository = createRepositoryFactory(AppDataSource, (targetEntity) => ({
  async findManyByIds(ids: string[]) {
    return this.createQueryBuilder(this.metadata.tableName)
      .whereInIds(ids)
      .getMany();
  },
}));
```

Pass nothing and every repository is just the built-ins below, with no extras.

Each repository built from it is a TypeORM `Repository<Entity>` extended with:

- **`insertEntity(entity)`** — validates, then inserts.
- **`updateEntity(entity, updates)`** — validates, applies `updates`, runs
  `beforeUpdate`/`afterUpdate` listeners, and issues a single `UPDATE` only for
  columns that actually changed. No-ops (skipping validation and listeners) when
  `updates` is empty. Automatically bumps any `isUpdateDate` column not
  explicitly included in `updates`.
- **`upsertEntity(entity, { updates, key? })`** — validates, then runs `INSERT
  ... ON CONFLICT (key) DO UPDATE ... RETURNING *`, hydrating the returned row
  (including any column transformers) back onto `entity`. `updates` is either a
  list of property names to write or an object of values to merge onto the entity
  first. Needs a `RETURNING`-capable driver (only tested against Postgres here).
- **`upsertOrFailBy(findCondition, updates)`** — `updateEntity` if a row
  matching `findCondition` exists, otherwise `insertEntity`.
- **`removeEntity(entity)`** — removes a clone of `entity` so the original
  object (and its primary key) is left untouched.
- **`reload(entity)`** — re-fetches `entity` by primary key, throwing
  `NotFoundError` if it's gone.
- **`override(methods)`** — assigns `methods` onto one repository instance
  (mutating and returning `this`), typed the same way as the factory's
  `extensions`. Use this for one-off additions to a single repository; use the
  factory's `extensions` for methods every repository should have.
- **`validateEntityOrFail(entity, fields)`** — no-op by default; override per
  repository (via `override(...)`) to add validation beyond what decorators
  express. Called with `fields: null` on insert/upsert and the list of changed
  keys on update.

`BaseRepository<Entity>` is the type of what `createBaseRepository(target)`
returns — useful for typing a function that accepts one of these repositories,
or a class of your own that wraps one.

## Errors

Everything this library throws extends **`BaseError`** (itself a plain
`Error` subclass), so `catch (error) { if (error instanceof BaseError) ... }`
catches anything this library raises, as opposed to an error from your own
code or a dependency.

- **`NotFoundError`** — thrown by `reload` when the entity no longer exists.
- **`ValidationError`** — thrown by `validateOrFail` (and so by
  `insertEntity`/`updateEntity`/`upsertEntity`); `error.errors` is a
  `Record<field, string[]>` of every failing message, grouped by property. Its
  constructor also accepts a plain string (`new ValidationError('something went
  wrong')`), filed under the `base` key, for a validation failure that isn't tied
  to one field — e.g. from your own `validateEntityOrFail` override.

## Validation

Additional decorators build on `class-validator`. `class-validator` doesn't
allow passing a context, so `validateOrFail` sets up an `AsyncLocalStorage`
context that gives decorators access to the transactional entity manager,
which `insertEntity`/`updateEntity`/`upsertEntity` set up automatically.

- **`ValidateWith(validate, { message? })`** — property decorator;
  `validate(value, entity, entityManager)` returns an error string (or a
  `Promise` of one) to fail, `undefined` to pass.
- **`ValidateRelation(() => RelatedEntity, { with?, validateIf?, message? })`**
  — fails unless `value` is a valid primary key of `RelatedEntity`; the
  optional `with(relatedEntity, entity)` callback can reject further (e.g. a
  status check) after the row is found.
- **`ValidateUniqueness({ scope?, validateIf?, message? })`** — fails if
  another row (excluding the entity's own primary key) already has this value,
  optionally scoped to a set of sibling columns.
- **`isNew(entity)` / `isChanged(entity, property)` /
  `isDirty(entity, property)`** — call from inside a validator (or an entity's own
  `@ValidateIf`) to check the entity against the pre-update snapshot: `isNew` is
  true when there is no snapshot (an insert), `isChanged` compares the property
  to the snapshot, `isDirty` is `isNew(entity) || isChanged(entity, property)`.
- **`validateOrFail({ entity, entityManager, original })`** — runs every
  decorator on `entity` and throws `ValidationError` (see [Errors](#errors)) if
  any fail; `original` is the pre-update snapshot (or `null` for an insert) that
  `isNew`/`isChanged`/`isDirty` read from.

Please note: typeorm has no real dirty tracking. Therefore, when using
`insertEntity` everything is assumed to be changed/dirty and `isNew` returns
true. When using `updateEntity`, the properties passed are assumed to be
changed/dirty.

## Testing

Tests run against a real database rather than a mocked `DataSource`. Postgres
is the default; start it (and MySQL, for the `DATABASE=mysql` run) with
`docker compose up -d`, then `pnpm test`. Switch database with the `DATABASE`
env var:

```sh
pnpm test                 # postgres (localhost:5544, docker compose)
DATABASE=mysql pnpm test  # mysql (localhost:3306, docker compose)
DATABASE=sqlite pnpm test # better-sqlite3, in-memory, no service needed
```

`upsertEntity` relies on `RETURNING`, which MySQL and SQLite don't support
(only MariaDB does, not plain MySQL) — its tests are skipped outside of
`DATABASE=postgres`. CI runs the suite against all three.
