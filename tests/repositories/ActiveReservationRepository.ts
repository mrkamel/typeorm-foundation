import { ActiveReservationEntity } from '../entities/ActiveReservationEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const ActiveReservationRepository = createFoundationRepository(dataSource.getRepository(ActiveReservationEntity));
