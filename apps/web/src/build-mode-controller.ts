import type { BuildPlacementSelection } from './build-queue-view-model.js';

export interface BuildModeTemplate {
  id: string;
  width: number;
  height: number;
}

export interface BuildModeCell {
  x: number;
  y: number;
}

export interface CandidateUpdateResult {
  changed: boolean;
  placement: BuildPlacementSelection | null;
}

export class BuildModeController {
  #active = false;
  #lastHoveredCell: BuildModeCell | null = null;
  #candidatePlacement: BuildPlacementSelection | null = null;

  public get active(): boolean {
    return this.#active;
  }

  public get lastHoveredCell(): BuildModeCell | null {
    return this.#lastHoveredCell;
  }

  public get candidatePlacement(): BuildPlacementSelection | null {
    return this.#candidatePlacement;
  }

  public activate(): void {
    this.#active = true;
  }

  public deactivate(): void {
    this.#active = false;
    this.#candidatePlacement = null;
  }

  public recordHover(cell: BuildModeCell | null): void {
    this.#lastHoveredCell = cell;
  }

  public clearCandidate(): boolean {
    if (this.#candidatePlacement === null) {
      return false;
    }

    this.#candidatePlacement = null;
    return true;
  }

  public updateCandidateForCell(
    template: BuildModeTemplate,
    cell: BuildModeCell,
  ): CandidateUpdateResult {
    this.recordHover(cell);
    return this.updateCandidateFromHover(template);
  }

  public updateCandidateFromHover(
    template: BuildModeTemplate,
  ): CandidateUpdateResult {
    if (!this.#active || this.#lastHoveredCell === null) {
      return {
        changed: false,
        placement: this.#candidatePlacement,
      };
    }

    const placement: BuildPlacementSelection = {
      templateId: template.id,
      x: this.#lastHoveredCell.x - Math.floor(template.width / 2),
      y: this.#lastHoveredCell.y - Math.floor(template.height / 2),
    };

    if (
      this.#candidatePlacement &&
      this.#candidatePlacement.templateId === placement.templateId &&
      this.#candidatePlacement.x === placement.x &&
      this.#candidatePlacement.y === placement.y
    ) {
      return {
        changed: false,
        placement: this.#candidatePlacement,
      };
    }

    this.#candidatePlacement = placement;
    return {
      changed: true,
      placement,
    };
  }
}
