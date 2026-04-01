/**
 * Custom TF.js file-system IOHandler for pure JS @tensorflow/tfjs backend.
 *
 * The `file://` scheme handler is only available in `@tensorflow/tfjs-node`.
 * Since we use the pure JS backend (musl libc on Alpine blocks native addon),
 * we implement save/load manually via node:fs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as tf from '@tensorflow/tfjs';

import type { WeightData } from './ppo-network.js';

/**
 * Save a TF.js LayersModel to a directory on disk.
 *
 * Writes `model.json` (topology + weight manifest) and `weights.bin`
 * (concatenated weight buffers) matching TF.js SavedModel format (D-04).
 */
export async function saveModelToDir(
  model: tf.LayersModel,
  dir: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });

  // Use the model's built-in toJSON for topology
  const topology = model.toJSON(undefined, false);

  // Extract weights
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const weightBuffers: ArrayBuffer[] = [];

  for (const w of model.weights) {
    const data = w.read().dataSync() as Float32Array;
    // Clone into a standalone ArrayBuffer (dataSync may return shared backing)
    const cloned = new ArrayBuffer(data.byteLength);
    new Float32Array(cloned).set(data);
    weightSpecs.push({
      name: w.name,
      shape: w.shape as number[],
      dtype: w.dtype,
    });
    weightBuffers.push(cloned);
  }

  // Concatenate weight buffers
  const totalBytes = weightBuffers.reduce((sum, b) => sum + b.byteLength, 0);
  const concatenated = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of weightBuffers) {
    concatenated.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // Build model.json
  const modelJson = {
    modelTopology: topology,
    weightsManifest: [
      {
        paths: ['weights.bin'],
        weights: weightSpecs,
      },
    ],
  };

  await writeFile(join(dir, 'model.json'), JSON.stringify(modelJson), 'utf-8');
  await writeFile(join(dir, 'weights.bin'), concatenated);
}

/**
 * Load a TF.js LayersModel from a directory on disk.
 *
 * Reads `model.json` and associated weight files from the directory.
 */
export async function loadModelFromDir(
  dir: string,
): Promise<tf.LayersModel> {
  const modelJsonStr = await readFile(join(dir, 'model.json'), 'utf-8');
  const modelJson = JSON.parse(modelJsonStr) as {
    modelTopology: object;
    weightsManifest: tf.io.WeightsManifestConfig;
  };

  // Collect weight specs and load binary weight data
  const manifest = modelJson.weightsManifest;
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const weightBuffers: ArrayBuffer[] = [];

  for (const group of manifest) {
    for (const spec of group.weights) {
      weightSpecs.push(spec);
    }
    for (const path of group.paths) {
      const buffer = await readFile(join(dir, path));
      weightBuffers.push(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
      );
    }
  }

  // Concatenate all weight buffers into a single ArrayBuffer
  const totalBytes = weightBuffers.reduce((sum, b) => sum + b.byteLength, 0);
  const concatenated = new ArrayBuffer(totalBytes);
  const view = new Uint8Array(concatenated);
  let offset = 0;
  for (const buf of weightBuffers) {
    view.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // Use single-argument ModelArtifacts form (avoids deprecated multi-arg fromMemory)
  const artifacts: tf.io.ModelArtifacts = {
    modelTopology: modelJson.modelTopology,
    weightSpecs,
    weightData: concatenated,
  };

  const model = await tf.loadLayersModel(tf.io.fromMemory(artifacts));
  return model;
}

/**
 * Load raw weight data from a saved checkpoint directory.
 *
 * Returns WeightData[] (shape + ArrayBuffer pairs) without creating a
 * TF.js model, avoiding variable name collisions when another model
 * with the same topology already exists in the TF.js backend.
 */
export async function loadWeightsFromDir(
  dir: string,
): Promise<WeightData[]> {
  const modelJsonStr = await readFile(join(dir, 'model.json'), 'utf-8');
  const modelJson = JSON.parse(modelJsonStr) as {
    weightsManifest: tf.io.WeightsManifestConfig;
  };

  const manifest = modelJson.weightsManifest;
  const specs: tf.io.WeightsManifestEntry[] = [];
  const binaryBuffers: ArrayBuffer[] = [];

  for (const group of manifest) {
    for (const spec of group.weights) {
      specs.push(spec);
    }
    for (const path of group.paths) {
      const fileBuffer = await readFile(join(dir, path));
      binaryBuffers.push(
        fileBuffer.buffer.slice(
          fileBuffer.byteOffset,
          fileBuffer.byteOffset + fileBuffer.byteLength,
        ),
      );
    }
  }

  // Concatenate binary buffers
  const totalBytes = binaryBuffers.reduce((sum, b) => sum + b.byteLength, 0);
  const concatenated = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of binaryBuffers) {
    concatenated.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // Slice out individual weight buffers from the concatenated data
  const result: WeightData[] = [];
  let byteOffset = 0;
  for (const spec of specs) {
    const numElements = spec.shape.reduce((a, b) => a * b, 1);
    const bytesPerElement = spec.dtype === 'float32' ? 4 : spec.dtype === 'int32' ? 4 : 4;
    const byteLength = numElements * bytesPerElement;
    const buffer = concatenated.buffer.slice(byteOffset, byteOffset + byteLength);
    result.push({ shape: spec.shape, buffer });
    byteOffset += byteLength;
  }

  return result;
}
