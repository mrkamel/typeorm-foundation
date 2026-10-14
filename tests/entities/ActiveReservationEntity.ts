import { ViewColumn, ViewEntity } from 'typeorm';

@ViewEntity({ name: 'active_reservations', expression: 'SELECT id, resource FROM reservations WHERE active = true' })
export class ActiveReservationEntity {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  resource!: string;

  constructor(values: Partial<ActiveReservationEntity> = {}) {
    Object.assign(this, values);
  }
}
