export type LayoutMatchScreen = 'lobby' | 'ingame';

export interface IngameLayoutControllerElements {
  bodyEl: HTMLElement;
}

export interface IngameLayoutControllerOptions {
  onModeChanged?: () => void;
}

const INGAME_CLASS_NAME = 'app--ingame';

export class IngameLayoutController {
  readonly #bodyEl: HTMLElement;
  readonly #onModeChanged: (() => void) | null;

  #isIngameMode = false;

  constructor(
    elements: IngameLayoutControllerElements,
    options: IngameLayoutControllerOptions = {},
  ) {
    this.#bodyEl = elements.bodyEl;
    this.#onModeChanged = options.onModeChanged ?? null;
    if (!this.#bodyEl.dataset.matchScreen) {
      this.#bodyEl.dataset.matchScreen = 'lobby';
    }
  }

  syncScreen(screen: LayoutMatchScreen): void {
    const nextIngameMode = screen === 'ingame';
    if (nextIngameMode === this.#isIngameMode) {
      return;
    }

    this.#isIngameMode = nextIngameMode;
    this.#bodyEl.classList.toggle(INGAME_CLASS_NAME, nextIngameMode);
    this.#bodyEl.dataset.matchScreen = screen;
    this.#onModeChanged?.();
  }

  reset(): void {
    if (!this.#isIngameMode) {
      return;
    }

    this.#isIngameMode = false;
    this.#bodyEl.classList.remove(INGAME_CLASS_NAME);
    this.#bodyEl.dataset.matchScreen = 'lobby';
    this.#onModeChanged?.();
  }
}
