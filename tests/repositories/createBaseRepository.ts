import { createRepositoryFactory } from '../../src';

export const createBaseRepository = createRepositoryFactory({
  async countAll() {
    return this.count();
  },
});
