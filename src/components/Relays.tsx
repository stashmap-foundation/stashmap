import React, { useState } from "react";
import { Card, InputGroup } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { Map } from "immutable";
import { Button } from "../commons/Ui";
import { ModalForm } from "../commons/ModalForm";
import {
  InputElementWrapper,
  pasteFromClipboard,
} from "../commons/InputElementUtils";
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

type ReadWriteButtonProps = {
  isPressed: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
};

function ReadWriteButton({
  isPressed,
  onClick,
  ariaLabel,
  children,
}: ReadWriteButtonProps): JSX.Element {
  return (
    <Button
      onClick={onClick}
      className={`btn font-size-small ${
        isPressed ? "pressed" : ""
      } m-1 mt-0 mb-2`}
      ariaLabel={ariaLabel}
    >
      {children}
    </Button>
  );
}

type DeleteRelayButtonProps = {
  onClick: () => void;
  ariaLabel: string;
};

function DeleteRelayButton({
  onClick,
  ariaLabel,
}: DeleteRelayButtonProps): JSX.Element {
  return (
    <Button
      onClick={onClick}
      className="btn font-size-small"
      ariaLabel={ariaLabel}
    >
      <span aria-hidden="true">×</span>
    </Button>
  );
}

function AddRelayButton({
  onClick,
  ariaLabel,
}: DeleteRelayButtonProps): JSX.Element {
  return (
    <Button
      onClick={onClick}
      className="btn font-size-small"
      ariaLabel={ariaLabel}
    >
      <span aria-hidden="true">+</span>
    </Button>
  );
}

type RelayCardProps = {
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
};

function RelayCard({
  className,
  ariaLabel,
  children,
}: RelayCardProps): JSX.Element {
  return (
    <Card
      className={`flex-row-space-between p-3 m-2 mt-3 mb-3 border-strong ${
        className || ""
      }`}
      aria-label={ariaLabel || "relay card"}
    >
      {children}
    </Card>
  );
}

export const addRelayWarningText =
  "If you don't read from one of these relays, you will miss notes from your contacts!";

type RelayDetailsProps = {
  relay: Relay | SuggestedRelay;
  onUpdate: (newRelay: Relay) => void;
  onDelete: () => void;
  isNecessaryReadRelay: boolean;
  readonly: boolean;
};

function RelayDetails({
  relay,
  onUpdate,
  onDelete,
  isNecessaryReadRelay,
  readonly,
}: RelayDetailsProps): JSX.Element {
  const isNecessary = !relay.read && isNecessaryReadRelay;
  return (
    <RelayCard ariaLabel={`relay details ${relay.url}`}>
      <div>
        <div className="flex-row-start m-1 mt-2">{relay.url}</div>
        <div className="flex-row-start">
          {!readonly && (
            <>
              <ReadWriteButton
                isPressed={relay.read}
                ariaLabel={
                  relay.read
                    ? `stop reading from relay ${relay.url}`
                    : `start reading from relay ${relay.url}`
                }
                onClick={() => {
                  onUpdate({ ...relay, read: !relay.read });
                }}
              >
                Read
              </ReadWriteButton>
              <ReadWriteButton
                isPressed={relay.write}
                ariaLabel={
                  relay.write
                    ? `stop writing to relay ${relay.url}`
                    : `start writing to relay ${relay.url}`
                }
                onClick={() => {
                  onUpdate({ ...relay, write: !relay.write });
                }}
              >
                Write
              </ReadWriteButton>
            </>
          )}
        </div>
        {isNecessary && (
          <div className="flex-row-start m-1 danger">{addRelayWarningText}</div>
        )}
      </div>
      {!readonly && (
        <div className="flex-col-center">
          <DeleteRelayButton
            onClick={onDelete}
            ariaLabel={`delete relay ${relay.url}`}
          />
        </div>
      )}
    </RelayCard>
  );
}

function SuggestedRelayDetails({
  relay,
  onUpdate,
  isNecessaryReadRelay,
}: Omit<RelayDetailsProps, "onDelete" | "readonly">): JSX.Element {
  const number = (relay as SuggestedRelay).numberOfContacts;
  const infoText =
    number > 1
      ? `${number} of your contacts write to this relay`
      : "One contact writes to this relay";
  return (
    <RelayCard
      className="black-dimmed"
      ariaLabel={`suggested relay ${relay.url}`}
    >
      <div>
        <div className="flex-row-start m-1 mt-2 bold">Suggested</div>
        <div className="flex-row-start m-1">{relay.url}</div>
        {number > 0 && (
          <div className="flex-row-start m-1 bold">{infoText}</div>
        )}
        {isNecessaryReadRelay && (
          <div className="flex-row-start m-1 danger">{addRelayWarningText}</div>
        )}
      </div>
      <div className="flex-col-center">
        <AddRelayButton
          onClick={() => onUpdate(relay)}
          ariaLabel={`add relay ${relay.url}`}
        />
      </div>
    </RelayCard>
  );
}

type NewRelayProps = {
  onSave: (newRelay: Relay) => void;
};

function NewRelay({ onSave }: NewRelayProps): JSX.Element {
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

  const inputElementAriaLabel = "add new relay";

  return (
    <RelayCard className="black-dimmed" ariaLabel="new relay card">
      <div className="m-1 mt-2 w-90">
        <InputGroup>
          <div className="input-with-overlay">
            <InputElementWrapper
              aria-label={inputElementAriaLabel}
              onChange={onChange}
              placeholder="wss://"
              className="form-control w-100"
            />
            <div className="input-overlay-buttons">
              <Button
                className="btn btn-icon"
                onClick={() =>
                  pasteFromClipboard(inputElementAriaLabel, setInput)
                }
              >
                <span aria-hidden="true">⎘</span>
              </Button>
            </div>
          </div>
        </InputGroup>
        <div className="m-2">
          <ErrorMessage error={error} setError={setError} />
        </div>
      </div>
      {input !== undefined && (
        <div className="flex-col-center">
          <AddRelayButton
            onClick={onSubmit}
            ariaLabel={`add new relay ${input}`}
          />
        </div>
      )}
    </RelayCard>
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
        {relayState.myRelays.map((relay: Relay, index: number) => {
          const key = `relay ${relay.url}`;
          return (
            <div key={key}>
              <RelayDetails
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
            </div>
          );
        })}
        {!readonly && (
          <>
            {relayState.suggested.map((suggestedRelay: SuggestedRelay) => {
              const key = `suggested relay ${suggestedRelay.url}`;
              return (
                <div key={key}>
                  <SuggestedRelayDetails
                    relay={suggestedRelay}
                    onUpdate={(newRelay) => addRelay(newRelay)}
                    isNecessaryReadRelay={necessaryReadRelays.some(
                      (r) => r.url === suggestedRelay.url
                    )}
                  />
                </div>
              );
            })}
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
