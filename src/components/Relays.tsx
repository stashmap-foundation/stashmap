import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Map } from "immutable";
import { Button } from "../commons/Ui";
import { ModalForm } from "../commons/ModalForm";
import { ErrorMessage } from "../commons/ErrorMessage";
import {
  mergeRelays,
  getSuggestedRelays,
  getIsNecessaryReadRelays,
  sanitizeRelayUrl,
  useRelaysForRelayManagement,
} from "../relays";
import { useData } from "../DataContext";
import { useDefaultRelays } from "../NostrAuthContext";
import { planPublishRelayMetadata, usePlanner } from "../planner";

function ReadWriteButton({
  isPressed,
  onClick,
  ariaLabel,
  children,
}: {
  isPressed: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Button
      onClick={onClick}
      className={`btn font-size-small ${isPressed ? "pressed" : ""}`}
      ariaLabel={ariaLabel}
    >
      {children}
    </Button>
  );
}

export const addRelayWarningText =
  "If you don't read from one of these relays, you will miss notes from your contacts!";

function RelayRow({
  relay,
  onUpdate,
  onDelete,
  isNecessaryReadRelay,
  readonly,
}: {
  relay: Relay | SuggestedRelay;
  onUpdate: (newRelay: Relay) => void;
  onDelete: () => void;
  isNecessaryReadRelay: boolean;
  readonly: boolean;
}): JSX.Element {
  const isNecessary = !relay.read && isNecessaryReadRelay;
  return (
    <div className="relay-row" aria-label={`relay details ${relay.url}`}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="relay-row-url">{relay.url}</div>
        {isNecessary && (
          <div className="danger font-size-small">{addRelayWarningText}</div>
        )}
      </div>
      <div className="relay-row-controls">
        {!readonly && (
          <>
            <ReadWriteButton
              isPressed={relay.read}
              ariaLabel={
                relay.read
                  ? `stop reading from relay ${relay.url}`
                  : `start reading from relay ${relay.url}`
              }
              onClick={() => onUpdate({ ...relay, read: !relay.read })}
            >
              R
            </ReadWriteButton>
            <ReadWriteButton
              isPressed={relay.write}
              ariaLabel={
                relay.write
                  ? `stop writing to relay ${relay.url}`
                  : `start writing to relay ${relay.url}`
              }
              onClick={() => onUpdate({ ...relay, write: !relay.write })}
            >
              W
            </ReadWriteButton>
          </>
        )}
        {!readonly && (
          <Button
            onClick={onDelete}
            className="btn font-size-small"
            ariaLabel={`delete relay ${relay.url}`}
          >
            <span aria-hidden="true">×</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function SuggestedRelayRow({
  relay,
  onUpdate,
  isNecessaryReadRelay,
}: {
  relay: SuggestedRelay;
  onUpdate: (newRelay: Relay) => void;
  isNecessaryReadRelay: boolean;
}): JSX.Element {
  const number = relay.numberOfContacts;
  const infoText =
    number > 1
      ? `${number} of your contacts write to this relay`
      : "One contact writes to this relay";
  return (
    <div
      className="relay-row black-dimmed"
      aria-label={`suggested relay ${relay.url}`}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="relay-row-url">{relay.url}</div>
        {number > 0 && <div className="relay-info-text">{infoText}</div>}
        {isNecessaryReadRelay && (
          <div className="danger font-size-small">{addRelayWarningText}</div>
        )}
      </div>
      <div className="relay-row-controls">
        <Button
          onClick={() => onUpdate(relay)}
          className="btn font-size-small"
          ariaLabel={`add relay ${relay.url}`}
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>
    </div>
  );
}

function NewRelay({
  onSave,
}: {
  onSave: (newRelay: Relay) => void;
}): JSX.Element {
  const [input, setInput] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const changedInput = e.target.value;
    if (changedInput === input) {
      return;
    }
    setInput(!changedInput ? undefined : changedInput);
  };

  const onSubmit = (): void => {
    if (!input) {
      setError("Undefined relay");
      return;
    }
    const sanitizedInput = sanitizeRelayUrl(input);
    if (!sanitizedInput) {
      setError("Invalid relay address");
      return;
    }
    onSave({ url: sanitizedInput, read: true, write: true });
    const inputElement = document.querySelector(
      'input[aria-label="add new relay"]'
    );
    if (inputElement) {
      // eslint-disable-next-line functional/immutable-data
      (inputElement as HTMLInputElement).value = "";
    }
    setInput(undefined);
  };

  return (
    <div className="relay-row black-dimmed" aria-label="new relay card">
      <div style={{ flex: 1 }}>
        <input
          type="text"
          aria-label="add new relay"
          onChange={onChange}
          placeholder="wss://"
          className="form-control w-100"
        />
        {error && (
          <div className="mt-1">
            <ErrorMessage error={error} setError={setError} />
          </div>
        )}
      </div>
      {input !== undefined && (
        <div className="relay-row-controls">
          <Button
            onClick={onSubmit}
            className="btn font-size-small"
            ariaLabel={`add new relay ${input}`}
          >
            <span aria-hidden="true">+</span>
          </Button>
        </div>
      )}
    </div>
  );
}

export function Relays({
  defaultRelays,
  relays,
  contactsRelays,
  onSubmit,
  readonly,
}: {
  defaultRelays: Relays;
  relays: Relays;
  contactsRelays: Map<PublicKey, Relays>;
  onSubmit: (relayState: Relays) => Promise<void>;
  readonly?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const suggestedRelays = getSuggestedRelays(contactsRelays);
  const isNecessaryReadRelays = getIsNecessaryReadRelays(contactsRelays);
  const defaultAndSuggestedRelays = mergeRelays(
    defaultRelays.map((relay) => ({
      ...relay,
      numberOfContacts: 0,
    })),
    suggestedRelays.map((relay) => ({
      ...relay,
      read: true,
      write: false,
    }))
  );
  const relaysToSuggest = defaultAndSuggestedRelays.reduce((rdx, rel) => {
    return relays.some((r) => r.url === rel.url) ? rdx : [...rdx, rel];
  }, [] as SuggestedRelays);
  const [relayState, setRelayState] = useState<{
    myRelays: Relays;
    suggested: SuggestedRelays;
  }>({
    myRelays: relays,
    suggested: relaysToSuggest,
  });

  const necessaryReadRelays = isNecessaryReadRelays(relayState.myRelays);

  const deleteRelay = (index: number): void => {
    setRelayState({
      myRelays: relayState.myRelays.filter((_, i) => {
        return i !== index;
      }),
      suggested: mergeRelays(
        relayState.suggested,
        relaysToSuggest.filter((r) => r.url === relayState.myRelays[index].url)
      ),
    });
  };

  const updateRelay = (updatedRelay: Relay, index: number): void => {
    setRelayState({
      ...relayState,
      myRelays: relayState.myRelays.map((relay, i) =>
        index !== i ? relay : updatedRelay
      ),
    });
  };

  const addRelay = (newRelay: Relay): void => {
    setRelayState({
      myRelays: mergeRelays(relayState.myRelays, [newRelay]),
      suggested: relayState.suggested.filter((r) => r.url !== newRelay.url),
    });
  };

  return (
    <ModalForm
      submit={() => onSubmit(relayState.myRelays)}
      onHide={() => navigate("/")}
      title={readonly ? "Nostr Relays" : "Edit Nostr Relays"}
      hideFooter={!!readonly}
    >
      <div className="scroll">
        {relayState.myRelays.map((relay: Relay, index: number) => (
          <RelayRow
            key={`relay ${relay.url}`}
            readonly={!!readonly}
            relay={relay}
            onDelete={() => deleteRelay(index)}
            onUpdate={(newRelay) => {
              if (newRelay !== relay) {
                updateRelay(newRelay, index);
              }
            }}
            isNecessaryReadRelay={necessaryReadRelays.some(
              (r) => r.url === relay.url
            )}
          />
        ))}
        {!readonly && (
          <>
            {relayState.suggested.length > 0 && (
              <div className="relay-section-header">suggested</div>
            )}
            {relayState.suggested.map((suggestedRelay: SuggestedRelay) => (
              <SuggestedRelayRow
                key={`suggested relay ${suggestedRelay.url}`}
                relay={suggestedRelay}
                onUpdate={(newRelay) => addRelay(newRelay)}
                isNecessaryReadRelay={necessaryReadRelays.some(
                  (r) => r.url === suggestedRelay.url
                )}
              />
            ))}
            <NewRelay onSave={(newRelay) => addRelay(newRelay)} />
          </>
        )}
      </div>
    </ModalForm>
  );
}

export function RelaysWrapper(): JSX.Element {
  const navigate = useNavigate();
  const { createPlan, executePlan } = usePlanner();
  const defaultRelays = useDefaultRelays();
  const { contactsRelays } = useData();
  const relays = useRelaysForRelayManagement();
  const submit = async (relayState: Relays): Promise<void> => {
    const plan = planPublishRelayMetadata(createPlan(), relayState);
    await executePlan(plan);
    navigate("/");
  };
  return (
    <Relays
      readonly={false}
      defaultRelays={defaultRelays}
      relays={relays}
      contactsRelays={contactsRelays}
      onSubmit={submit}
    />
  );
}
