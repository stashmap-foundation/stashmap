import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../commons/Ui";
import { ModalForm } from "../commons/ModalForm";
import { ErrorMessage } from "../commons/ErrorMessage";
import {
  mergeRelays,
  sanitizeRelayUrl,
  useRelaysForRelayManagement,
} from "../relays";
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

function RelayRow({
  relay,
  onUpdate,
  onDelete,
  readonly,
}: {
  relay: Relay;
  onUpdate: (newRelay: Relay) => void;
  onDelete: () => void;
  readonly: boolean;
}): JSX.Element {
  return (
    <div className="relay-row" aria-label={`relay details ${relay.url}`}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="relay-row-url">{relay.url}</div>
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

function SuggestedRelayRow({
  relay,
  onAdd,
}: {
  relay: Relay;
  onAdd: (newRelay: Relay) => void;
}): JSX.Element {
  return (
    <div
      className="relay-row black-dimmed"
      aria-label={`suggested relay ${relay.url}`}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="relay-row-url">{relay.url}</div>
      </div>
      <div className="relay-row-controls">
        <Button
          onClick={() => onAdd(relay)}
          className="btn font-size-small"
          ariaLabel={`add relay ${relay.url}`}
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>
    </div>
  );
}

export function Relays({
  defaultRelays,
  relays,
  onSubmit,
  readonly,
}: {
  defaultRelays: Relays;
  relays: Relays;
  onSubmit: (relayState: Relays) => Promise<void>;
  readonly?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const [myRelays, setMyRelays] = useState<Relays>(relays);
  const suggested = defaultRelays.filter(
    (relay) => !myRelays.some((r) => r.url === relay.url)
  );

  const deleteRelay = (index: number): void => {
    setMyRelays(myRelays.filter((_, i) => i !== index));
  };

  const updateRelay = (updatedRelay: Relay, index: number): void => {
    setMyRelays(
      myRelays.map((relay, i) => (index !== i ? relay : updatedRelay))
    );
  };

  const addRelay = (newRelay: Relay): void => {
    setMyRelays(mergeRelays(myRelays, [newRelay]));
  };

  return (
    <ModalForm
      submit={() => onSubmit(myRelays)}
      onHide={() => navigate("/")}
      title={readonly ? "Nostr Relays" : "Edit Nostr Relays"}
      hideFooter={!!readonly}
    >
      <div className="scroll">
        {myRelays.map((relay: Relay, index: number) => (
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
          />
        ))}
        {!readonly && (
          <>
            {suggested.length > 0 && (
              <div className="relay-section-header">suggested</div>
            )}
            {suggested.map((suggestedRelay: Relay) => (
              <SuggestedRelayRow
                key={`suggested relay ${suggestedRelay.url}`}
                relay={suggestedRelay}
                onAdd={(newRelay) => addRelay(newRelay)}
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
      onSubmit={submit}
    />
  );
}
