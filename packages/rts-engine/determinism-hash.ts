export const FNV1A_32_OFFSET_BASIS = 2166136261;
export const FNV1A_32_PRIME = 16777619;

export function hashFNV1aByte(hash: number, value: number): number {
  return Math.imul((hash ^ (value & 0xff)) >>> 0, FNV1A_32_PRIME) >>> 0;
}

export function hashUtf16StringBytes(hash: number, value: string): number {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    next = hashFNV1aByte(next, code & 0xff);
    next = hashFNV1aByte(next, (code >>> 8) & 0xff);
  }
  return next;
}

export function hashUtf16CodeUnits(hash: number, value: string): number {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, FNV1A_32_PRIME) >>> 0;
  }
  return next;
}

export function formatDeterminismHashHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}
