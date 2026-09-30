import { createRepositoryFactory } from '../../src';
import { dataSource } from '../dataSource';

export const createBaseRepository = createRepositoryFactory(dataSource, () => ({
  async countAll() {
    return this.count();
  },
}));
