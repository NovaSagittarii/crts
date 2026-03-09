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
  #lastLobbyScrollTop = 0;

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

    if (nextIngameMode) {
      this.#lastLobbyScrollTop = Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
      );
      if (this.#lastLobbyScrollTop > 0) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        this.#bodyEl.scrollTop = 0;
      }
    }

    this.#isIngameMode = nextIngameMode;
    this.#bodyEl.classList.toggle(INGAME_CLASS_NAME, nextIngameMode);
    this.#bodyEl.dataset.matchScreen = screen;
    this.#onModeChanged?.();

    if (!nextIngameMode && this.#lastLobbyScrollTop > 0) {
      window.scrollTo(0, this.#lastLobbyScrollTop);
    }
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
