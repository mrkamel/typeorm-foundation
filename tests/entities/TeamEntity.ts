import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';
import { isDirty, ValidateUniqueness } from '../../src/validations';

@Entity('teams')
export class TeamEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Column({ type: 'text' })
  @ValidateUniqueness({ scope: ['archived'], validateIf: (team) => isDirty(team, 'code') })
  code!: string;

  @Column({ type: 'boolean', default: false })
  @IsBoolean()
  archived!: boolean;

  constructor(values: Partial<TeamEntity> = {}) {
    Object.assign(this, values);
  }
}
