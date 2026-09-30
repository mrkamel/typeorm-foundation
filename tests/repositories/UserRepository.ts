import { UserEntity } from '../entities/UserEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const UserRepository = createFoundationRepository(dataSource.getRepository(UserEntity));
