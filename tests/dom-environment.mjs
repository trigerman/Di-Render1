import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html>');
for (const name of ['document', 'DOMParser', 'XMLSerializer', 'NodeFilter', 'DocumentFragment',
  'Element', 'HTMLFormElement', 'HTMLTemplateElement', 'NamedNodeMap', 'Node'])
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
