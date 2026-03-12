/// <reference lib="dom" />
import type { StructureTemplateSummary } from '#rts-engine';

export type TemplateButtonMenuTemplate = Pick<
  StructureTemplateSummary,
  'id' | 'name' | 'width' | 'height' | 'activationCost'
>;

export interface TemplateButtonMenuState {
  templates: readonly TemplateButtonMenuTemplate[];
  selectedTemplateId: string | null;
  buildModeActive: boolean;
  enabled: boolean;
}

export interface TemplateButtonState {
  templateId: string;
  label: string;
  highlighted: boolean;
  disabled: boolean;
}

export type TemplateButtonChange = 'label' | 'highlighted' | 'disabled';

export type TemplateButtonPatchOperation =
  | {
      type: 'insert';
      templateId: string;
      at: number;
      next: TemplateButtonState;
    }
  | {
      type: 'remove';
      templateId: string;
    }
  | {
      type: 'update';
      templateId: string;
      changes: readonly TemplateButtonChange[];
      next: TemplateButtonState;
    };

export class TemplateButtonMenuElement {
  readonly #container: HTMLElement;
  readonly #onTemplateSelected: (templateId: string) => void;
  #buttonStates: TemplateButtonState[] = [];
  readonly #buttonByTemplateId = new Map<string, HTMLButtonElement>();
  #emptyStateEl: HTMLParagraphElement | null = null;

  public constructor(
    container: HTMLElement,
    onTemplateSelected: (templateId: string) => void,
  ) {
    this.#container = container;
    this.#onTemplateSelected = onTemplateSelected;
  }

  public update(state: TemplateButtonMenuState): void {
    const nextStates = TemplateButtonMenuElement.deriveButtonStates(state);

    if (nextStates.length === 0) {
      for (const [templateId, button] of this.#buttonByTemplateId) {
        button.remove();
        this.#buttonByTemplateId.delete(templateId);
      }
      if (!this.#emptyStateEl) {
        this.#emptyStateEl = document.createElement('p');
        this.#emptyStateEl.className = 'template-button-menu__empty';
      }
      this.#emptyStateEl.textContent = 'No templates available.';
      this.#container.replaceChildren(this.#emptyStateEl);
      this.#buttonStates = [];
      return;
    }

    this.#emptyStateEl?.remove();

    const patchOperations = TemplateButtonMenuElement.diffButtonStates(
      this.#buttonStates,
      nextStates,
    );

    for (const operation of patchOperations) {
      switch (operation.type) {
        case 'remove': {
          const button = this.#buttonByTemplateId.get(operation.templateId);
          if (!button) {
            break;
          }
          button.remove();
          this.#buttonByTemplateId.delete(operation.templateId);
          break;
        }
        case 'insert': {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'template-button-menu__button';
          button.dataset.templateId = operation.templateId;
          button.addEventListener('click', () => {
            this.#onTemplateSelected(operation.templateId);
          });
          this.#buttonByTemplateId.set(operation.templateId, button);
          this.#applyButtonState(button, operation.next);
          const beforeEl = this.#container.children.item(operation.at);
          this.#container.insertBefore(button, beforeEl);
          break;
        }
        case 'update': {
          const button = this.#buttonByTemplateId.get(operation.templateId);
          if (!button) {
            break;
          }
          this.#applyButtonState(button, operation.next);
          break;
        }
      }
    }

    this.#buttonStates = [...nextStates];
  }

  #applyButtonState(
    button: HTMLButtonElement,
    state: TemplateButtonState,
  ): void {
    button.textContent = state.label;
    button.disabled = state.disabled;
    button.classList.toggle(
      'template-button-menu__button--active',
      state.highlighted,
    );
  }

  public static deriveButtonStates(
    state: TemplateButtonMenuState,
  ): TemplateButtonState[] {
    return state.templates.map((template) => ({
      templateId: template.id,
      label: `${template.name} (${template.width}x${template.height}) | base ${template.activationCost}`,
      highlighted:
        state.buildModeActive && state.selectedTemplateId === template.id,
      disabled: !state.enabled,
    }));
  }

  public static diffButtonStates(
    previous: readonly TemplateButtonState[],
    next: readonly TemplateButtonState[],
  ): TemplateButtonPatchOperation[] {
    const previousByTemplateId = new Map(
      previous.map((state) => [state.templateId, state] as const),
    );
    const nextByTemplateId = new Map(
      next.map((state) => [state.templateId, state] as const),
    );
    const previousIndexByTemplateId = new Map(
      previous.map((state, index) => [state.templateId, index] as const),
    );

    const operations: TemplateButtonPatchOperation[] = [];

    for (const previousState of previous) {
      if (!nextByTemplateId.has(previousState.templateId)) {
        operations.push({
          type: 'remove',
          templateId: previousState.templateId,
        });
      }
    }

    for (const [index, nextState] of next.entries()) {
      const previousState = previousByTemplateId.get(nextState.templateId);
      if (!previousState) {
        operations.push({
          type: 'insert',
          templateId: nextState.templateId,
          at: index,
          next: nextState,
        });
        continue;
      }

      const previousIndex = previousIndexByTemplateId.get(nextState.templateId);
      if (previousIndex !== undefined && previousIndex !== index) {
        operations.push({
          type: 'remove',
          templateId: nextState.templateId,
        });
        operations.push({
          type: 'insert',
          templateId: nextState.templateId,
          at: index,
          next: nextState,
        });
        continue;
      }

      const changes: TemplateButtonChange[] = [];
      if (previousState.label !== nextState.label) {
        changes.push('label');
      }
      if (previousState.highlighted !== nextState.highlighted) {
        changes.push('highlighted');
      }
      if (previousState.disabled !== nextState.disabled) {
        changes.push('disabled');
      }
      if (changes.length > 0) {
        operations.push({
          type: 'update',
          templateId: nextState.templateId,
          changes,
          next: nextState,
        });
      }
    }

    return operations;
  }
}
