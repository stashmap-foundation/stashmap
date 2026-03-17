import { Map } from "immutable";

export type PublicKey = string & { readonly "": unique symbol };

export type KeyPair = {
  privateKey: Uint8Array;
  publicKey: PublicKey;
};

export type User =
  | KeyPair
  | {
      publicKey: PublicKey;
    };

export type Contact = {
  publicKey: PublicKey;
  mainRelay?: string;
  userName?: string;
};

export type HasPublicKey = {
  publicKey: PublicKey;
};

export type Contacts = Map<PublicKey, Contact>;
