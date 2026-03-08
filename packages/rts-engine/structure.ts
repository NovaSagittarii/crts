import { Grid } from '#conway-core';

import type { Vector2 } from './geometry.js';
import {
  type PlacementTransformState,
  type TransformedTemplate,
  projectPlacementToWorld,
  projectTemplateWithTransform,
} from './placement-transform.js';

export interface PackedTemplateGrid {
  width: number;
  height: number;
  cells: Uint8Array;
}

export const CORE_TEMPLATE_ID = '__core__';
export const CORE_TEMPLATE_PADDING = 3;
export const CORE_TEMPLATE_ROWS = ['##.##', '##.##', '.....', '##.##', '##.##'];

export function parseTemplateRows(rows: readonly string[]): PackedTemplateGrid {
  if (rows.length === 0) {
    throw new Error('Template rows must not be empty');
  }

  const width = rows[0].length;
  if (width === 0) {
    throw new Error('Template rows must not be empty strings');
  }

  for (const row of rows) {
    if (row.length !== width) {
      throw new Error('Template rows must have a consistent width');
    }
  }

  const height = rows.length;
  const cells = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const symbol = rows[y][x];
      if (symbol === '#') {
        cells[y * width + x] = 1;
      } else if (symbol === '.') {
        cells[y * width + x] = 0;
      } else {
        throw new Error(`Unsupported template symbol: ${symbol}`);
      }
    }
  }

  return { width, height, cells };
}

export function padTemplateGrid(
  template: PackedTemplateGrid,
  padding: number,
): PackedTemplateGrid {
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error('Template padding must be a non-negative integer');
  }

  if (padding === 0) {
    return {
      width: template.width,
      height: template.height,
      cells: new Uint8Array(template.cells),
    };
  }

  const paddedWidth = template.width + padding * 2;
  const paddedHeight = template.height + padding * 2;
  const paddedCells = new Uint8Array(paddedWidth * paddedHeight);
  for (let i = 0; i < template.height; i += 1) {
    for (let j = 0; j < template.width; j += 1) {
      paddedCells[(i + padding) * paddedWidth + (j + padding)] =
        template.cells[i * template.width + j];
    }
  }

  return {
    width: paddedWidth,
    height: paddedHeight,
    cells: paddedCells,
  };
}

export const CORE_TEMPLATE_GRID = padTemplateGrid(
  parseTemplateRows(CORE_TEMPLATE_ROWS),
  CORE_TEMPLATE_PADDING,
);

interface StructureTemplateSharedOptions {
  id: string;
  name: string;
  activationCost: number;
  income: number;
  buildArea: number;
  startingHp: number;
  checks: Vector2[];
  requiresDestroyConfirm?: boolean;
}

export interface StructureTemplateGridOptions extends StructureTemplateSharedOptions {
  grid: Grid;
}

export type StructureTemplateInput =
  | StructureTemplate
  | StructureTemplateGridOptions;

export interface StructureInstantiationOptions {
  key: string;
  x: number;
  y: number;
  transform: PlacementTransformState;
  active: boolean;
  isCore: boolean;
}

interface StructureOptions extends StructureInstantiationOptions {
  template: StructureTemplate;
  hp: number;
}

export interface StructureTemplateSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  activationCost: number;
  income: number;
  buildArea: number;
  startingHp: number;
}

export interface StructureTemplatePayload extends StructureTemplateSummary {
  cells: number[];
  checks: Vector2[];
}

export interface StructurePayload {
  key: string;
  templateId: string;
  templateName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  active: boolean;
  isCore: boolean;
  requiresDestroyConfirm: boolean;
  transform: PlacementTransformState;
  footprint: Vector2[];
}

export class StructureTemplate {
  public readonly id: string;

  public readonly name: string;

  public readonly width: number;

  public readonly height: number;

  public readonly activationCost: number;

  public readonly income: number;

  public readonly buildArea: number;

  public readonly startingHp: number;

  public readonly checks: Vector2[];

  public readonly requiresDestroyConfirm: boolean;

  private readonly templateGrid: Grid;

  private readonly projectionCache = new Map<string, TransformedTemplate>();

