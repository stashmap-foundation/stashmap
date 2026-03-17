import { Buffer } from "buffer";
import crypto from "crypto";
import { TextEncoder, TextDecoder } from "util";
import { suggestionSettings } from "./rows/settings";

// Not a typescript file so disable typescript linting rules
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/* eslint-disable functional/immutable-data */
if (!global.crypto) {
  global.crypto = crypto.webcrypto;
} else if (!global.crypto.subtle) {
  Object.defineProperty(global.crypto, "subtle", {
    configurable: true,
    value: crypto.webcrypto.subtle,
  });
}
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.Buffer = Buffer;
global.ResizeObserver = function ResizeObserver() {};
global.ResizeObserver.prototype.observe = () => {};
global.ResizeObserver.prototype.unobserve = () => {};
global.ResizeObserver.prototype.disconnect = () => {};
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}
suggestionSettings.maxSuggestions = 3;
/* eslint-enable functional/immutable-data */

afterEach(() => {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  if (typeof window !== "undefined") {
    window.history.pushState({}, "", "/");
  }
});
