import {
  type CameraViewState,
  worldPointToScreen,
} from './camera-view-model.js';

export const DEFAULT_STRUCTURE_CARD_MARGIN_PX = 8;
export const DEFAULT_STRUCTURE_CARD_GAP_PX = 14;

const PINNED_CARD_Z_INDEX = '10';
const HOVER_CARD_Z_INDEX = '11';

export interface StructureCardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StructureCardVariant = 'hover' | 'pinned';

export interface StructureCardState {
  id: string;
  structureBounds: StructureCardBounds;
  variant: StructureCardVariant;
  visible: boolean;
}

export interface StructureCardPlacementInput {
  structureBounds: StructureCardBounds;
  camera: CameraViewState;
  cellSize: number;
  viewportWidth: number;
  viewportHeight: number;
  cardWidth: number;
  cardHeight: number;
  marginPx?: number;
  gapPx?: number;
}

export interface StructureCardPlacement {
  left: number;
  top: number;
  anchorX: number;
  anchorY: number;
}

export interface StructureCardLayerUpdateInput {
  cards: readonly StructureCardState[];
  camera: CameraViewState;
  cellSize: number;
  viewportWidth: number;
  viewportHeight: number;
  marginPx?: number;
  gapPx?: number;
}

export interface StructureCardSize {
  width: number;
  height: number;
}

export interface StructureCardRenderPlanItem {
  id: string;
  visible: boolean;
  variant: StructureCardVariant;
  placement: StructureCardPlacement | null;
}

export interface StructureCardRenderPlanInput {
  registeredIds: readonly string[];
  cards: readonly StructureCardState[];
  sizesById: Readonly<Record<string, StructureCardSize>>;
  camera: CameraViewState;
  cellSize: number;
  viewportWidth: number;
  viewportHeight: number;
  marginPx?: number;
  gapPx?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class StructureCardOverlayLayer {
  readonly #root: HTMLElement;
  readonly #cardElements = new Map<string, HTMLElement>();

  public constructor(root: HTMLElement) {
    this.#root = root;
  }

  public registerCardElement(id: string, element: HTMLElement): void {
    this.#cardElements.set(id, element);
    this.#root.append(element);
  }

  public unregisterCardElement(id: string): void {
    this.#cardElements.delete(id);
  }

  public update(input: StructureCardLayerUpdateInput): void {
    const sizesById: Record<string, StructureCardSize> = {};
    for (const [id, element] of this.#cardElements.entries()) {
      sizesById[id] = this.#measureCard(element);
    }

    const renderPlan = StructureCardOverlayLayer.deriveRenderPlan({
      registeredIds: Array.from(this.#cardElements.keys()),
      cards: input.cards,
      sizesById,
      camera: input.camera,
      cellSize: input.cellSize,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      marginPx: input.marginPx,
      gapPx: input.gapPx,
    });

    for (const item of renderPlan) {
      const element = this.#cardElements.get(item.id);
      if (element === undefined) {
        continue;
      }

      if (!item.visible || item.placement === null) {
        this.#hideCard(element);
        continue;
      }

      this.#showCard(element, item.variant);
      element.style.left = `${item.placement.left}px`;
      element.style.top = `${item.placement.top}px`;
      element.dataset.anchorX = `${item.placement.anchorX}`;
      element.dataset.anchorY = `${item.placement.anchorY}`;
    }
  }

  public static deriveRenderPlan(
    input: StructureCardRenderPlanInput,
  ): StructureCardRenderPlanItem[] {
    const cardsById = new Map<string, StructureCardState>();
    for (const card of input.cards) {
      cardsById.set(card.id, card);
    }

    return input.registeredIds.map((id) => {
      const card = cardsById.get(id);
      if (card === undefined || !card.visible) {
        return {
          id,
          visible: false,
          variant: card?.variant ?? 'pinned',
          placement: null,
        };
      }

      const size = input.sizesById[id];
      if (size === undefined) {
        return {
          id,
          visible: false,
          variant: card.variant,
          placement: null,
        };
      }

      return {
        id,
        visible: true,
        variant: card.variant,
        placement: StructureCardOverlayLayer.computePlacement({
          structureBounds: card.structureBounds,
          camera: input.camera,
          cellSize: input.cellSize,
          viewportWidth: input.viewportWidth,
          viewportHeight: input.viewportHeight,
          cardWidth: size.width,
          cardHeight: size.height,
          marginPx: input.marginPx,
          gapPx: input.gapPx,
        }),
      };
    });
  }

  public static computePlacement(
    input: StructureCardPlacementInput,
  ): StructureCardPlacement {
    const marginPx =
      input.marginPx === undefined
        ? DEFAULT_STRUCTURE_CARD_MARGIN_PX
        : Math.max(0, input.marginPx);
    const gapPx =
      input.gapPx === undefined
        ? DEFAULT_STRUCTURE_CARD_GAP_PX
        : Math.max(0, input.gapPx);

    const cardWidth = Math.max(0, input.cardWidth);
    const cardHeight = Math.max(0, input.cardHeight);
    const viewportWidth = Math.max(0, input.viewportWidth);
    const viewportHeight = Math.max(0, input.viewportHeight);

    const anchorScreenPoint = worldPointToScreen(input.camera, {
      x:
        (input.structureBounds.x + input.structureBounds.width / 2) *
        input.cellSize,
      y: input.structureBounds.y * input.cellSize,
    });

    const minLeft = marginPx;
    const maxLeft = Math.max(marginPx, viewportWidth - cardWidth - marginPx);
    const minTop = marginPx;
    const maxTop = Math.max(marginPx, viewportHeight - cardHeight - marginPx);

    const unclampedLeft = anchorScreenPoint.x - cardWidth / 2;
    const unclampedTop = anchorScreenPoint.y - cardHeight - gapPx;

    return {
      left: Math.round(clamp(unclampedLeft, minLeft, maxLeft)),
      top: Math.round(clamp(unclampedTop, minTop, maxTop)),
      anchorX: Math.round(
        clamp(anchorScreenPoint.x, minLeft, maxLeft + cardWidth),
      ),
      anchorY: Math.round(anchorScreenPoint.y),
    };
  }

  #measureCard(element: HTMLElement): StructureCardSize {
    const rect = element.getBoundingClientRect();
    const width = Math.max(rect.width, element.offsetWidth, 0);
    const height = Math.max(rect.height, element.offsetHeight, 0);
    return {
      width,
      height,
    };
  }

  #showCard(element: HTMLElement, variant: StructureCardVariant): void {
    element.classList.remove('is-hidden');
    element.classList.add('is-visible');
    element.setAttribute('aria-hidden', 'false');
    element.dataset.variant = variant;
    element.style.zIndex =
      variant === 'hover' ? HOVER_CARD_Z_INDEX : PINNED_CARD_Z_INDEX;
  }

  #hideCard(element: HTMLElement): void {
    element.classList.remove('is-visible');
    element.classList.add('is-hidden');
    element.setAttribute('aria-hidden', 'true');
  }
}
