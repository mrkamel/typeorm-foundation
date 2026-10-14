import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { IsString } from 'class-validator';
import { IsUnique } from '../../src/validations';
import { TeamEntity } from './TeamEntity';

@Entity('seats')
@Index('unique_index_seats_on_team_and_label', ['team', 'label'], { unique: true })
export class SeatEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TeamEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'team_id' })
  team!: TeamEntity;

  @Column({ type: 'varchar', length: 36 })
  @IsString()
  @IsUnique<SeatEntity, 'label'>({ keyName: 'unique_index_seats_on_team_and_label' })
  label!: string;

  constructor(values: Partial<SeatEntity> = {}) {
    Object.assign(this, values);
  }
}
