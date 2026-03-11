import {
  type BuildQueuePayload,
  type PlacementTransformInput,
  type PlacementTransformOperation,
} from '#rts-engine';

const PLACEMENT_TRANSFORM_OPERATIONS = new Set<PlacementTransformOperation>([
  'rotate',
  'mirror-horizontal',
  'mirror-vertical',
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

function parsePlacementTransformInput(
  value: unknown,
): PlacementTransformInput | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isObjectRecord(value)) {
    return null;
  }

  const operationsValue = value.operations;
  if (!Array.isArray(operationsValue)) {
    return null;
  }

  const operations: PlacementTransformOperation[] = [];
  for (const candidate of operationsValue) {
    if (typeof candidate !== 'string') {
      return null;
    }
    if (
      !PLACEMENT_TRANSFORM_OPERATIONS.has(
        candidate as PlacementTransformOperation,
      )
    ) {
      return null;
    }
    operations.push(candidate as PlacementTransformOperation);
  }

  return { operations };
}

export function parseBuildPayload(payload: unknown): BuildQueuePayload | null {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const { delayTicks, templateId, transform, x, y } = payload;
  if (typeof templateId !== 'string' || templateId.trim().length === 0) {
    return null;
  }
  if (!isFiniteInteger(x) || !isFiniteInteger(y)) {
    return null;
  }

  const parsedTransform = parsePlacementTransformInput(transform);
  if (parsedTransform === null) {
    return null;
  }
  if (delayTicks !== undefined && !isFiniteInteger(delayTicks)) {
    return null;
  }

  return {
    templateId,
    x,
    y,
    delayTicks,
    transform: parsedTransform,
  };
}
