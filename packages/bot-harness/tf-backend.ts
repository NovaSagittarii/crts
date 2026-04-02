import * as util from 'node:util';
import type * as tfTypes from '@tensorflow/tfjs';

// Polyfill util.isNullOrUndefined — removed in modern Node.js but
// referenced by @tensorflow/tfjs-node@4.22.0's native kernel backend.
if (typeof (util as Record<string, unknown>).isNullOrUndefined !== 'function') {
  (util as Record<string, unknown>).isNullOrUndefined = (
    val: unknown,
  ): val is null | undefined => val === null || val === undefined;
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
