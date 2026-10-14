import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { IsBoolean, IsInt, IsString } from 'class-validator';

@Entity('reservations')
@Index('index_reservations_resource', ['resource'], { unique: true, where: '"active" = true' })
@Index('index_reservations_quantity', ['quantity'])
@Unique('unique_reservations_resource_quantity', ['resource', 'quantity'])
@Unique('unique_reservations_id_resource', ['id', 'resource'], { deferrable: 'INITIALLY DEFERRED' })
export class ReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  @IsString()
  resource!: string;

  @Column({ type: 'boolean' })
  @IsBoolean()
  active!: boolean;

  @Column({ type: 'integer' })
  @IsInt()
  quantity!: number;

  constructor(values: Partial<ReservationEntity> = {}) {
    Object.assign(this, values);
  }
}
