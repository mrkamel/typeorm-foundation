import { registerDecorator, validate } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { IsNull, Raw } from 'typeorm';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MissingValidationContextError, ValidationError } from './errors';
import { singleton } from './singleton';

type ValidationStore = {
  entityManager: EntityManager,
  original: ObjectLiteral | null,
  customErrors: Record<string, string>,
  firstPassInvalidProperties: Set<string> | null,
};

type ValidationContext = AsyncLocalStorage<ValidationStore>;

export const validationContext = singleton<ValidationContext>('validationContext', () => new AsyncLocalStorage());

export function getValidationContextOrFail() {
  const store = validationContext.getStore();

  if (!store) throw new MissingValidationContextError('Validation context is not available');

  return store;
}

export async function validateOrFail<T extends object>(
  { entity, entityManager, original }:
  { entity: T, entityManager: EntityManager, original: T | null }
): Promise<T> {
  const firstPassErrors = await validationContext.run(
    { entityManager, original, customErrors: {}, firstPassInvalidProperties: null },
    async () => await validate(entity),
  );

  const errors = await validationContext.run(
    { entityManager, original, customErrors: {}, firstPassInvalidProperties: new Set(firstPassErrors.map((error) => error.property)) },
    async () => await validate(entity),
  );

  if (errors.length > 0) {
    throw new ValidationError(errors.reduce((acc, cur) => {
      if (cur.constraints) acc[cur.property] = Object.values(cur.constraints)
        .map((value) => value.startsWith(`${cur.property} `) ? value.slice(cur.property.length + 1) : value);

      return acc;
    }, {} as Record<string, string[]>));
  }

  return entity;
}

function hasFailedDependencies(dependencies: string[]) {
  const { firstPassInvalidProperties } = getValidationContextOrFail();

  if (!firstPassInvalidProperties) return true;

  return dependencies.some((property) => firstPassInvalidProperties.has(property));
}

type MessageOption = string | ((validationArguments: ValidationArguments | undefined) => string);

function resolveMessage(validationArguments: ValidationArguments | undefined, message: MessageOption | undefined) {
  if (!message) return;

  return typeof message === 'function' ? message(validationArguments) : message;
}

function matchValue(value: unknown, caseInsensitive: 'upper' | 'lower' | undefined) {
  if (value === null) return IsNull();
  if (!caseInsensitive || typeof value !== 'string') return value;

  const fn = caseInsensitive === 'upper' ? 'UPPER' : 'LOWER';

  return Raw((columnAlias) => `${fn}(${columnAlias}) = ${fn}(:uniquenessValue)`, { uniquenessValue: value });
}

export function isChanged<Entity extends ObjectLiteral, Key extends Extract<keyof Entity, string>>(entity: Entity, property: Key) {
  const context = getValidationContextOrFail();

  if (!context.original) return entity[property] !== undefined;

  return context.original?.[property] !== entity[property];
}

export function isDirty<Entity extends ObjectLiteral, Key extends Extract<keyof Entity, string>>(entity: Entity, property: Key) {
  return isNew(entity) || isChanged(entity, property);
}

export function isNew<Entity extends ObjectLiteral>(_entity: Entity) {
  const context = getValidationContextOrFail();

  return !context.original;
}

export function ValidateWith<Entity extends object, Key extends Extract<keyof Entity, string>>(
  validate: (value: Entity[Key], entity: Entity, manager: EntityManager) => Promise<string | undefined> | string | undefined,
  options?: { dependencies?: Extract<keyof Entity, string>[] },
) {
  return function (target: Entity, propertyName: Key) {
    const name = `validateWith:${target.constructor.name}:${randomUUID()}`;
    const fullDependencies = [propertyName, ...options?.dependencies ?? []];

    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          if (hasFailedDependencies(fullDependencies)) return true;

          const context = getValidationContextOrFail();
          const entity = validationArguments?.object as Entity;
          const errorMessage = await validate(value, entity, context.entityManager);

          if (errorMessage) {
            context.customErrors[name] = errorMessage;
            return false;
          }

          return true;
        },
        defaultMessage: (validationArguments) => getValidationContextOrFail().customErrors[name] ?? `${validationArguments?.property} is invalid`,
      },
    });
  };
}

