import { MembershipEntity } from '../entities/MembershipEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const MembershipRepository = createFoundationRepository(dataSource.getRepository(MembershipEntity));
