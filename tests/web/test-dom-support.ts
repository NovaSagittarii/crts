export interface FakeElementHandle<T extends HTMLElement> {
  element: T;
  classNames: Set<string>;
  attributes: Map<string, string>;
  dataset: DOMStringMap;
  style: Record<string, string>;
}

interface FakeElementOptions {
  initialClasses?: readonly string[];
  width?: number;
  height?: number;
}

export function createFakeRootElement(): HTMLElement {
  return {
    append: () => undefined,
  } as unknown as HTMLElement;
}

export function createFakeElement<T extends HTMLElement>(
  options: FakeElementOptions = {},
): FakeElementHandle<T> {
  const classNames = new Set<string>(options.initialClasses ?? []);
  const attributes = new Map<string, string>();
  const dataset = {} as DOMStringMap;
  const style: Record<string, string> = {};
  const width = options.width ?? 0;
  const height = options.height ?? 0;

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
    getBoundingClientRect: () => ({
      width,
      height,
      left: 0,
      right: width,
      top: 0,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({ width, height }),
    }),
    offsetWidth: width,
    offsetHeight: height,
    hidden: false,
    disabled: false,
    textContent: '',
    dataset,
    style,
  } as unknown as T;

  return {
    element,
    classNames,
    attributes,
    dataset,
    style,
  };
}
