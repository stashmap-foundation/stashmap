import { Buffer } from "buffer";
import crypto from "crypto";
import { TextEncoder, TextDecoder } from "util";
import { ReadableStream, TransformStream, WritableStream } from "stream/web";
import consumers from "stream/consumers";
// eslint-disable-next-line import/no-extraneous-dependencies
import { cleanup } from "@testing-library/react";
import { suggestionSettings } from "./core/constants";

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
// age-encryption drives its cipher through Web Streams and collects the
// output via Response, both absent in jsdom.
if (!global.TransformStream) {
  global.TransformStream = TransformStream;
  global.ReadableStream = ReadableStream;
  global.WritableStream = WritableStream;
}
if (!global.Response) {
  global.Response = function Response(body) {
    return {
      body,
      arrayBuffer: () => consumers.arrayBuffer(body),
      text: () => consumers.text(body),
    };
  };
}
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
  cleanup();
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  if (typeof window !== "undefined") {
    window.history.pushState({}, "", "/");
  }
});
