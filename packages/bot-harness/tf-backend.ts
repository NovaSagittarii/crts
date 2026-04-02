import { createRequire } from 'node:module';
import type * as tfTypes from '@tensorflow/tfjs';

// Polyfill util.isNullOrUndefined — removed in modern Node.js but
// referenced by @tensorflow/tfjs-node@4.22.0's native kernel backend.
// Must patch the CJS require cache (not ESM namespace) because tfjs-node
// uses require('util') internally. ESM namespace objects are frozen.
try {
  const cjsRequire = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const cjsUtil: Record<string, unknown> = cjsRequire('util');
  if (typeof cjsUtil.isNullOrUndefined !== 'function') {
    cjsUtil.isNullOrUndefined = (val: unknown): boolean =>
      val === null || val === undefined;
  }
} catch {
  // Best-effort — if patching fails, getTf() will fall back to pure JS anyway.
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
