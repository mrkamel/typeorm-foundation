import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { IsBoolean, IsInt, IsString } from 'class-validator';

@Entity('reservations')
@Index(['resource'], { unique: true, where: '"active" = true' })
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