  public constructor(options: StructureTemplateGridOptions) {
    this.id = options.id;
    this.name = options.name;
    this.templateGrid = StructureTemplate.cloneAsTemplateGrid(options.grid);
    this.width = this.templateGrid.width;
    this.height = this.templateGrid.height;
    this.activationCost = options.activationCost;
    this.income = options.income;
    this.buildArea = options.buildArea;
    if (!Number.isFinite(options.startingHp) || options.startingHp <= 0) {
      throw new Error('Template starting HP must be greater than zero');
    }
    this.startingHp = options.startingHp;
    this.checks = options.checks.map((check) => ({ x: check.x, y: check.y }));
    this.requiresDestroyConfirm = Boolean(options.requiresDestroyConfirm);
  }

  private static cloneAsTemplateGrid(grid: Grid): Grid {
    return new Grid(
      grid.width,
      grid.height,
      StructureTemplate.collectAliveCells(grid),
      'flat',
    );
  }

  private static collectAliveCells(grid: Grid): Vector2[] {
    const aliveCells: Vector2[] = [];
    for (const cell of grid.cells()) {
      if (!cell.alive) {
        continue;
      }

      aliveCells.push({ x: cell.x, y: cell.y });
    }

    return aliveCells;
  }

  private static createProjectionCacheKey(
    transform: PlacementTransformState,
  ): string {
    const matrix = transform.matrix;
    return `${matrix.xx},${matrix.xy},${matrix.yx},${matrix.yy}`;
  }

  public static from(input: StructureTemplateInput): StructureTemplate {
    return input instanceof StructureTemplate
      ? input
      : new StructureTemplate(input);
  }

  public instantiate(options: StructureInstantiationOptions): Structure {
    return new Structure({
      template: this,
      ...options,
      hp: this.startingHp,
    });
  }

  public project(transform: PlacementTransformState): TransformedTemplate {
    const cacheKey = StructureTemplate.createProjectionCacheKey(transform);
    const cachedProjection = this.projectionCache.get(cacheKey);
    if (cachedProjection) {
      return cachedProjection;
    }

    const projection = projectTemplateWithTransform(
      {
        width: this.width,
        height: this.height,
        grid: this.templateGrid,
        checks: this.checks,
      },
      transform,
    );

    this.projectionCache.set(cacheKey, projection);
    return projection;
  }

  public isCellAlive(x: number, y: number): boolean {
    return this.templateGrid.isCellAlive(x, y);
  }

  public projectPlacement(
    x: number,
    y: number,
    transform: PlacementTransformState,
    roomWidth: number,
    roomHeight: number,
  ): ReturnType<typeof projectPlacementToWorld> {
    return projectPlacementToWorld(
      this.project(transform),
      x,
      y,
      roomWidth,
      roomHeight,
    );
  }

  public toSummary(): StructureTemplateSummary {
    return {
      id: this.id,
      name: this.name,
      width: this.width,
      height: this.height,
      activationCost: this.activationCost,
      income: this.income,
      buildArea: this.buildArea,
      startingHp: this.startingHp,
    };
  }

  public toPayload(): StructureTemplatePayload {
    return {
      ...this.toSummary(),
      cells: [...new Uint8Array(this.templateGrid.toPacked())],
      checks: this.checks.map((check) => ({ x: check.x, y: check.y })),
    };
  }
}

export class Structure {
  public readonly key: string;

  public readonly template: StructureTemplate;

  public readonly x: number;

  public readonly y: number;

  public readonly transform: PlacementTransformState;

  public active: boolean;

  public hp: number;

  public readonly isCore: boolean;

  private readonly projectedTemplate: TransformedTemplate;

  public constructor(options: StructureOptions) {
    this.key = options.key;
    this.template = options.template;
    this.x = options.x;
    this.y = options.y;
    this.transform = options.transform;
    this.active = options.active;
    this.hp = options.hp;
    this.isCore = options.isCore;
    this.projectedTemplate = this.template.project(this.transform);
  }

  public get templateId(): string {
    return this.template.id;
  }

  public get buildRadius(): number {
    return this.active && !this.isCore ? this.template.buildArea : 0;
  }

  public projectTemplate(): TransformedTemplate {
    return this.projectedTemplate;
  }

