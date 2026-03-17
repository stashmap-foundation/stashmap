import { render, screen } from "@testing-library/react";
import React from "react";
import { Route, Routes, BrowserRouter } from "react-router-dom";
import { getPublicKey, nip19 } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import * as nip06 from "nostr-tools/nip06";
import { hexToBytes } from "@noble/hashes/utils";
import { SignUp } from "./SignUp";

test("create nostr login data", () => {
  // eslint-disable-next-line functional/immutable-data
  Object.defineProperty(document, "referrer", {
    writable: true,
    value: "http://localhost/signin",
  });
  render(
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SignUp />} />
      </Routes>
    </BrowserRouter>
  );
  /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
  const mnemonic = (screen.getByLabelText("Mnemonic") as HTMLFormElement).value;
  const publicKey = (screen.getByLabelText("Public Key") as HTMLFormElement)
    .value;
  const privateKey = (screen.getByLabelText("Private Key") as HTMLFormElement)
    .value;
  /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */

  const privateKeyFromMnemonic = hexToBytes(
    nip06.privateKeyFromSeedWords(mnemonic)
  );

  expect(privateKey).toEqual(nip19.nsecEncode(privateKeyFromMnemonic));
  expect(publicKey).toEqual(
    nip19.npubEncode(getPublicKey(privateKeyFromMnemonic))
  );
});
