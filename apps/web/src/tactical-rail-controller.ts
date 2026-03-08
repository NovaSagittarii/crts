import type { LayoutMatchScreen } from './ingame-layout-controller.js';

export type TacticalRailSectionId = 'economy' | 'build' | 'team';
export type TacticalRailMode = 'expanded' | 'compact' | 'minimized';

export interface TacticalRailControllerElements {
  railEl: HTMLElement;
  compactButtonEl: HTMLButtonElement;
  minimizeButtonEl: HTMLButtonElement;
}

export class TacticalRailController {
  readonly #railEl: HTMLElement;
  readonly #compactButtonEl: HTMLButtonElement;
  readonly #minimizeButtonEl: HTMLButtonElement;

  #screen: LayoutMatchScreen = 'lobby';
  #mode: TacticalRailMode = 'expanded';
  #activeSection: TacticalRailSectionId = 'economy';

  constructor(elements: TacticalRailControllerElements) {
    this.#railEl = elements.railEl;
    this.#compactButtonEl = elements.compactButtonEl;
    this.#minimizeButtonEl = elements.minimizeButtonEl;
    this.#apply();
  }

  syncScreen(screen: LayoutMatchScreen): void {
    this.#screen = screen;
    if (screen !== 'ingame') {
      this.#mode = 'expanded';
    }
    this.#apply();
  }

  setActiveSection(sectionId: TacticalRailSectionId): void {
    if (this.#activeSection === sectionId) {
      return;
    }
    this.#activeSection = sectionId;
    this.#applySectionState();
  }

  toggleCompact(): void {
    if (this.#screen !== 'ingame' || this.#mode === 'minimized') {
      return;
    }
    this.#mode = this.#mode === 'compact' ? 'expanded' : 'compact';
    this.#apply();
  }

  toggleMinimized(): void {
    if (this.#screen !== 'ingame') {
      return;
    }
    this.#mode = this.#mode === 'minimized' ? 'expanded' : 'minimized';
    this.#apply();
  }

  reset(): void {
    this.#mode = 'expanded';
    this.#activeSection = 'economy';
    this.#apply();
  }

  #apply(): void {
    const compact = this.#mode === 'compact';
    const minimized = this.#mode === 'minimized';
    const inGame = this.#screen === 'ingame';

    this.#railEl.classList.toggle('tactical-rail--compact', compact);
    this.#railEl.classList.toggle('tactical-rail--minimized', minimized);
    this.#railEl.dataset.overlayMode = this.#mode;

    this.#compactButtonEl.hidden = !inGame;
    this.#minimizeButtonEl.hidden = !inGame;
    this.#compactButtonEl.disabled = minimized;

    this.#compactButtonEl.setAttribute(
      'aria-pressed',
      compact ? 'true' : 'false',
    );
    this.#minimizeButtonEl.setAttribute(
      'aria-pressed',
      minimized ? 'true' : 'false',
    );

    this.#compactButtonEl.textContent = compact
      ? 'Expanded view'
      : 'Compact view';
    this.#minimizeButtonEl.textContent = minimized
      ? 'Show overlay'
      : 'Minimize';

    this.#applySectionState();
  }

  #applySectionState(): void {
    this.#railEl.dataset.activeSection = this.#activeSection;
  }
}
