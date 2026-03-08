import type { LayoutMatchScreen } from './ingame-layout-controller.js';

export interface ChatDrawerControllerElements {
  chatShellEl: HTMLElement;
  toggleButtonEl: HTMLButtonElement;
  closeButtonEl: HTMLButtonElement;
  unreadBadgeEl: HTMLElement;
}

export interface ChatDrawerControllerOptions {
  onOpenChanged?: (isOpen: boolean) => void;
}

export class ChatDrawerController {
  readonly #chatShellEl: HTMLElement;
  readonly #toggleButtonEl: HTMLButtonElement;
  readonly #closeButtonEl: HTMLButtonElement;
  readonly #unreadBadgeEl: HTMLElement;
  readonly #onOpenChanged: ((isOpen: boolean) => void) | null;

  #isIngame = false;
  #isOpen = false;
  #unreadCount = 0;

  constructor(
    elements: ChatDrawerControllerElements,
    options: ChatDrawerControllerOptions = {},
  ) {
    this.#chatShellEl = elements.chatShellEl;
    this.#toggleButtonEl = elements.toggleButtonEl;
    this.#closeButtonEl = elements.closeButtonEl;
    this.#unreadBadgeEl = elements.unreadBadgeEl;
    this.#onOpenChanged = options.onOpenChanged ?? null;
    this.#apply();
  }

  syncScreen(screen: LayoutMatchScreen): void {
    this.#isIngame = screen === 'ingame';
    if (!this.#isIngame) {
      this.#isOpen = false;
      this.#unreadCount = 0;
    }
    this.#apply();
  }

  open(): void {
    if (!this.#isIngame || this.#isOpen) {
      return;
    }
    this.#isOpen = true;
    this.#unreadCount = 0;
    this.#apply();
    this.#onOpenChanged?.(true);
  }

  close(): void {
    if (!this.#isOpen) {
      return;
    }
    this.#isOpen = false;
    this.#apply();
    this.#onOpenChanged?.(false);
  }

  toggle(): void {
    if (this.#isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  notifyIncomingMessage(fromSelf: boolean): void {
    if (fromSelf || !this.#isIngame || this.#isOpen) {
      return;
    }
    this.#unreadCount = Math.min(this.#unreadCount + 1, 99);
    this.#applyUnreadBadge();
  }

  resetRoom(): void {
    this.#isOpen = false;
    this.#unreadCount = 0;
    this.#apply();
  }

  #apply(): void {
    const drawerMode = this.#isIngame;
    const drawerOpen = drawerMode && this.#isOpen;
    const chatVisible = !drawerMode || drawerOpen;

    this.#chatShellEl.classList.toggle('chat-shell--drawer-mode', drawerMode);
    this.#chatShellEl.classList.toggle('chat-shell--drawer-open', drawerOpen);
    this.#chatShellEl.setAttribute(
      'aria-hidden',
      chatVisible ? 'false' : 'true',
    );

    this.#toggleButtonEl.hidden = !drawerMode;
    this.#toggleButtonEl.setAttribute(
      'aria-expanded',
      drawerOpen ? 'true' : 'false',
    );
    this.#toggleButtonEl.classList.toggle('camera-action--active', drawerOpen);

    this.#closeButtonEl.hidden = !drawerMode;
    this.#closeButtonEl.disabled = !drawerOpen;

    this.#applyUnreadBadge();
  }

  #applyUnreadBadge(): void {
    const shouldShow = this.#isIngame && !this.#isOpen && this.#unreadCount > 0;
    this.#unreadBadgeEl.classList.toggle('is-hidden', !shouldShow);
    this.#unreadBadgeEl.textContent = shouldShow
      ? String(this.#unreadCount)
      : '0';
  }
}
