// A minimal document for view checks. Reserved path. A view may use only what this supports:
// createElement, createElementNS, createTextNode; and on an element appendChild, append,
// replaceChildren, setAttribute, getAttribute, textContent, className, classList, dataset, style.

export class FakeText {
  readonly nodeType = 3;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
}

type Child = FakeElement | FakeText;

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export class FakeElement {
  readonly nodeType = 1;
  readonly attributes = new Map<string, string>();
  readonly children: Child[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string>;
  readonly classList = {
    add: (...names: string[]) => this.setAttribute("class", [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" ")),
    remove: (...names: string[]) => this.setAttribute("class", this.className.split(" ").filter((n) => !names.includes(n)).join(" ")),
  };

  constructor(readonly tagName: string) {
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (_t, key, value) => {
        this.setAttribute(`data-${kebab(String(key))}`, String(value));
        return true;
      },
      get: (_t, key) => this.getAttribute(`data-${kebab(String(key))}`) ?? undefined,
    });
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  set className(v: string) {
    this.setAttribute("class", v);
  }
  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  appendChild<T extends Child>(child: T): T {
    this.children.push(child);
    return child;
  }
  append(...nodes: (Child | string)[]): void {
    for (const n of nodes) this.children.push(typeof n === "string" ? new FakeText(n) : n);
  }
  replaceChildren(...nodes: (Child | string)[]): void {
    this.children.length = 0;
    this.append(...nodes);
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.replaceChildren(String(v));
  }
}

export const fakeDocument = {
  createElement: (tag: string) => new FakeElement(tag),
  createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  createTextNode: (data: string) => new FakeText(String(data)),
};

// Every element under root, depth first, root included.
export function all(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [root];
  for (const c of root.children) if (c instanceof FakeElement) out.push(...all(c));
  return out;
}

export function withAttr(root: FakeElement, name: string): FakeElement[] {
  return all(root).filter((e) => e.getAttribute(name) !== null);
}

// A view renders data only. It must not fetch, evaluate code, or write HTML strings.
const BANNED = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "Function(", "fetch(", "import(", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage", "setTimeout(", "setInterval(", "<script"];

export function bannedTokens(source: string): string[] {
  return BANNED.filter((b) => source.includes(b));
}
