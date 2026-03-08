import { describe, expect, it } from 'vitest';

import { ChatDrawerController } from '../../apps/web/src/chat-drawer-controller.js';

interface FakeElementHandle<T extends HTMLElement> {
  element: T;
  classNames: Set<string>;
  attributes: Map<string, string>;
}

function createFakeElement<T extends HTMLElement>(
  initialClasses: readonly string[] = [],
): FakeElementHandle<T> {
  const classNames = new Set<string>(initialClasses);
  const attributes = new Map<string, string>();

  const element = {
    classList: {
      add: (...tokens: string[]) => {
        for (const token of tokens) {
          classNames.add(token);
        }
      },
      remove: (...tokens: string[]) => {
        for (const token of tokens) {
          classNames.delete(token);
        }
      },
      contains: (token: string) => classNames.has(token),
      toggle: (token: string, force?: boolean) => {
        if (force === undefined) {
          if (classNames.has(token)) {
            classNames.delete(token);
            return false;
          }
          classNames.add(token);
          return true;
        }

        if (force) {
          classNames.add(token);
          return true;
        }

        classNames.delete(token);
        return false;
      },
    },
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hidden: false,
    disabled: false,
    textContent: '',
  } as unknown as T;

  return {
    element,
    classNames,
    attributes,
  };
}

function createFixture() {
  const chatShell = createFakeElement<HTMLElement>();
  const toggleButton = createFakeElement<HTMLButtonElement>();
  const closeButton = createFakeElement<HTMLButtonElement>();
  const unreadBadge = createFakeElement<HTMLElement>(['is-hidden']);

  return {
    chatShell,
    toggleButton,
    closeButton,
    unreadBadge,
    controller: new ChatDrawerController({
      chatShellEl: chatShell.element,
      toggleButtonEl: toggleButton.element,
      closeButtonEl: closeButton.element,
      unreadBadgeEl: unreadBadge.element,
    }),
  };
}

describe('chat drawer controller', () => {
  it('enters drawer mode during ingame screen and keeps drawer closed by default', () => {
    const { chatShell, toggleButton, controller } = createFixture();

    controller.syncScreen('ingame');

    expect(chatShell.classNames.has('chat-shell--drawer-mode')).toBe(true);
    expect(chatShell.classNames.has('chat-shell--drawer-open')).toBe(false);
    expect(chatShell.attributes.get('aria-hidden')).toBe('true');
    expect(toggleButton.element.hidden).toBe(false);
    expect(toggleButton.attributes.get('aria-expanded')).toBe('false');
  });

  it('opens and closes the drawer while emitting open-state callbacks', () => {
    const chatShell = createFakeElement<HTMLElement>();
    const toggleButton = createFakeElement<HTMLButtonElement>();
    const closeButton = createFakeElement<HTMLButtonElement>();
    const unreadBadge = createFakeElement<HTMLElement>(['is-hidden']);
    const openStates: boolean[] = [];
    const controller = new ChatDrawerController(
      {
        chatShellEl: chatShell.element,
        toggleButtonEl: toggleButton.element,
        closeButtonEl: closeButton.element,
        unreadBadgeEl: unreadBadge.element,
      },
      {
        onOpenChanged: (isOpen) => {
          openStates.push(isOpen);
        },
      },
    );

    controller.syncScreen('ingame');
    controller.open();
    controller.close();

    expect(openStates).toEqual([true, false]);
    expect(chatShell.classNames.has('chat-shell--drawer-open')).toBe(false);
    expect(chatShell.attributes.get('aria-hidden')).toBe('true');
    expect(toggleButton.attributes.get('aria-expanded')).toBe('false');
  });

  it('tracks unread count only for non-self messages while drawer is closed', () => {
    const { unreadBadge, controller } = createFixture();

    controller.syncScreen('ingame');
    controller.notifyIncomingMessage(false);
    controller.notifyIncomingMessage(true);

    expect(unreadBadge.classNames.has('is-hidden')).toBe(false);
    expect(unreadBadge.element.textContent).toBe('1');

    controller.open();

    expect(unreadBadge.classNames.has('is-hidden')).toBe(true);
    expect(unreadBadge.element.textContent).toBe('0');
  });

  it('caps unread badge value and clears drawer state on room reset', () => {
    const { chatShell, unreadBadge, controller } = createFixture();

    controller.syncScreen('ingame');
    for (let index = 0; index < 120; index += 1) {
      controller.notifyIncomingMessage(false);
    }

    expect(unreadBadge.element.textContent).toBe('99');

    controller.open();
    controller.resetRoom();

    expect(chatShell.classNames.has('chat-shell--drawer-open')).toBe(false);
    expect(unreadBadge.classNames.has('is-hidden')).toBe(true);
    expect(unreadBadge.element.textContent).toBe('0');
  });
});
