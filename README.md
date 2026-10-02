# typeorm-foundation

This is an opinionated library to provide the missing pieces
in daily life with typeorm.

It provides a foundation repository and entity validation building blocks for TypeORM: a
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
import { createRepositoryFactory, isDirty, IsUnique } from 'typeorm-foundation';

@Entity('users')
class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  @IsEmail()
  @IsUnique({ validateIf: (user) => isDirty(user, 'email') })
  email!: string;

  constructor(values: Partial<UserEntity> = {}) {
    Object.assign(this, values);
  }
}

const dataSource = new DataSource({ /* ... */ });
const createFoundationRepository = createRepositoryFactory();
const UserRepository = createFoundationRepository(dataSource.getRepository(UserEntity));

const user = await UserRepository.insertEntity(new UserEntity({ email: 'ada@example.com' }));
await UserRepository.updateEntity(user, { email: 'ada@newdomain.com' });
```

A repository built this way validates on every
`insertEntity`/`updateEntity`/`upsertEntity` call and throws a
`ValidationError` (one message per invalid field) if any decorator fails.

## createRepositoryFactory

Returns `createFoundationRepository(repository)`, which takes a plain TypeORM
`Repository` and extends it with everything below. No `DataSource` is needed —
the entity target, metadata and data source all come from the repository you
hand in.

The optional argument is a plain object of extra methods, added onto every
repository the factory creates. Inside those methods, `this` is typed as the
full repository — the underlying TypeORM `Repository`, every built-in method
below, and every other extension method — so they can call
`this.createQueryBuilder(...)`, `this.insertEntity(...)`, `this.manager`, or
each other:

```ts
export const createFoundationRepository = createRepositoryFactory({
  async findManyByIds(ids: string[]) {
    return this.createQueryBuilder(this.metadata.tableName)
      .whereInIds(ids)
      .getMany();
  },
});

