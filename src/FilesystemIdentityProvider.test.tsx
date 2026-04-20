import React from "react";
import { render } from "@testing-library/react";
import { FilesystemIdentityProvider } from "./FilesystemIdentityProvider";
import { useLogin, useLogout, useUser } from "./NostrAuthContext";
import {
  resetFilesystemBootstrapForTest,
  setFilesystemBootstrapForTest,
} from "./filesystemBootstrap";

const TEST_PUBKEY = "a".repeat(64) as unknown as PublicKey;

function CaptureUser({
  capture,
}: {
  capture: (user: User | undefined) => void;
}): JSX.Element {
  capture(useUser());
  return <div />;
}

function CaptureLogin({
  capture,
}: {
  capture: (fn: ((privateKey: string) => User) | undefined) => void;
}): JSX.Element {
  capture(useLogin());
  return <div />;
}

function CaptureLogout({
  capture,
}: {
  capture: (fn: (() => Promise<void>) | undefined) => void;
}): JSX.Element {
  capture(useLogout());
  return <div />;
}

afterEach(() => {
  resetFilesystemBootstrapForTest();
});

test("FilesystemIdentityProvider exposes the stashed pubkey as the current user", () => {
  setFilesystemBootstrapForTest(TEST_PUBKEY);
  // eslint-disable-next-line functional/no-let
  let captured: User | undefined;
  render(
    <FilesystemIdentityProvider>
      <CaptureUser
        capture={(u) => {
          captured = u;
        }}
      />
    </FilesystemIdentityProvider>
  );
  expect(captured).toEqual({ publicKey: TEST_PUBKEY });
});

test("FilesystemIdentityProvider does not expose a login function", () => {
  setFilesystemBootstrapForTest(TEST_PUBKEY);
  // eslint-disable-next-line functional/no-let
  let login: ((privateKey: string) => User) | undefined;
  render(
    <FilesystemIdentityProvider>
      <CaptureLogin
        capture={(fn) => {
          login = fn;
        }}
      />
    </FilesystemIdentityProvider>
  );
  expect(login).toBeUndefined();
});

test("FilesystemIdentityProvider does not expose a logout function", () => {
  setFilesystemBootstrapForTest(TEST_PUBKEY);
  // eslint-disable-next-line functional/no-let
  let logout: (() => Promise<void>) | undefined;
  render(
    <FilesystemIdentityProvider>
      <CaptureLogout
        capture={(fn) => {
          logout = fn;
        }}
      />
    </FilesystemIdentityProvider>
  );
  expect(logout).toBeUndefined();
});