  public projectPlacement(
    roomWidth: number,
    roomHeight: number,
  ): ReturnType<typeof projectPlacementToWorld> {
    return this.template.projectPlacement(
      this.x,
      this.y,
      this.transform,
      roomWidth,
      roomHeight,
    );
  }

  public destroy(): void {
    this.hp = 0;
    this.active = false;
  }

  public deactivate(): void {
    this.active = false;
  }

  public setActive(next: boolean): void {
    this.active = this.hp > 0 && next;
  }

  public applyIntegrityDamage(amount: number): void {
    this.hp -= amount;
  }

  public toPayload(roomWidth: number, roomHeight: number): StructurePayload {
    const transformedTemplate = this.projectTemplate();
    const projection = projectPlacementToWorld(
      transformedTemplate,
      this.x,
      this.y,
      roomWidth,
      roomHeight,
    );
    return {
      key: this.key,
      templateId: this.template.id,
      templateName: this.template.name,
      x: this.x,
      y: this.y,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
      hp: this.hp,
      active: this.active,
      isCore: this.isCore,
      requiresDestroyConfirm: this.template.requiresDestroyConfirm,
      transform: this.transform,
      footprint: projection.occupiedCells,
    };
  }
}

interface StructureTemplateRowsOptions {
  id: string;
  name: string;
  rows: readonly string[];
  activationCost?: number;
  income?: number;
  buildArea?: number;
  startingHp: number;
  requiresDestroyConfirm?: boolean;
  padding?: number;
  checked?: boolean;
}

function createGridFromPackedTemplate(template: PackedTemplateGrid): Grid {
  const aliveCells: Vector2[] = [];
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      if (template.cells[y * template.width + x] === 1) {
        aliveCells.push({ x, y });
      }
    }
  }

  return new Grid(template.width, template.height, aliveCells, 'flat');
}

function createTemplateFromRows({
  id,
  name,
  rows,
  activationCost = 0,
  income = 0,
  buildArea = 0,
  startingHp,
  requiresDestroyConfirm = false,
  padding = 0,
  checked: _checked = false,
}: StructureTemplateRowsOptions): StructureTemplate {
  const parsed = parseTemplateRows(rows);
  const padded = padTemplateGrid(parsed, padding);
  const templateGrid = createGridFromPackedTemplate(padded);
  return new StructureTemplate({
    id,
    name,
    grid: templateGrid,
    activationCost,
    income,
    buildArea,
    startingHp,
    checks: [], // TODO: wire checked/checks behavior if needed.
    requiresDestroyConfirm,
  });
}

export const CORE_STRUCTURE_TEMPLATE = createTemplateFromRows({
  id: CORE_TEMPLATE_ID,
  name: 'Core',
  rows: CORE_TEMPLATE_ROWS,
  buildArea: 0,
  startingHp: 500,
  requiresDestroyConfirm: true,
  padding: CORE_TEMPLATE_PADDING,
});

export function createDefaultStructureTemplates(): StructureTemplate[] {
  return [
    createTemplateFromRows({
      id: 'block',
      name: 'Block 2x2',
      rows: ['##', '##'],
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
    }),
    createTemplateFromRows({
      id: 'generator',
      name: 'Generator Block',
      rows: ['##', '##'],
      activationCost: 6,
      income: 2,
      buildArea: 2,
      startingHp: 2,
      padding: 1,
      checked: true,
    }),
    createTemplateFromRows({
      id: 'glider',
      name: 'Glider',
      rows: ['.#.', '..#', '###'],
      activationCost: 2,
      income: 0,
      buildArea: 0,
      startingHp: 2,
    }),
    createTemplateFromRows({
      id: 'eater-1',
      name: 'Eater 1',
      rows: ['##..', '#.##', '.###', '..#.'],
      activationCost: 4,
      income: 0,
      buildArea: 1,
      startingHp: 2,
    }),
    createTemplateFromRows({
      id: 'gosper',
      name: 'Gosper glider gun',
      rows: [
        '........................#...........',
        '......................#.#...........',
        '............##......##............##',
        '...........#...#....##............##',
        '##........#.....#...##..............',
        '##........#...#.##....#.#...........',
        '..........#.....#.......#...........',
        '...........#...#....................',
        '............##......................',
      ],
      startingHp: 2,
    }),
  ];
}
