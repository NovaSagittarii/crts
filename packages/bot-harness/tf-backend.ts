import * as util from 'node:util';
import type * as tfTypes from '@tensorflow/tfjs';

// Polyfill util.isNullOrUndefined — removed in modern Node.js but
// referenced by @tensorflow/tfjs-node@4.22.0's native kernel backend.
// Use try/catch: on some Node versions the property exists but is
// non-configurable (deprecated but present), on others it's gone entirely.
try {
  if (
    typeof (util as Record<string, unknown>).isNullOrUndefined !== 'function'
  ) {
    Object.defineProperty(util, 'isNullOrUndefined', {
      value: (val: unknown): val is null | undefined =>
        val === null || val === undefined,
      writable: true,
      configurable: true,
    });
  }
} catch {
  // Property exists and is non-configurable — already functional, nothing to do.
}

export type TfModule = typeof tfTypes;

let _promise: Promise<TfModule> | null = null;
let _backendName: 'native' | 'cpu' = 'cpu';

async function loadBackend(): Promise<TfModule> {
  try {
    const mod = await import('@tensorflow/tfjs-node');
    _backendName = 'native';
    return mod as unknown as TfModule;
  } catch {
    const mod = await import('@tensorflow/tfjs');
    _backendName = 'cpu';
    return mod;
  }
}

export function getTf(): Promise<TfModule> {
  if (_promise === null) {
    _promise = loadBackend();
  }
  return _promise;
}

export function getBackendName(): 'native' | 'cpu' {
  return _backendName;
}
