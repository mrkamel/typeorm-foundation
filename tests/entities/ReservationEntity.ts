import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { IsBoolean, IsInt, IsString } from 'class-validator';
import { IsUnique } from '../../src/validations';

@Entity('reservations')
@Index('unique_index_reservations_on_resource', ['resource'], { unique: true, where: '"active" = true' })
@Index('index_reservations_on_quantity', ['quantity'])
@Unique('unique_constraint_reservations_on_resource_and_quantity', ['resource', 'quantity'])
@Unique('unique_constraint_reservations_on_id_and_resource', ['id', 'resource'], { deferrable: 'INITIALLY DEFERRED' })
export class ReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  @IsString()
  @IsUnique<ReservationEntity, 'resource'>({ keyName: 'unique_index_reservations_on_resource', validateIf: (reservation) => reservation.active })
  resource!: string;

  @Column({ type: 'boolean' })
  @IsBoolean()
  active!: boolean;

  @Column({ type: 'integer' })
  @IsInt()
  @IsUnique<ReservationEntity, 'quantity'>({ keyName: 'unique_constraint_reservations_on_resource_and_quantity' })
  quantity!: number;

  constructor(values: Partial<ReservationEntity> = {}) {
    Object.assign(this, values);
  }
}
