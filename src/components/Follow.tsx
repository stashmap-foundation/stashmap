import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Form, Modal } from "react-bootstrap";
import { Map } from "immutable";
import { nip19, nip05, Event } from "nostr-tools";
import { useDebounce } from "use-debounce";
import { ErrorMessage } from "../commons/ErrorMessage";
import {
  usePlanner,
  planAddContact,
  planRemoveContact,
  Plan,
} from "../planner";
import { useData } from "../DataContext";
import { useApis } from "../Apis";
import { useNip05Query } from "./useNip05Query";
import { Button } from "../commons/Ui";

type Nip05EventContent = {
  nip05?: string;
};

function lookupNip05PublicKey(
  events: Map<string, Event>,
  nip05Identifier: string
): boolean {
  if (events.size === 0) {
    return false;
  }
  const islookupSuccessful = events
    .valueSeq()
    .toArray()
    .some((event) => {
      if (!event?.content) {
        return false;
      }
      const content = JSON.parse(event.content) as Nip05EventContent;
      return content.nip05 === nip05Identifier;
    });
  return islookupSuccessful;
}

async function decodeInput(
  input: string | undefined
): Promise<{ publicKey: PublicKey; isNip05: boolean } | undefined> {
  if (!input) {
    return undefined;
  }
  try {
    const decodedInput = nip19.decode(input);
    const inputType = decodedInput.type;
    if (inputType === "npub") {
      return { publicKey: decodedInput.data as PublicKey, isNip05: false };
    }
    if (inputType === "nprofile") {
      return {
        publicKey: decodedInput.data.pubkey as PublicKey,
        isNip05: false,
      };
    }
    // eslint-disable-next-line no-empty
  } catch (e) {}
  const publicKeyRegex = /^[a-fA-F0-9]{64}$/;
  if (publicKeyRegex.test(input)) {
    return { publicKey: input as PublicKey, isNip05: false };
  }
  const nip05Regex = /^[a-z0-9-_.]+@[a-z0-9-_.]+\.[a-z0-9-_.]+$/i;
  if (nip05Regex.test(input)) {
    const profile = await nip05.queryProfile(input);
    return profile !== null
      ? { publicKey: profile.pubkey as PublicKey, isNip05: true }
      : undefined;
  }
  return undefined;
}

export function Follow(): JSX.Element {
  const navigate = useNavigate();
  const { relayPool } = useApis();
  const { contacts } = useData();
  const { createPlan, executePlan } = usePlanner();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const rawPublicKey = params.get("publicKey");
  const publicKey = rawPublicKey ? (rawPublicKey as PublicKey) : undefined;
  const [input, setInput] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [lookupPublicKey, setLookupPublicKey] = useState<PublicKey | undefined>(
    undefined
  );
  const [debouncedInput] = useDebounce(input, 500);
  const { events: nip05Events, eose: nip05Eose } = useNip05Query(
    relayPool,
    lookupPublicKey || ("" as PublicKey)
  );

  useEffect(() => {
    if (lookupPublicKey !== undefined && nip05Events.size > 0 && input) {
      const isLookupError = !lookupNip05PublicKey(nip05Events, input);
      if (isLookupError) {
        setError("Lookup of nip-05 identifier failed");
        setLookupPublicKey(undefined);
      } else {
        navigate(`/follow?publicKey=${lookupPublicKey}`);
      }
    } else if (lookupPublicKey !== undefined && nip05Events.size === 0) {
      setError("No Nip05 Events found");
    }
  }, [nip05Eose, nip05Events, lookupPublicKey, debouncedInput]);

  const onHide = (): void => {
    navigate("/");
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const changedInput = e.target.value;
    if (changedInput === input) {
      return;
    }
    setInput(!changedInput ? undefined : changedInput);
  };

  const onSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    const decodedInput = await decodeInput(input);
    if (!decodedInput) {
      setError("Invalid publicKey, npub, nprofile or nip-05 identifier");
    } else if (decodedInput && decodedInput.isNip05) {
      setLookupPublicKey(decodedInput.publicKey);
    } else {
      navigate(`/follow?publicKey=${decodedInput.publicKey}`);
    }
  };

  const inputElementAriaLabel = "find user";

  if (!publicKey) {
    return (
      <Modal show onHide={onHide} className="command-bar">
        <Modal.Body>
          <Form onSubmit={onSubmit}>
            <div className="d-flex align-items-center gap-2">
              <input
                type="text"
                aria-label={inputElementAriaLabel}
                onChange={onChange}
                placeholder="npub, nprofile or nostr address"
                className="form-control flex-grow-1"
              />
              <Button
                type="submit"
                className="btn btn-outline-dark"
                ariaLabel="start search"
                disabled={!input}
              >
                Find
              </Button>
            </div>
            {error && (
              <div className="mt-2">
                <ErrorMessage error={error} setError={setError} />
              </div>
            )}
          </Form>
        </Modal.Body>
      </Modal>
    );
  }

  const privateContact = contacts.get(publicKey);
  const npub = nip19.npubEncode(publicKey);
  const isFollowing = privateContact !== undefined;

  const followUnfollow = async (
    exec: (basePlan: Plan, publicKey: PublicKey) => Plan
  ): Promise<void> => {
    const basePlan = {
      ...createPlan(),
      writeRelayConf: {
        user: true,
        defaultRelays: false,

        contacts: false,
      },
    };
    await executePlan(exec(basePlan, publicKey));
    navigate(`/follow?publicKey=${publicKey}`);
  };

  const followContact = async (): Promise<void> => {
    await followUnfollow(planAddContact);
  };

  const unfollowContact = async (): Promise<void> => {
    await followUnfollow(planRemoveContact);
  };

  return (
    <Modal show onHide={onHide} className="command-bar">
      <Modal.Header closeButton>
        <Modal.Title>
          {isFollowing ? "You follow this User" : "Follow User"}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div
          className="d-block mb-3 break-word font-size-small"
          aria-label="user npub"
        >
          {npub}
        </div>
        <div className="d-flex align-items-center gap-2">
          {isFollowing ? (
            <Button
              className="btn btn-outline-dark"
              ariaLabel="unfollow user"
              onClick={unfollowContact}
            >
              Unfollow
            </Button>
          ) : (
            <Button
              className="btn btn-outline-dark"
              ariaLabel="follow user"
              onClick={followContact}
            >
              Follow
            </Button>
          )}
          <Button
            onClick={() => {
              setInput(undefined);
              setLookupPublicKey(undefined);
              setError(null);
              navigate("/follow");
            }}
            className="btn btn-outline-dark"
          >
            ← Back
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
}
