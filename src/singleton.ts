import { version } from './version';

const globalScope = globalThis as typeof globalThis & Record<symbol, unknown>;

export function singleton<T>(name: string, create: () => T): T {
  const key = Symbol.for(`typeorm-foundation@${version}:${name}`);

  return (globalScope[key] ??= create()) as T;
}
