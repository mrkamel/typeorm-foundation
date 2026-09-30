import { TeamEntity } from '../entities/TeamEntity';
import { dataSource } from '../dataSource';
import { createBaseRepository } from './createBaseRepository';

export const TeamRepository = createBaseRepository(dataSource.getRepository(TeamEntity));
