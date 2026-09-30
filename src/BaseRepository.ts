import { validateOrFail } from './validations';
import { BaseError, NotFoundError } from './errors';
import type { DataSource, DeepPartial, EntityTarget, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';

export type AtLeastOne<T, Keys extends keyof T = keyof T> = {
  [K in Keys]: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[Keys];

export type BaseRepository<Entity extends ObjectLiteral> = Repository<Entity> & {
  override<Self, C extends object>(this: Self, custom: C & ThisType<Omit<Self, keyof C> & C>): Omit<Self, keyof C> & C;
  removeEntity(entity: Entity): Promise<Entity>;
  upsertOrFailBy(findCondition: FindOptionsWhere<Entity>, updates: Partial<Entity>): Promise<Entity>;
  insertEntity(entity: Entity): Promise<Entity>;
  updateEntity(entity: Entity, updates: Partial<Entity>): Promise<Entity>;
  upsertEntity(entity: Entity, options: { updates: [keyof Entity, ...(keyof Entity)[]] | AtLeastOne<Entity>, key?: (keyof Entity)[] }): Promise<Entity>;
  validateEntityOrFail(entity: Entity, fields: (keyof Entity)[] | null): Promise<void>;
  reload(entity: Entity): Promise<Entity>;
};

export function createRepositoryFactory<Ext extends object = Record<never, never>>(dataSource: DataSource, extensions?: Ext & ThisType<BaseRepository<ObjectLiteral> & Ext>) {
  return function createBaseRepository<Entity extends ObjectLiteral>(target: EntityTarget<Entity>): BaseRepository<Entity> & Ext {
    return dataSource.getRepository(target).extend({
      override<Self, C extends object>(this: Self, custom: C & ThisType<Omit<Self, keyof C> & C>): Omit<Self, keyof C> & C {
        return Object.assign(this as object, custom) as unknown as Omit<Self, keyof C> & C;
      },
      async removeEntity(entity: Entity) {
        await this.remove(this.create(entity));
        return entity;
      },
      async upsertOrFailBy(findCondition: FindOptionsWhere<Entity>, updates: Partial<Entity>) {
        const existingEntity = await this.findOne({ where: findCondition });
        if (existingEntity) return await this.updateEntity(existingEntity, updates);

        const entity = this.create({ ...findCondition, ...updates } as DeepPartial<Entity>);

        return await this.insertEntity(entity as Entity);
      },
      async insertEntity(entity: Entity) {
        await validateOrFail({ entity, entityManager: this.manager, original: null });
        await this.validateEntityOrFail(entity, null);
        await this.insert(entity);
        return entity;
      },
      async updateEntity(entity: Entity, updates: Partial<Entity>) {
        if (Object.keys(updates).length === 0) return entity;

        const columnPropertyNames = this.metadata.columns.map(column => column.propertyName);
        const before = Object.fromEntries(columnPropertyNames.map(propertyName => [propertyName, (entity as any)[propertyName]]));

        const calculateChanges = () => Object.fromEntries(
          columnPropertyNames.filter(propertyName => entity[propertyName] !== before[propertyName]).map(propertyName => [propertyName, entity[propertyName]])
        ) as Partial<Entity>;

        Object.assign(entity, updates);

        await validateOrFail({ entity, entityManager: this.manager, original: before });
        await this.validateEntityOrFail(entity, Object.keys(updates));

        await Promise.all(this.metadata.beforeUpdateListeners.filter(listener => listener.isAllowed(entity)).map(listener => listener.execute(entity)));

        if (Object.keys(calculateChanges()).length) {
          const autoUpdates = Object.fromEntries(this._getUpdateDatePropertyNames().filter(propertyName => !(propertyName in updates)).map(propertyName => [propertyName, new Date()]));

          Object.assign(entity, autoUpdates);

          const changes = calculateChanges();

          if (Object.keys(changes).length > 0) {
            await this.update(this._getPrimaryKeyCondition(entity), changes);
          }
        }

        await Promise.all(this.metadata.afterUpdateListeners.filter(listener => listener.isAllowed(entity)).map(listener => listener.execute(entity)));

        return entity;
      },
      async upsertEntity(entity: Entity, { updates, key }: { updates: [keyof Entity, ...(keyof Entity)[]] | AtLeastOne<Entity>, key?: (keyof Entity)[] }) {
        const isUpdateValues = !Array.isArray(updates);

        const updateProperties = isUpdateValues ? Object.keys(updates) as (keyof Entity)[] : updates;
        if (!updateProperties.length) throw new BaseError('At least one update field must be specified for upsertEntity');

        if (isUpdateValues) Object.assign(entity, updates);

        const autoUpdatePropertyNames = this._getUpdateDatePropertyNames().filter(propertyName => !updateProperties.includes(propertyName as keyof Entity));

        Object.assign(entity, Object.fromEntries(autoUpdatePropertyNames.map(propertyName => [propertyName, new Date()])));

        await validateOrFail({ entity, entityManager: this.manager, original: null });
        await this.validateEntityOrFail(entity, null);

        const result = await this.createQueryBuilder()
          .insert()
          .into(target)
          .values(entity)
          .orUpdate(
            this._propertyToColumnNames([...updateProperties, ...autoUpdatePropertyNames]),
            key && this._propertyToColumnNames(key)
          )
          .returning('*')
          .execute();

        return Object.assign(entity, this._hydrateRaw(result.raw[0]));
      },
      async validateEntityOrFail(_entity: Entity, _fields: (keyof Entity)[] | null) {
      },
      async reload(entity: Entity): Promise<Entity> {
        const condition = this._getPrimaryKeyCondition(entity);
        const reloaded = await this.findOne({ where: condition });

        if (!reloaded) throw new NotFoundError(`Entity not found during reload: ${JSON.stringify(condition)}`);

        return reloaded;
      },
      _hydrateRaw(raw: Record<string, any>): Record<string, any> {
        const driver = this.manager.dataSource.driver;

        return Object.fromEntries(
          this.metadata.nonVirtualColumns.map(column => [column.propertyName, driver.prepareHydratedValue(raw[column.databaseName], column)])
        );
      },
      _propertyToColumnNames(propertyNames: (keyof Entity)[]) {
        const metadata = this.manager.dataSource.getMetadata(target);

        return propertyNames.map((propertyName) => {
          const column = metadata.findColumnWithPropertyName(propertyName as string);
          if (!column) throw new BaseError(`Unknown column for property ${String(propertyName)}`);

          return column.databaseName;
        });
      },
      _getUpdateDatePropertyNames() {
        const metadata = this.manager.dataSource.getMetadata(target);

        return metadata.columns.filter(column => column.isUpdateDate).map(column => column.propertyName);
      },
      _getPrimaryKeyCondition(entity: Entity) {
        const metadata = this.manager.dataSource.getMetadata(target);
        const entityName = metadata.name;

        const primaryKeyPropertyNames = metadata.columns.filter(column => column.isPrimary).map(column => column.propertyName);
        if (primaryKeyPropertyNames.length === 0) throw new BaseError(`No primary key defined on entity ${entityName}`);

        const primaryKeyObject = Object.fromEntries(primaryKeyPropertyNames.map(key => [key, (entity as any)[key]]));

        if (Object.values(primaryKeyObject).some(value => value === null || value === undefined)) {
          throw new BaseError(`Invalid primary key for ${entityName} entity: ${JSON.stringify(primaryKeyObject)}`);
        }

        return primaryKeyObject as FindOptionsWhere<Entity>;
      },
      ...(extensions ?? {}) as Ext,
    }) as unknown as BaseRepository<Entity> & Ext;
  };
}
