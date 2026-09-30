import { TeamEntity } from '../entities/TeamEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const TeamRepository = createFoundationRepository(dataSource.getRepository(TeamEntity));
