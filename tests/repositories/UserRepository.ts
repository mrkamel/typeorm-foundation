import { UserEntity } from '../entities/UserEntity';
import { dataSource } from '../dataSource';
import { createBaseRepository } from './createBaseRepository';

export const UserRepository = createBaseRepository(dataSource.getRepository(UserEntity));
