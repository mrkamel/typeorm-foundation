import { registerDecorator, validate } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { IsNull } from 'typeorm';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseError, ValidationError } from './errors';

export const validationContext = new AsyncLocalStorage<{
  entityManager: EntityManager,
  original: ObjectLiteral | null,
  customErrors: Record<string, string>,
}>();

export function getValidationContextOrFail() {
  const store = validationContext.getStore();

  if (!store) throw new BaseError('Validation context is not available');

  return store;
}

export async function validateOrFail<T extends object>(
  { entity, entityManager, original }:
  { entity: T, entityManager: EntityManager, original: T | null }
): Promise<T> {
  const errors = await validationContext.run({ entityManager, original, customErrors: {} }, async () => await validate(entity));

  if (errors.length > 0) {
    throw new ValidationError(errors.reduce((acc, cur) => {
      if (cur.constraints) acc[cur.property] = Object.values(cur.constraints)
        .map((value) => value.startsWith(`${cur.property} `) ? value.slice(cur.property.length + 1) : value);

      return acc;
    }, {} as Record<string, string[]>));
  }

  return entity;
}

type MessageOption = string | ((validationArguments: ValidationArguments | undefined) => string);

function resolveMessage(validationArguments: ValidationArguments | undefined, message: MessageOption | undefined) {
  if (!message) return;

  return typeof message === 'function' ? message(validationArguments) : message;
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
  options?: { message?: MessageOption },
) {
  return function (target: Entity, propertyName: Key) {
    const name = `validateWith:${target.constructor.name}:${randomUUID()}`;

    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          const context = getValidationContextOrFail();
          const entity = validationArguments?.object as Entity;
          const errorMessage = await validate(value, entity, context.entityManager);

          if (errorMessage) {
            context.customErrors[name] = errorMessage;
            return false;
          }

          return true;
        },
        defaultMessage: (validationArguments) => resolveMessage(validationArguments, options?.message) ?? getValidationContextOrFail().customErrors[name] ?? `${validationArguments?.property} is invalid`,
      },
    });
  };
}

export function ValidateRelation<Entity extends ObjectLiteral, Key extends Extract<keyof Entity, string>, Related = any>(
  relatedEntity: () => Function,
  options?: { with?: (related: Related, entity: Entity) => Promise<string | undefined> | string | undefined, validateIf?: (entity: Entity) => boolean, message?: MessageOption },
) {
  return function (target: Entity, propertyName: Key) {
    const name = `validateRelation:${target.constructor.name}:${randomUUID()}`;

    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
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

          if (options?.with) {
            const errorMessage = await options.with(existing as Related, entity);

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

export function ValidateUniqueness<Entity extends ObjectLiteral, Key extends Extract<keyof Entity, string>>(
  options?: { scope?: Extract<keyof Entity, string>[], validateIf?: (entity: Entity) => boolean, message?: MessageOption },
) {
  return function (target: Entity, propertyName: Key) {
    registerDecorator({
      name: `validateUniqueness:${target.constructor.name}:${randomUUID()}`,
      target: target.constructor,
      propertyName,
      validator: {
        validate: async (value, validationArguments) => {
          const entity = validationArguments?.object as Entity;

          if (options?.validateIf && !options.validateIf(entity)) return true;
          if (value === undefined) return false;

          const context = getValidationContextOrFail();
          const repository = context.entityManager.getRepository(entity.constructor);

          const scopeEntries = (options?.scope ?? []).map(key => [key, (entity as any)[key]] as const);
          if (scopeEntries.some(([, scopeValue]) => scopeValue === undefined)) return false;

          const scope = Object.fromEntries(scopeEntries.map(([key, scopeValue]) => [key, scopeValue === null ? IsNull() : scopeValue]));

          const existing = await repository.find({ where: { [propertyName]: value === null ? IsNull() : value, ...scope }, take: 2 });

          const primaryColumns = context.entityManager.dataSource.getMetadata(entity.constructor).primaryColumns.map(column => column.propertyName);
          const hasPrimaryKeyValue = primaryColumns.length > 0 && primaryColumns.every(key => (entity as any)[key] != null);

          return !existing.some(row => !hasPrimaryKeyValue || !primaryColumns.every(key => (row as any)[key] === (entity as any)[key]));
        },
        defaultMessage: (validationArguments) => resolveMessage(validationArguments, options?.message) ?? `${validationArguments?.property} is already taken`,
      },
    });
  };
}
