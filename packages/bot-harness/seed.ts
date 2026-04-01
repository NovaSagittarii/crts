export function seedToRoomId(seed: number): string {
  return `headless-${seed.toString(36)}`;
}

export function generateSeeds(baseSeed: number, count: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(baseSeed + i);
  }
  return seeds;
}
