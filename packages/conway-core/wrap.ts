export function wrapCoordinate(value: number, size: number): number {
  const wrapped = value % size;
  return wrapped >= 0 ? wrapped : wrapped + size;
}
