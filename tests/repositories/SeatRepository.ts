import { SeatEntity } from '../entities/SeatEntity';
import { dataSource } from '../dataSource';
import { createFoundationRepository } from './createFoundationRepository';

export const SeatRepository = createFoundationRepository(dataSource.getRepository(SeatEntity));
