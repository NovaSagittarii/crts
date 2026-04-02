import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { findLatestModelDir, loadBotModel } from './model-loader.js';

describe('findLatestModelDir', () => {
  test('returns null when runs directory does not exist', async () => {
    const result = await findLatestModelDir('/tmp/nonexistent-runs-dir-xyz');
    expect(result).toBeNull();
  });

  test('returns null when runs directory is empty', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'model-loader-'));
    try {
      const result = await findLatestModelDir(tmp);
      expect(result).toBeNull();
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  test('returns null when no run directory has a final-model', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'model-loader-'));
    try {
      await mkdir(join(tmp, 'run-20260101-120000'));
      const result = await findLatestModelDir(tmp);
      expect(result).toBeNull();
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  test('returns path to the most recent final-model directory', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'model-loader-'));
    try {
      // Create two runs, older one has final-model, newer one also has it
      const older = join(tmp, 'run-20260101-100000');
      const newer = join(tmp, 'run-20260102-100000');
      await mkdir(join(older, 'final-model'), { recursive: true });
      await writeFile(join(older, 'final-model', 'model.json'), '{}');
      await mkdir(join(newer, 'final-model'), { recursive: true });
      await writeFile(join(newer, 'final-model', 'model.json'), '{}');

      const result = await findLatestModelDir(tmp);
      expect(result).toBe(join(newer, 'final-model'));
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  test('skips non-run directories', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'model-loader-'));
    try {
      // A non-run directory with final-model should be skipped
      const notRun = join(tmp, 'something-else');
      await mkdir(join(notRun, 'final-model'), { recursive: true });
      await writeFile(join(notRun, 'final-model', 'model.json'), '{}');

      // An actual run directory with final-model
      const run = join(tmp, 'run-20260101-100000');
      await mkdir(join(run, 'final-model'), { recursive: true });
      await writeFile(join(run, 'final-model', 'model.json'), '{}');

      const result = await findLatestModelDir(tmp);
      expect(result).toBe(join(run, 'final-model'));
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  test('skips runs where final-model exists but model.json is missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'model-loader-'));
    try {
      // Newer run has final-model dir but no model.json
      const newer = join(tmp, 'run-20260102-100000');
      await mkdir(join(newer, 'final-model'), { recursive: true });

      // Older run has complete final-model
      const older = join(tmp, 'run-20260101-100000');
      await mkdir(join(older, 'final-model'), { recursive: true });
      await writeFile(join(older, 'final-model', 'model.json'), '{}');

      const result = await findLatestModelDir(tmp);
      expect(result).toBe(join(older, 'final-model'));
    } finally {
      await rm(tmp, { recursive: true });
    }
  });
});

describe('loadBotModel', () => {
  test('throws when no model found and no explicit path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'model-loader-'));
    try {
      await expect(loadBotModel({ runsDir: tmp })).rejects.toThrow(
        /no trained model found/i,
      );
    } finally {
      await rm(tmp, { recursive: true });
    }
  });
});
