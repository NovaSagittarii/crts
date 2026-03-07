import { describe, expect, test } from 'vitest';

import { Grid } from '#conway-core';

import { createIdentityPlacementTransform } from './placement-transform.js';
import {
  CORE_STRUCTURE_TEMPLATE,
  CORE_TEMPLATE_GRID,
  CORE_TEMPLATE_ID,
  CORE_TEMPLATE_PADDING,
  CORE_TEMPLATE_ROWS,
  StructureTemplate,
  createDefaultStructureTemplates,
  padTemplateGrid,
  parseTemplateRows,
} from './structure.js';

describe('structure', () => {
  test('provides default structure templates with expected metadata', () => {
    const templates = createDefaultStructureTemplates();

    expect(templates.map(({ id }) => id)).toEqual([
      'block',
      'generator',
      'glider',
      'eater-1',
      'gosper',
    ]);

    const generator = templates.find(({ id }) => id === 'generator');
    expect(generator).toBeDefined();
    expect(generator?.width).toBe(4);
    expect(generator?.height).toBe(4);
    expect(generator?.activationCost).toBe(6);
    expect(generator?.income).toBe(2);
    expect(generator?.buildRadius).toBe(2);
    expect(generator?.checks).toHaveLength(0);
    expect(generator?.toSummary().buildRadius).toBe(2);
    expect(generator?.toPayload().buildRadius).toBe(2);
  });

  test('creates fresh default template instances on each call', () => {
    const first = createDefaultStructureTemplates();
    const second = createDefaultStructureTemplates();

    expect(first).not.toBe(second);
    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
    expect(first[0]).not.toBe(second[0]);
  });

  test('clones grid-backed template input during construction', () => {
    const sourceGrid = new Grid(2, 2, [{ x: 0, y: 0 }], 'flat');

    const template = new StructureTemplate({
      id: 'grid-probe',
      name: 'Grid Probe',
      grid: sourceGrid,
      activationCost: 0,
      income: 0,
      buildRadius: 0,
      startingHp: 2,
      checks: [],
    });

    sourceGrid.setCell(1, 1, true);

    expect(template.width).toBe(2);
    expect(template.height).toBe(2);
    expect(template.isCellAlive(0, 0)).toBe(true);
    expect(template.isCellAlive(1, 1)).toBe(false);
    expect(template.isCellAlive(1, 0)).toBe(false);
  });

  test('parses template rows into packed grid cells', () => {
    const template = parseTemplateRows(['#.', '.#']);

    expect(template.width).toBe(2);
    expect(template.height).toBe(2);
    expect(Array.from(template.cells)).toEqual([1, 0, 0, 1]);
  });

  test('rejects malformed template rows', () => {
    expect(() => parseTemplateRows([])).toThrow(
      'Template rows must not be empty',
    );
    expect(() => parseTemplateRows(['#', '##'])).toThrow(
      'Template rows must have a consistent width',
    );
    expect(() => parseTemplateRows(['x'])).toThrow(
      'Unsupported template symbol: x',
    );
  });

  test('pads packed template grids around the original footprint', () => {
    const packed = parseTemplateRows(['#']);
    const padded = padTemplateGrid(packed, 1);

    expect(padded.width).toBe(3);
    expect(padded.height).toBe(3);
    expect(Array.from(padded.cells)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  test('clones packed template cells when padding is zero', () => {
    const packed = parseTemplateRows(['##']);
    const padded = padTemplateGrid(packed, 0);

    expect(padded.width).toBe(2);
    expect(padded.height).toBe(1);
    expect(Array.from(padded.cells)).toEqual([1, 1]);
    expect(padded.cells).not.toBe(packed.cells);
  });

  test('builds core template constants and core structure template consistently', () => {
    expect(CORE_TEMPLATE_ID).toBe('__core__');
    expect(CORE_TEMPLATE_ROWS).toEqual([
      '##.##',
      '##.##',
      '.....',
      '##.##',
      '##.##',
    ]);
    expect(CORE_TEMPLATE_PADDING).toBe(3);

    expect(CORE_TEMPLATE_GRID.width).toBe(11);
    expect(CORE_TEMPLATE_GRID.height).toBe(11);

    expect(CORE_STRUCTURE_TEMPLATE.id).toBe(CORE_TEMPLATE_ID);
    expect(CORE_STRUCTURE_TEMPLATE.startingHp).toBe(500);
    expect(CORE_STRUCTURE_TEMPLATE.requiresDestroyConfirm).toBe(true);
    expect(CORE_STRUCTURE_TEMPLATE.buildRadius).toBe(14.9);
    expect(CORE_STRUCTURE_TEMPLATE.toSummary().buildRadius).toBe(14.9);
    expect(CORE_STRUCTURE_TEMPLATE.toPayload().buildRadius).toBe(14.9);
    expect(CORE_STRUCTURE_TEMPLATE.width).toBe(CORE_TEMPLATE_GRID.width);
    expect(CORE_STRUCTURE_TEMPLATE.height).toBe(CORE_TEMPLATE_GRID.height);
  });

  test('derives structure build radius from active template instances including core', () => {
    const relayTemplate = new StructureTemplate({
      id: 'relay',
      name: 'Relay',
      grid: new Grid(1, 1, [{ x: 0, y: 0 }], 'flat'),
      activationCost: 0,
      income: 0,
      buildRadius: 7.5,
      startingHp: 2,
      checks: [],
    });

    const activeRelay = relayTemplate.instantiate({
      key: 'relay-1',
      x: 3,
      y: 4,
      transform: createIdentityPlacementTransform(),
      active: true,
      isCore: false,
    });
    expect(activeRelay.buildRadius).toBe(7.5);

    activeRelay.deactivate();
    expect(activeRelay.buildRadius).toBe(0);

    const activeCore = CORE_STRUCTURE_TEMPLATE.instantiate({
      key: 'core-1',
      x: 8,
      y: 8,
      transform: createIdentityPlacementTransform(),
      active: true,
      isCore: true,
    });
    expect(activeCore.buildRadius).toBe(14.9);

    activeCore.destroy();
    expect(activeCore.buildRadius).toBe(0);
  });
});