export const UserRepository = createFoundationRepository(AppDataSource.getRepository(UserEntity));
```

Pass nothing and every repository is just the built-ins below, with no extras.

Since one `extensions` object is shared across every repository, `this` inside
those methods is typed against a generic entity rather than the specific one a
given repository is for. Anything that needs the concrete entity type belongs
on the individual repository instead — either via TypeORM's own `.extend(...)`
on the result, or via `override(...)`, where `this` is entity-specific:

```ts
export const UserRepository = createFoundationRepository(AppDataSource.getRepository(UserEntity)).extend({
  async findByEmail(email: string) {
    return this.findOne({ where: { email } });   // `this` is entity-specific here
  },
});
```

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
  (mutating and returning `this`). Unlike the factory's `extensions`, `this`
  here is typed against the concrete entity, because it runs on an
  already-built repository. Use it for anything needing real entity types, and
  the factory's `extensions` for methods every repository should have.
- **`validateEntityOrFail(entity, fields)`** — no-op by default; override per
  repository (via `override(...)`) to add validation beyond what decorators
  express. Called with `fields: null` on insert/upsert and the list of changed
  keys on update.

`FoundationRepository<Entity>` is the type of what `createFoundationRepository(repository)`
returns — useful for typing a function that accepts one of these repositories,
or a class of your own that wraps one.

## Errors

Everything this library throws extends **`FoundationError`**, an abstract
`Error` subclass, so `catch (error) { if (error instanceof FoundationError) ... }`
catches anything this library raises, as opposed to an error from your own code
or a dependency. Being abstract, `FoundationError` can't be constructed
directly — throw one of the concrete errors below (`ValidationError` is the one
you'd normally raise from your own `validateEntityOrFail` override).

- **`ArgumentError`** — thrown when a call into the repository is malformed
  rather than the data being invalid: `upsertEntity` with an empty `updates`
  list or with an `updates`/`key` entry that maps to no column, and
  `updateEntity`/`reload` on an entity whose class declares no primary key or
  whose primary key isn't set.
- **`MissingValidationContextError`** — thrown when something that needs the
  validation context runs outside it, i.e. `isNew`/`isChanged`/`isDirty` or one
  of the `ValidateWith`/`References`/`IsUnique` decorators called outside a
  `validateOrFail` run.
- **`NotFoundError`** — thrown by `reload` when the entity no longer exists.
- **`ValidationError`** — thrown by `validateOrFail` (and so by
  `insertEntity`/`updateEntity`/`upsertEntity`); `error.errors` is a
  `Record<field, string[]>` of every failing message, grouped by property. Its
  constructor also accepts a plain string (`new ValidationError('something went
  wrong')`), filed under the `base` key, for a validation failure that isn't tied
  to one field — e.g. from your own `validateEntityOrFail` override.

Use plain `instanceof` to narrow a caught `unknown` to one of these errors. It
is safe even under dual module loading: each error class is registered on
`globalThis` under a version-scoped `Symbol.for(...)` key, so the ESM and CJS
builds of this package — or two copies of it in one dependency tree — resolve
to the very same class object, and an error thrown through one import matches
`instanceof` through the other. (Genuinely different versions of the package
get different keys, and so stay separate classes, as they should.)

For example, `reload` throws `NotFoundError` when the row has been deleted
since the entity was loaded, which is usually a case you want to handle rather
than propagate:

```ts
import { NotFoundError } from 'typeorm-foundation';

async function refreshUser(user: UserEntity) {
  try {
    return await UserRepository.reload(user);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;

    // Someone deleted the row in the meantime.
    return null;
  }
}
```

Re-throwing anything the check rejects keeps unrelated failures (a dropped
connection, an `ArgumentError` from an unset primary key) from being swallowed
as a missing row.

`insertEntity`, `updateEntity` and `upsertEntity` validate before writing and
throw `ValidationError` if any decorator on the entity fails, so nothing reaches
the database. Catch it to turn a failed write into a per-field response:

```ts
import { ValidationError } from 'typeorm-foundation';

try {
  await UserRepository.insertEntity(new UserEntity({ email: 'not-an-email' }));
} catch (error) {
  if (!(error instanceof ValidationError)) throw error;

  error.errors;  // { email: ['must be an email'] }
  error.message; // 'email: must be an email'
}
```

`errors` holds every failing message, grouped by property, with the leading
property name stripped from each message so you can render it next to your own
field label. `message` is those same entries flattened into one string.

`error.name` and `ValidationError`'s `errors` are `readonly`.

## Validation

Additional decorators build on `class-validator`. `class-validator` doesn't
allow passing a context, so `validateOrFail` sets up an `AsyncLocalStorage`
context that gives decorators access to the transactional entity manager,
which `insertEntity`/`updateEntity`/`upsertEntity` set up automatically.

- **`ValidateWith(validate)`** — property decorator;
  `validate(value, entity, entityManager)` returns an error string (or a
  `Promise` of one) to fail, `undefined` to pass. The returned string is the
  message, so there is no separate `message` option — to reuse a shared
  predicate with a per-property message, wrap it: `ValidateWith((value) =>
  isReserved(value) ? 'is not allowed' : undefined)`.
- **`References(() => RelatedEntity, { validate?, validateIf?, message? })`** —
  fails unless `value` is a valid primary key of `RelatedEntity`; the optional
  `validate(relatedEntity, entity)` callback can reject further (e.g. a status
  check) after the row is found, returning an error string the same way
  `ValidateWith` does.
- **`IsUnique({ scope?, caseInsensitive?, validateIf?, message? })`** — fails if
  another row (excluding the entity's own primary key) already has this value,
  optionally scoped to a set of sibling columns. `caseInsensitive` makes the
  comparison ignore case by normalising both sides with SQL `UPPER()`
  (`'upper'`) or `LOWER()` (`'lower'`) — pick whichever matches a functional
  index you have, so the lookup can still use it. Left undefined (the default),
  the value is compared as-is. It applies to the decorated property only, not to
  `scope` columns, and only when the value is a string.
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
