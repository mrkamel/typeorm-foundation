import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';
import { isDirty, IsUnique } from '../../src/validations';

@Entity('teams')
export class TeamEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Column({ type: 'text' })
  @IsUnique({ scope: ['archived'], validateIf: (team) => isDirty(team, 'code') })
  code!: string;

  @Column({ type: 'text', nullable: true })
  @IsUnique<TeamEntity, 'slug'>({ caseInsensitive: 'lower', validateIf: (team) => team.slug != null && isDirty(team, 'slug') })
  slug: string | null = null;

  @Column({ type: 'boolean', default: false })
  @IsBoolean()
  archived!: boolean;

  constructor(values: Partial<TeamEntity> = {}) {
    Object.assign(this, values);
  }
}
