import { describe, expect, it } from 'vitest';

import { getBackendName, getTf } from './tf-backend.js';

describe('tf-backend', () => {
  it(
    'getTf returns a module with tensor, layers, model, train, tidy',
    async () => {
      const tf = await getTf();
      expect(typeof tf.tensor).toBe('function');
      expect(typeof tf.layers).toBe('object');
      expect(typeof tf.model).toBe('function');
      expect(typeof tf.train).toBe('function');
      expect(typeof tf.tidy).toBe('function');
    },
    15_000,
  );

  it('getTf returns same instance on repeated calls', async () => {
    const tf1 = await getTf();
    const tf2 = await getTf();
    expect(tf1).toBe(tf2);
  });

  it("getBackendName returns 'native' or 'cpu' after getTf", async () => {
    await getTf();
    expect(['native', 'cpu']).toContain(getBackendName());
  });

  it('concurrent getTf calls resolve to same module', async () => {
    const [a, b, c] = await Promise.all([getTf(), getTf(), getTf()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
