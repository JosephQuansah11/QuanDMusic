/**
 * A tiny, dependency-free XML parser.
 *
 * MusicXML files are simple enough that a purpose-built reader is lighter and
 * more predictable than pulling a DOM implementation into the app (and it
 * works in Node during tests, where DOMParser does not exist).
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

export function parseXml(source: string): XmlNode {
  const cleaned = source
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let index = 0;

  while (index < cleaned.length) {
    const open = cleaned.indexOf('<', index);
    if (open === -1) {
      const tail = cleaned.slice(index).trim();
      if (tail) stack[stack.length - 1].text += decodeEntities(tail);
      break;
    }
    if (open > index) {
      const text = cleaned.slice(index, open);
      if (text.trim()) stack[stack.length - 1].text += decodeEntities(text.trim());
    }

    const close = cleaned.indexOf('>', open);
    if (close === -1) break;
    const raw = cleaned.slice(open + 1, close).trim();

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      // Pop until the matching element is found (tolerates minor malformation).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
    } else if (raw.endsWith('/')) {
      const body = raw.slice(0, -1).trim();
      const node = createNode(body);
      if (node) stack[stack.length - 1].children.push(node);
    } else {
      const node = createNode(raw);
      if (node) {
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      }
    }
    index = close + 1;
  }

  return root;
}

function createNode(body: string): XmlNode | null {
  const spaceMatch = /^([^\s/>]+)/.exec(body);
  if (!spaceMatch) return null;
  const name = spaceMatch[1];
  const attrs: Record<string, string> = {};
  const attrRegex = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(body)) !== null) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return { name, attrs, children: [], text: '' };
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name);
}

export function childText(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const child = firstChild(node, name);
  return child ? child.text.trim() : undefined;
}

/** Depth-first search for the first descendant with the given name. */
export function findFirst(node: XmlNode, name: string): XmlNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findFirst(child, name);
    if (found) return found;
  }
  return undefined;
}

export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  if (node.name === name) out.push(node);
  for (const child of node.children) out.push(...findAll(child, name));
  return out;
}
