import { registerDecorator, validate } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { IsNull, Raw } from 'typeorm';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ArgumentError, MissingValidationContextError, ValidationError } from './errors';
import { getKeyMetadata } from './keys';
import { singleton } from './singleton';

export type ValidationOperation =
  | { type: 'insert' }
  | { type: 'update', properties: string[] }
  | { type: 'upsert', keyName: string | undefined };

type ValidationStore = {
  entityManager: EntityManager,
  operation: ValidationOperation,
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
  { entity, entityManager, operation }:
  { entity: T, entityManager: EntityManager, operation: ValidationOperation }
): Promise<T> {
  const firstPassErrors = await validationContext.run(
    { entityManager, operation, customErrors: {}, firstPassInvalidProperties: null },
    async () => await validate(entity),
  );

  const errors = await validationContext.run(
    { entityManager, operation, customErrors: {}, firstPassInvalidProperties: new Set(firstPassErrors.map((error) => error.property)) },
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

export type ValidationHelpers<Entity extends object> = {
  manager: EntityManager,
  isInsert: () => boolean,
  isUpdate: (property?: Extract<keyof Entity, string>) => boolean,
  isUpsert: (keyName?: string) => boolean,
  isDirty: (property: Extract<keyof Entity, string>) => boolean,
};

function createValidationHelpers<Entity extends object>(): ValidationHelpers<Entity> {
  const { entityManager, operation } = getValidationContextOrFail();

  const isInsert = () => operation.type === 'insert';
  const isUpdate = (property?: Extract<keyof Entity, string>) => operation.type === 'update' && (property === undefined || operation.properties.includes(property));
  const isUpsert = (keyName?: string) => operation.type === 'upsert' && (keyName === undefined || operation.keyName === keyName);
  const isDirty = (property: Extract<keyof Entity, string>) => isInsert() || isUpsert() || isUpdate(property);

  return { manager: entityManager, isInsert, isUpdate, isUpsert, isDirty };
}

export function ValidateWith<Entity extends object, Key extends Extract<keyof Entity, string>>(
  validate: (value: Entity[Key], entity: Entity, helpers: ValidationHelpers<Entity>) => Promise<string | undefined> | string | undefined,
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
          const errorMessage = await validate(value, entity, createValidationHelpers<Entity>());

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
    validate?: (related: Related, entity: Entity, helpers: ValidationHelpers<Entity>) => Promise<string | undefined> | string | undefined,
    validateIf?: (entity: Entity, helpers: ValidationHelpers<Entity>) => boolean,
    dependencies?: Extract<keyof Entity, string>[],
    message?: MessageOption,
    foreignKey?: Extract<keyof Entity, string> | Extract<keyof Entity, string>[],
    primaryKey?: Extract<keyof Related, string> | Extract<keyof Related, string>[],
  },
) {
  return function (target: Entity, propertyName: Key) {
    const name = `references:${target.constructor.name}:${randomUUID()}`;
    const foreignKeys = options?.foreignKey === undefined ? [propertyName] : [options.foreignKey].flat();
    const explicitPrimaryKeys = options?.primaryKey === undefined ? null : [options.primaryKey].flat() as string[];
    const fullDependencies = [...new Set([propertyName, ...foreignKeys, ...options?.dependencies ?? []])];

    if (!foreignKeys.includes(propertyName)) {
      throw new ArgumentError(`${target.constructor.name}.${propertyName}: foreignKey must include the decorated property`);
    }

    if (explicitPrimaryKeys && explicitPrimaryKeys.length !== foreignKeys.length) {
      throw new ArgumentError(`${target.constructor.name}.${propertyName}: foreignKey and primaryKey must have the same number of columns`);
    }

    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          const context = getValidationContextOrFail();

          const primaryKeys = explicitPrimaryKeys ?? context.entityManager.dataSource.getMetadata(relatedEntity()).primaryColumns.map(column => column.propertyName);

          if (primaryKeys.length === 0) {
            throw new ArgumentError(`${target.constructor.name}.${propertyName}: ${relatedEntity().name} has no primary key, pass primaryKey explicitly`);
          }

          if (primaryKeys.length !== foreignKeys.length) {
            throw new ArgumentError(`${target.constructor.name}.${propertyName}: references ${primaryKeys.length} primary key column(s) of ${relatedEntity().name} with ${foreignKeys.length} foreign key column(s)`);
          }

          if (hasFailedDependencies(fullDependencies)) return true;

          const entity = validationArguments?.object as Entity;
          const helpers = createValidationHelpers<Entity>();

          if (options?.validateIf && !options.validateIf(entity, helpers)) return true;

          const foreignKeyValues = foreignKeys.map(key => entity[key]);
          if (foreignKeyValues.some(foreignKeyValue => foreignKeyValue == null)) return false;

          const existing = await context.entityManager.getRepository(relatedEntity()).findOne({
            ...(options?.validate ? {} : { select: Object.fromEntries(primaryKeys.map(key => [key, true])) }),
            where: Object.fromEntries(primaryKeys.map((key, index) => [key, foreignKeyValues[index]])),
          });

          if (!existing) return false;

          if (options?.validate) {
            const errorMessage = await options.validate(existing as Related, entity, helpers);

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
    caseInsensitive?: 'upper' | 'lower',
    validateIf?: (entity: Entity, helpers: ValidationHelpers<Entity>) => boolean,
    dependencies?: Extract<keyof Entity, string>[],
    message?: MessageOption,
  } & ({ scope?: Extract<keyof Entity, string>[], keyName?: never } | { keyName: string, scope?: never }),
) {
  return function (target: Entity, propertyName: Key) {
    registerDecorator({
      name: `isUnique:${target.constructor.name}:${randomUUID()}`,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          const context = getValidationContextOrFail();
          const entity = validationArguments?.object as Entity;
          const metadata = context.entityManager.dataSource.getMetadata(entity.constructor);
          const keyMetadata = options?.keyName === undefined ? null : getKeyMetadata(metadata, options.keyName);
          const keyPropertyNames = keyMetadata?.columns.map(column => column.propertyName);

          if (keyPropertyNames && !keyPropertyNames.includes(propertyName)) {
            throw new ArgumentError(`${target.constructor.name}.${propertyName}: key ${options?.keyName} does not include the decorated property`);
          }

          const scopeKeys = keyPropertyNames?.filter(key => key !== propertyName) ?? options?.scope ?? [];

          if (hasFailedDependencies([propertyName, ...scopeKeys, ...options?.dependencies ?? []])) return true;
          if (value === undefined) return false;

          const helpers = createValidationHelpers<Entity>();

          if (options?.keyName !== undefined && helpers.isUpsert(options.keyName)) return true;
          if (options?.validateIf && !options.validateIf(entity, helpers)) return true;

          const scopeEntries = scopeKeys.map(key => [key, (entity as any)[key]] as const);
          if (scopeEntries.some(([, scopeValue]) => scopeValue === undefined)) return false;

          const scope = Object.fromEntries(scopeEntries.map(([key, scopeValue]) => [key, scopeValue === null ? IsNull() : scopeValue]));
          const primaryColumns = metadata.primaryColumns.map(column => column.propertyName);

          const query = context.entityManager.getRepository(entity.constructor).createQueryBuilder('entity')
            .select(primaryColumns.map(key => `entity.${key}`))
            .where({ [propertyName]: matchValue(value, options?.caseInsensitive), ...scope })
            .limit(2);

          if (keyMetadata?.where) query.andWhere(`(${keyMetadata.where})`);

          const existing = await query.getMany();

          const hasPrimaryKeyValue = primaryColumns.length > 0 && primaryColumns.every(key => (entity as any)[key] != null);

          return !existing.some(row => !hasPrimaryKeyValue || !primaryColumns.every(key => (row as any)[key] === (entity as any)[key]));
        },
        defaultMessage: (validationArguments) => resolveMessage(validationArguments, options?.message) ?? `${validationArguments?.property} is already taken`,
      },
    });
  };
}
