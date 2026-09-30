import { TeamEntity } from '../entities/TeamEntity';
import { createBaseRepository } from './createBaseRepository';

export const TeamRepository = createBaseRepository(TeamEntity);
