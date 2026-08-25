import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement ResizeObserver, which Radix primitives (Tooltip,
// Dialog, Sheet content sizing) touch as soon as they actually open.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom also lacks a real PointerEvent implementation; Radix's pointer-based
// interactions (hover-open on Tooltip, focus-trap boundary checks) expect
// `hasPointerCapture`/`releasePointerCapture` to exist on Element.
if (typeof Element.prototype.hasPointerCapture === "undefined") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.releasePointerCapture === "undefined") {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

// Without globals:true, RTL's automatic afterEach cleanup does not
// register itself -- do it explicitly so DOM state never leaks between
// tests within the same file.
afterEach(() => {
  cleanup();
});
