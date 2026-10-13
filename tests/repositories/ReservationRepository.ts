import { ReservationEntity } from '../entities/ReservationEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const ReservationRepository = createFoundationRepository(dataSource.getRepository(ReservationEntity));
