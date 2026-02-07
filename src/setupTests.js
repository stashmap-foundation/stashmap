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
/* eslint-enable functional/immutable-data */

/* eslint-disable no-console */
const originalError = console.error.bind(console.error);
const originalWarn = console.warn.bind(console.warn);
// NostrQueryProvider has side effects which will lead to
// An update to NostrQueryProvider inside a test... errors
beforeAll(() => {
  // eslint-disable-next-line functional/immutable-data
  console.error = (msg, params) => {
    if (
      !(
        (msg.toString().includes("An update to %s inside a test") &&
          (params === "NostrQueryProvider" || params === "Data")) ||
        params === "Transition" ||
        params === "DropdownMenu" ||
        params === "TreeViewNodeLoader"
      ) &&
      !msg.toString().includes("Not implemented: navigation")
    ) {
      originalError(msg, params);
    }
  };
  // eslint-disable-next-line functional/immutable-data
  console.warn = (msg, params) => {
    if (!msg.toString().includes("@hello-pangea/dnd")) {
      originalWarn(msg, params);
    }
  };
});

afterAll(() => {
  // eslint-disable-next-line functional/immutable-data
  console.error = originalError;
  // eslint-disable-next-line functional/immutable-data
  console.warn = originalWarn;
});
/* eslint-enable no-console */

afterEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
});
