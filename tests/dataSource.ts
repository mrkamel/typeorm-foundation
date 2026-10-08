import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { UserEntity } from './entities/UserEntity';
import { TeamEntity } from './entities/TeamEntity';
import { MembershipEntity } from './entities/MembershipEntity';
import { AssignmentEntity } from './entities/AssignmentEntity';

const entities = [UserEntity, TeamEntity, MembershipEntity, AssignmentEntity];

export const database = process.env.DATABASE ?? 'postgres';

function buildOptions(): DataSourceOptions {
  if (database === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: ':memory:',
      entities,
      synchronize: true,
      dropSchema: true,
    };
  }

  if (database === 'mysql') {
    return {
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      username: process.env.MYSQL_USER ?? 'test',
      password: process.env.MYSQL_PASSWORD ?? 'test',
      database: process.env.MYSQL_DATABASE ?? 'test',
      entities,
      synchronize: true,
      dropSchema: true,
    };
  }

  return {
    type: 'postgres',
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5544),
    username: process.env.PGUSER ?? 'test',
    password: process.env.PGPASSWORD ?? 'test',
    database: process.env.PGDATABASE ?? 'test',
    entities,
    synchronize: true,
    dropSchema: true,
  };
}

export const dataSource = new DataSource(buildOptions());
