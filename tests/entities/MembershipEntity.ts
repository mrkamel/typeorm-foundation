import { Column, Entity, PrimaryColumn } from 'typeorm';
import { IsBoolean } from 'class-validator';

@Entity('memberships')
export class MembershipEntity {
  @PrimaryColumn({ name: 'organization_id', type: 'varchar', length: 36 })
  organizationId!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  @IsBoolean()
  isActive = true;

  constructor(values: Partial<MembershipEntity> = {}) {
    Object.assign(this, values);
  }
}
