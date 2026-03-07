import type { PendingBuildPayload } from '#rts-engine';

import { groupPendingByExecuteTick } from './economy-view-model.js';

export interface PendingTimelineInput {
  pendingBuilds: readonly PendingBuildPayload[];
  currentTick: number;
}

export interface PendingTimelineItemState {
  key: string;
  eventId: number;
  executeTick: number;
  name: string;
  meta: string;
}

export interface PendingTimelineGroupState {
  key: string;
  executeTick: number;
  title: string;
  items: PendingTimelineItemState[];
}

export interface PendingTimelineSnapshot {
  emptyCopy: string | null;
  groups: PendingTimelineGroupState[];
}

export type PendingTimelinePatchOperation =
  | {
      type: 'set-empty';
      show: boolean;
      copy: string;
    }
  | {
      type: 'insert-group';
      groupKey: string;
      at: number;
      group: PendingTimelineGroupState;
    }
  | {
      type: 'remove-group';
      groupKey: string;
    }
  | {
      type: 'update-group-title';
      groupKey: string;
      title: string;
    }
  | {
      type: 'insert-item';
      groupKey: string;
      itemKey: string;
      at: number;
      item: PendingTimelineItemState;
    }
  | {
      type: 'remove-item';
      groupKey: string;
      itemKey: string;
    }
  | {
      type: 'update-item';
      groupKey: string;
      itemKey: string;
      item: PendingTimelineItemState;
    };

export class PendingTimelineElement {
  readonly #container: HTMLElement;
  #snapshot: PendingTimelineSnapshot | null = null;
  #emptyEl: HTMLElement | null = null;
  readonly #groupEls = new Map<string, HTMLElement>();
  readonly #groupTitleEls = new Map<string, HTMLElement>();
  readonly #groupItemsEls = new Map<string, HTMLElement>();
  readonly #itemElsByGroup = new Map<string, Map<string, HTMLElement>>();

  public constructor(container: HTMLElement) {
    this.#container = container;
  }

  public update(input: PendingTimelineInput): void {
    const nextSnapshot = PendingTimelineElement.deriveSnapshot(input);
    const operations = PendingTimelineElement.diffSnapshots(
      this.#snapshot,
      nextSnapshot,
    );
    this.#applyOperations(operations);
    this.#snapshot = nextSnapshot;
  }

  public reset(): void {
    this.#snapshot = null;
    this.#emptyEl = null;
    this.#groupEls.clear();
    this.#groupTitleEls.clear();
    this.#groupItemsEls.clear();
    this.#itemElsByGroup.clear();
    this.#container.replaceChildren();
  }

  public static deriveSnapshot(
    input: PendingTimelineInput,
  ): PendingTimelineSnapshot {
    if (input.pendingBuilds.length === 0) {
      return {
        emptyCopy: 'No pending build events.',
        groups: [],
      };
    }

    const groups = groupPendingByExecuteTick(
      input.pendingBuilds,
      input.currentTick,
    ).map((group) => ({
      key: `tick:${group.executeTick}`,
      executeTick: group.executeTick,
      title: `Execute tick ${group.executeTick} (${group.etaLabel})`,
      items: group.items.map((item) => ({
        key: `event:${item.eventId}`,
        eventId: item.eventId,
        executeTick: item.executeTick,
        name: `${item.templateName} (#${item.eventId})`,
        meta: `tick ${item.executeTick} | at (${item.x}, ${item.y})`,
      })),
    }));

    return {
      emptyCopy: null,
      groups,
    };
  }

  public static diffSnapshots(
    previous: PendingTimelineSnapshot | null,
    next: PendingTimelineSnapshot,
  ): PendingTimelinePatchOperation[] {
    const previousSnapshot =
      previous ??
      ({ emptyCopy: null, groups: [] } satisfies PendingTimelineSnapshot);

    const operations: PendingTimelinePatchOperation[] = [];
    if (previousSnapshot.emptyCopy !== next.emptyCopy) {
      operations.push({
        type: 'set-empty',
        show: next.emptyCopy !== null,
        copy: next.emptyCopy ?? '',
      });
    }

    const previousGroupsByKey = new Map(
      previousSnapshot.groups.map((group) => [group.key, group] as const),
    );
    const nextGroupsByKey = new Map(
      next.groups.map((group) => [group.key, group] as const),
    );

    for (const group of previousSnapshot.groups) {
      if (!nextGroupsByKey.has(group.key)) {
        operations.push({
          type: 'remove-group',
          groupKey: group.key,
        });
      }
    }

    for (const [groupIndex, group] of next.groups.entries()) {
      const previousGroup = previousGroupsByKey.get(group.key);
      if (!previousGroup) {
        operations.push({
          type: 'insert-group',
          groupKey: group.key,
          at: groupIndex,
          group,
        });
        continue;
      }

      if (previousGroup.title !== group.title) {
        operations.push({
          type: 'update-group-title',
          groupKey: group.key,
          title: group.title,
        });
      }

      const previousItemsByKey = new Map(
        previousGroup.items.map((item) => [item.key, item] as const),
      );
      const nextItemsByKey = new Map(
        group.items.map((item) => [item.key, item] as const),
      );

      for (const previousItem of previousGroup.items) {
        if (!nextItemsByKey.has(previousItem.key)) {
          operations.push({
            type: 'remove-item',
            groupKey: group.key,
            itemKey: previousItem.key,
          });
        }
      }

      for (const [itemIndex, item] of group.items.entries()) {
        const previousItem = previousItemsByKey.get(item.key);
        if (!previousItem) {
          operations.push({
            type: 'insert-item',
            groupKey: group.key,
            itemKey: item.key,
            at: itemIndex,
            item,
          });
          continue;
        }

        if (
          previousItem.name !== item.name ||
          previousItem.meta !== item.meta
        ) {
          operations.push({
            type: 'update-item',
            groupKey: group.key,
            itemKey: item.key,
            item,
          });
        }
      }
    }

    return operations;
  }