export function References<Entity extends ObjectLiteral, Key extends Extract<keyof Entity, string>, Related = any>(
  relatedEntity: () => Function,
  options?: {
    validate?: (related: Related, entity: Entity) => Promise<string | undefined> | string | undefined,
    validateIf?: (entity: Entity) => boolean,
    dependencies?: Extract<keyof Entity, string>[],
    message?: MessageOption,
  },
) {
  return function (target: Entity, propertyName: Key) {
    const name = `references:${target.constructor.name}:${randomUUID()}`;
    const fullDependencies = [propertyName, ...options?.dependencies ?? []];

    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          if (hasFailedDependencies(fullDependencies)) return true;

          const entity = validationArguments?.object as Entity;

          if (options?.validateIf && !options.validateIf(entity)) return true;
          if (value == null) return false;

          const context = getValidationContextOrFail();

          const [primaryColumn] = context.entityManager.dataSource.getMetadata(relatedEntity()).primaryColumns;
          if (!primaryColumn) return false;

          const existing = await context.entityManager.getRepository(relatedEntity()).findOne({
            where: { [primaryColumn.propertyName]: value },
          });

          if (!existing) return false;

          if (options?.validate) {
            const errorMessage = await options.validate(existing as Related, entity);

            if (errorMessage) {
              context.customErrors[name] = errorMessage;
              return false;
            }
          }

          return true;
        },
        defaultMessage: (validationArguments) => resolveMessage(validationArguments, options?.message) ?? getValidationContextOrFail().customErrors[name] ?? `${validationArguments?.property} reference is invalid`,
      },
    });
  };
}

export function IsUnique<Entity extends ObjectLiteral, Key extends Extract<keyof Entity, string>>(
  options?: {
    scope?: Extract<keyof Entity, string>[],
    caseInsensitive?: 'upper' | 'lower',
    validateIf?: (entity: Entity) => boolean,
    dependencies?: Extract<keyof Entity, string>[],
    message?: MessageOption,
  },
) {
  return function (target: Entity, propertyName: Key) {
    const fullDependencies = [propertyName, ...options?.scope ?? [], ...options?.dependencies ?? []];

    registerDecorator({
      name: `isUnique:${target.constructor.name}:${randomUUID()}`,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          if (hasFailedDependencies(fullDependencies)) return true;
          if (value === undefined) return false;

          const entity = validationArguments?.object as Entity;

          if (options?.validateIf && !options.validateIf(entity)) return true;

          const context = getValidationContextOrFail();
          const repository = context.entityManager.getRepository(entity.constructor);

          const scopeEntries = (options?.scope ?? []).map(key => [key, (entity as any)[key]] as const);
          if (scopeEntries.some(([, scopeValue]) => scopeValue === undefined)) return false;

          const scope = Object.fromEntries(scopeEntries.map(([key, scopeValue]) => [key, scopeValue === null ? IsNull() : scopeValue]));

          const existing = await repository.find({ where: { [propertyName]: matchValue(value, options?.caseInsensitive), ...scope }, take: 2 });

          const primaryColumns = context.entityManager.dataSource.getMetadata(entity.constructor).primaryColumns.map(column => column.propertyName);
          const hasPrimaryKeyValue = primaryColumns.length > 0 && primaryColumns.every(key => (entity as any)[key] != null);

          return !existing.some(row => !hasPrimaryKeyValue || !primaryColumns.every(key => (row as any)[key] === (entity as any)[key]));
        },
        defaultMessage: (validationArguments) => resolveMessage(validationArguments, options?.message) ?? `${validationArguments?.property} is already taken`,
      },
    });
  };
}
