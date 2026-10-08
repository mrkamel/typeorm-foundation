import { AssignmentEntity } from '../entities/AssignmentEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const AssignmentRepository = createFoundationRepository(dataSource.getRepository(AssignmentEntity));
