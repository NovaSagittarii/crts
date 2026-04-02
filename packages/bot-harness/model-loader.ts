/**
 * Bot model loader with auto-detect from training runs directory.
 *
 * Provides loadBotModel() for use by the live bot CLI. Supports explicit
 * model path or automatic discovery of the most recent trained model.
 */
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type * as tf from '@tensorflow/tfjs';

import { loadModelFromDir } from './training/tfjs-file-io.js';

/**
 * Options for loading a bot model.
 */
export interface LoadBotModelOptions {
  /** Explicit path to a model directory containing model.json + weights.bin */
  modelPath?: string;
  /** Root directory containing run-YYYYMMDD-HHMMSS subdirectories (default: 'runs') */
  runsDir?: string;
}

/**
 * Scans a runs directory for the most recent training run that has a
 * final-model/ subdirectory with a model.json file.
 *
 * Directories are sorted by name descending (the YYYYMMDD-HHMMSS suffix
 * provides chronological ordering).
 *
 * @returns Path to the final-model directory, or null if none found.
 */
export async function findLatestModelDir(
  runsDir: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return null;
  }

  // Filter for run-* directories and sort descending (most recent first)
  const runDirs = entries
    .filter((name) => name.startsWith('run-'))
    .sort((a, b) => b.localeCompare(a));

  for (const dirName of runDirs) {
    const dirPath = join(runsDir, dirName);

    // Verify it's a directory
    try {
      const dirStat = await stat(dirPath);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }

    // Check for final-model/model.json
    const modelJsonPath = join(dirPath, 'final-model', 'model.json');
    try {
      await access(modelJsonPath);
      return join(dirPath, 'final-model');
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Load a TF.js LayersModel for bot inference.
 *
 * If `modelPath` is provided, loads directly from that directory.
 * Otherwise, auto-detects the most recent trained model from `runsDir`
 * (defaults to 'runs').
 *
 * @throws Error if no model is found when auto-detecting.
 */
export async function loadBotModel(
  options: LoadBotModelOptions = {},
): Promise<tf.LayersModel> {
  const { modelPath, runsDir } = options;

  if (modelPath) {
    return loadModelFromDir(modelPath);
  }

  const detectedDir = await findLatestModelDir(runsDir ?? 'runs');
  if (!detectedDir) {
    throw new Error(
      `No trained model found in '${runsDir ?? 'runs'}'. ` +
        'Run training first or provide an explicit --model-path.',
    );
  }

  return loadModelFromDir(detectedDir);
}
