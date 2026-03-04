export interface WrappedGridBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WrappedGridSegment = WrappedGridBounds;

interface SpanSegment {
  start: number;
  length: number;
}

function wrapCoordinate(value: number, dimension: number): number {
  const wrapped = value % dimension;
  return wrapped < 0 ? wrapped + dimension : wrapped;
}

function splitWrappedSpan(
  start: number,
  span: number,
  dimension: number,
): SpanSegment[] {
  if (span <= 0 || dimension <= 0) {
    return [];
  }

  const segments: SpanSegment[] = [];
  let remaining = span;
  let cursor = wrapCoordinate(start, dimension);

  while (remaining > 0) {
    const available = dimension - cursor;
    const length = Math.min(remaining, available);
    segments.push({ start: cursor, length });
    remaining -= length;
    cursor = 0;
  }

  return segments;
}

export function getWrappedBoundsSegments(
  bounds: WrappedGridBounds,
  gridWidth: number,
  gridHeight: number,
): WrappedGridSegment[] {
  if (gridWidth <= 0 || gridHeight <= 0) {
    return [];
  }

  const xSegments = splitWrappedSpan(bounds.x, bounds.width, gridWidth);
  const ySegments = splitWrappedSpan(bounds.y, bounds.height, gridHeight);
  const wrappedSegments: WrappedGridSegment[] = [];

  for (const xSegment of xSegments) {
    for (const ySegment of ySegments) {
      wrappedSegments.push({
        x: xSegment.start,
        y: ySegment.start,
        width: xSegment.length,
        height: ySegment.length,
      });
    }
  }

  return wrappedSegments;
}
