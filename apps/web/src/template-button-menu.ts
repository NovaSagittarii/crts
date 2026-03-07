export interface TemplateButtonMenuTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  activationCost: number;
}

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

export class TemplateButtonMenuElement {
  readonly #container: HTMLElement;
  readonly #onTemplateSelected: (templateId: string) => void;

  public constructor(
    container: HTMLElement,
    onTemplateSelected: (templateId: string) => void,
  ) {
    this.#container = container;
    this.#onTemplateSelected = onTemplateSelected;
  }

  public update(state: TemplateButtonMenuState): void {
    const buttonStates = TemplateButtonMenuElement.deriveButtonStates(state);
    this.#container.replaceChildren();

    if (buttonStates.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'template-button-menu__empty';
      empty.textContent = 'No templates available.';
      this.#container.append(empty);
      return;
    }

    for (const buttonState of buttonStates) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-button-menu__button';
      button.dataset.templateId = buttonState.templateId;
      button.textContent = buttonState.label;
      button.disabled = buttonState.disabled;
      button.classList.toggle(
        'template-button-menu__button--active',
        buttonState.highlighted,
      );
      button.addEventListener('click', () => {
        this.#onTemplateSelected(buttonState.templateId);
      });
      this.#container.append(button);
    }
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
}
