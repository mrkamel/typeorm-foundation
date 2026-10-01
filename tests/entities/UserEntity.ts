import { AfterUpdate, BeforeUpdate, Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ValueTransformer } from 'typeorm';
import { IsEmail } from 'class-validator';
import { isDirty, ValidateRelation, ValidateUniqueness, ValidateWith } from '../../src/validations';
import { TeamEntity } from './TeamEntity';

const scoreTransformer: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value == null ? null : Number(value),
};

@Entity('users')
export class UserEntity {
  static hookCalls: string[] = [];

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  @IsEmail()
  @ValidateUniqueness({ validateIf: (user) => isDirty(user, 'email') })
  email!: string;

  @Column({ type: 'integer', nullable: true })
  @ValidateWith<UserEntity, 'age'>((value) => {
    if (value != null && value < 0) return 'must not be negative';
  })
  age!: number | null;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  @ValidateWith<UserEntity, 'displayName'>((value) => {
    if (value === 'reserved') return 'is reserved';
  }, { message: 'is not allowed' })
  displayName!: string | null;

  @Column({ type: 'numeric', nullable: true, transformer: scoreTransformer })
  score!: number | null;

  @Column({ type: 'text', nullable: true })
  @ValidateRelation<UserEntity, 'teamId', TeamEntity>(() => TeamEntity, {
    validateIf: (user) => user.teamId != null,
    with: (team) => {
      if (team.archived) return 'team is archived';
    },
  })
  teamId!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;

  @UpdateDateColumn()
  syncedAt!: Date;

  @BeforeUpdate()
  onBeforeUpdate() {
    UserEntity.hookCalls.push('before');
  }

  @AfterUpdate()
  onAfterUpdate() {
    UserEntity.hookCalls.push('after');
  }

  constructor(values: Partial<UserEntity> = {}) {
    Object.assign(this, values);
  }
}