  #applyOperations(operations: readonly PendingTimelinePatchOperation[]): void {
    for (const operation of operations) {
      switch (operation.type) {
        case 'set-empty': {
          if (!operation.show) {
            this.#emptyEl?.remove();
            break;
          }

          if (!this.#emptyEl) {
            this.#emptyEl = document.createElement('div');
            this.#emptyEl.className = 'pending-item';
          }
          this.#emptyEl.textContent = operation.copy;
          this.#container.append(this.#emptyEl);
          break;
        }
        case 'insert-group': {
          const groupEl = document.createElement('section');
          groupEl.className = 'pending-group';
          groupEl.dataset.groupKey = operation.groupKey;

          const titleEl = document.createElement('p');
          titleEl.className = 'pending-group__title';
          titleEl.textContent = operation.group.title;
          groupEl.append(titleEl);

          const itemsEl = document.createElement('div');
          itemsEl.className = 'pending-group__items';
          groupEl.append(itemsEl);

          const itemEls = new Map<string, HTMLElement>();
          for (const item of operation.group.items) {
            const itemEl = this.#createItemElement(item);
            itemEls.set(item.key, itemEl);
            itemsEl.append(itemEl);
          }

          const existingGroups = [...this.#groupEls.values()];
          const before = existingGroups[operation.at] ?? null;
          this.#container.insertBefore(groupEl, before);
          this.#groupEls.set(operation.groupKey, groupEl);
          this.#groupTitleEls.set(operation.groupKey, titleEl);
          this.#groupItemsEls.set(operation.groupKey, itemsEl);
          this.#itemElsByGroup.set(operation.groupKey, itemEls);
          break;
        }
        case 'remove-group': {
          this.#groupEls.get(operation.groupKey)?.remove();
          this.#groupEls.delete(operation.groupKey);
          this.#groupTitleEls.delete(operation.groupKey);
          this.#groupItemsEls.delete(operation.groupKey);
          this.#itemElsByGroup.delete(operation.groupKey);
          break;
        }
        case 'update-group-title': {
          const titleEl = this.#groupTitleEls.get(operation.groupKey);
          if (titleEl) {
            titleEl.textContent = operation.title;
          }
          break;
        }
        case 'remove-item': {
          const itemEls = this.#itemElsByGroup.get(operation.groupKey);
          const itemEl = itemEls?.get(operation.itemKey);
          itemEl?.remove();
          itemEls?.delete(operation.itemKey);
          break;
        }
        case 'insert-item': {
          const itemsEl = this.#groupItemsEls.get(operation.groupKey);
          const itemEls = this.#itemElsByGroup.get(operation.groupKey);
          if (!itemsEl || !itemEls) {
            break;
          }

          const itemEl = this.#createItemElement(operation.item);
          const existingItems = [...itemEls.values()];
          const before = existingItems[operation.at] ?? null;
          itemsEl.insertBefore(itemEl, before);
          itemEls.set(operation.itemKey, itemEl);
          break;
        }
        case 'update-item': {
          const itemEls = this.#itemElsByGroup.get(operation.groupKey);
          const itemEl = itemEls?.get(operation.itemKey);
          if (!itemEl) {
            break;
          }

          const nameEl = itemEl.querySelector('.pending-item__name');
          const metaEl = itemEl.querySelector('.pending-item__meta');
          if (nameEl) {
            nameEl.textContent = operation.item.name;
          }
          if (metaEl) {
            metaEl.textContent = operation.item.meta;
          }
          break;
        }
      }
    }
  }

  #createItemElement(item: PendingTimelineItemState): HTMLElement {
    const itemEl = document.createElement('article');
    itemEl.className = 'pending-item';
    itemEl.dataset.itemKey = item.key;

    const nameEl = document.createElement('p');
    nameEl.className = 'pending-item__name';
    nameEl.textContent = item.name;
    itemEl.append(nameEl);

    const metaEl = document.createElement('p');
    metaEl.className = 'pending-item__meta';
    metaEl.textContent = item.meta;
    itemEl.append(metaEl);

    return itemEl;
  }
}
