import { describe, expect, test } from 'vitest';

import {
  FNV1A_32_OFFSET_BASIS,
  formatDeterminismHashHex,
  hashUtf16CodeUnits,
  hashUtf16StringBytes,
} from './determinism-hash.js';

describe('determinism hash helpers', () => {
  test('hashes raw UTF-16 string bytes with the existing membership encoding', () => {
    expect(
      formatDeterminismHashHex(
        hashUtf16StringBytes(FNV1A_32_OFFSET_BASIS, 'room:1'),
      ),
    ).toBe('ee57a539');
    expect(
      formatDeterminismHashHex(
        hashUtf16StringBytes(FNV1A_32_OFFSET_BASIS, 'A🙂'),
      ),
    ).toBe('7a6c38ed');
  });

  test('hashes UTF-16 code units with the existing spawn-seed encoding', () => {
    expect(
      formatDeterminismHashHex(
        hashUtf16CodeUnits(FNV1A_32_OFFSET_BASIS, 'room:1'),
      ),
    ).toBe('b64c6963');
    expect(
      formatDeterminismHashHex(
        hashUtf16CodeUnits(FNV1A_32_OFFSET_BASIS, 'A🙂'),
      ),
    ).toBe('9dcb14f3');
  });

  test('formats hash values as zero-padded lowercase hex', () => {
    expect(formatDeterminismHashHex(15)).toBe('0000000f');
  });
});
