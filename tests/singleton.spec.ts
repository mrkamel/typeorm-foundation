import { afterEach, describe, expect, it, vi } from 'vitest';
import { singleton } from '../src/singleton';
import { version } from '../src/version';

const globalScope = globalThis as typeof globalThis & Record<symbol, unknown>;
const usedNames: string[] = [];

function keyFor(name: string) {
  return Symbol.for(`typeorm-foundation@${version}:${name}`);
}

function uniqueName() {
  const name = `test:${Math.random().toString(36).slice(2)}`;
  usedNames.push(name);

  return name;
}

afterEach(() => {
  for (const name of usedNames.splice(0)) delete globalScope[keyFor(name)];
});

describe('singleton', () => {
  it('creates the value on first use and returns the same one afterwards', () => {
    const name = uniqueName();
    const create = vi.fn(() => ({}));

    const first = singleton(name, create);
    const second = singleton(name, create);

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledOnce();
  });

  it('stores the value on globalThis under a shared symbol', () => {
    const name = uniqueName();

    const value = singleton(name, () => ({}));

    expect(globalScope[keyFor(name)]).toBe(value);
  });

  it('reuses a value another copy of the library already registered', () => {
    const name = uniqueName();
    const registered = {};
    globalScope[keyFor(name)] = registered;

    const create = vi.fn(() => ({}));

    expect(singleton(name, create)).toBe(registered);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps values of different names apart', () => {
    expect(singleton(uniqueName(), () => ({}))).not.toBe(singleton(uniqueName(), () => ({})));
  });

  it('keeps values of a different library version apart', () => {
    const name = uniqueName();
    const otherVersion = Symbol.for(`typeorm-foundation@0.0.0:${name}`);
    globalScope[otherVersion] = {};

    expect(singleton(name, () => ({}))).not.toBe(globalScope[otherVersion]);

    delete globalScope[otherVersion];
  });
});
