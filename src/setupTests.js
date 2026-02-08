import { Buffer } from "buffer";
import crypto from "crypto";
import { TextEncoder, TextDecoder } from "util";

// Not a typescript file so disable typescript linting rules
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/* eslint-disable functional/immutable-data */
global.crypto.subtle = crypto.webcrypto.subtle;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.Buffer = Buffer;
global.ResizeObserver = function ResizeObserver() { };
global.ResizeObserver.prototype.observe = () => { };
global.ResizeObserver.prototype.unobserve = () => { };
global.ResizeObserver.prototype.disconnect = () => { };
Element.prototype.scrollIntoView = () => { };
/* eslint-enable functional/immutable-data */

afterEach(() => {
    localStorage.clear();
    window.history.pushState({}, "", "/");
});
