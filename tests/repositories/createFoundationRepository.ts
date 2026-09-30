import { createRepositoryFactory } from '../../src';

export const createFoundationRepository = createRepositoryFactory({
  async countAll() {
    return this.count();
  },
});
