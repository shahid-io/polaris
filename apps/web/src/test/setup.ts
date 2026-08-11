import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * jsdom shims for Radix and cmdk.
 *
 * Both are built for real browsers and reach for APIs jsdom does not implement. Without
 * these the popover and combobox throw on mount, and the failure looks like a component
 * bug rather than a missing environment feature — so they are stubbed once here rather
 * than worked around in each test.
 */

// Radix measures its trigger to size and position floating content.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Radix reads prefers-reduced-motion and viewport queries.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof globalThis.matchMedia;

// cmdk scrolls the highlighted item into view as the user types.
Element.prototype.scrollIntoView ??= () => {};

// Radix uses pointer capture for outside-click and drag handling.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
