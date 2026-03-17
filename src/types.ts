declare global {
  type Hash = import("./graph/types").Hash;
  type ID = import("./graph/types").ID;
  type LongID = import("./graph/types").LongID;

  type PublicKey = import("./graph/identity").PublicKey;
  type KeyPair = import("./graph/identity").KeyPair;
  type User = import("./graph/identity").User;
  type Contact = import("./graph/identity").Contact;
  type Contacts = import("./graph/identity").Contacts;
  type HasPublicKey = import("./graph/identity").HasPublicKey;

  type Relevance = import("./graph/types").Relevance;
  type Argument = import("./graph/types").Argument;

  interface Window {
    nostr: import("./infra/publishTypes").Nostr;
  }
}

export {};
