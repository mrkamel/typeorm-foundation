import { UserEntity } from '../entities/UserEntity';
import { createBaseRepository } from './createBaseRepository';

export const UserRepository = createBaseRepository(UserEntity);
