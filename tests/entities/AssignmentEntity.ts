import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { IsString } from 'class-validator';
import { References } from '../../src/validations';
import { MembershipEntity } from './MembershipEntity';
import { TeamEntity } from './TeamEntity';

@Entity('assignments')
export class AssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'varchar', length: 36 })
  @IsString()
  organizationId!: string;

  @Column({ name: 'membership_id', type: 'varchar', length: 36, nullable: true })
  @References<AssignmentEntity, 'membershipId', MembershipEntity>(() => MembershipEntity, { foreignKey: ['organizationId', 'membershipId'] })
  membershipId!: string | null;

  @Column({ name: 'team_code', type: 'text', nullable: true })
  @References<AssignmentEntity, 'teamCode', TeamEntity>(() => TeamEntity, { primaryKey: 'code', validateIf: (assignment) => assignment.teamCode != null })
  teamCode: string | null = null;

  constructor(values: Partial<AssignmentEntity> = {}) {
    Object.assign(this, values);
  }
}
