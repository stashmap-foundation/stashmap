import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ModalForm } from "../commons/ModalForm";
import { useBackend } from "../BackendContext";
import { usePlanner } from "../planner";
import {
  buildWorkspaceConfigEvent,
  normalizeWebWorkspaceConfig,
  normalizeWorkspaceConfig,
  WorkspaceConfig,
} from "../workspaceConfig";

function RelayList({
  label,
  channel,
  relays,
  onChange,
}: {
  label: string;
  channel: "storage" | "room";
  relays: string[];
  onChange: (relays: string[]) => void;
}): JSX.Element {
  const [newRelay, setNewRelay] = useState("");
  const add = (): void => {
    const normalized = normalizeWorkspaceConfig({
      storageRelays: channel === "storage" ? [newRelay] : [],
      roomRelays: channel === "room" ? [newRelay] : [],
    });
    const url =
      channel === "storage"
        ? normalized.storageRelays[0]
        : normalized.roomRelays[0];
    if (!url || relays.includes(url)) {
      setNewRelay("");
      return;
    }
    onChange([...relays, url]);
    setNewRelay("");
  };

  return (
    <section aria-label={label} className="mb-4">
      <h5>{label}</h5>
      {relays.map((url, index) => (
        <div
          className="relay-row"
          aria-label={`${channel} relay ${url}`}
          key={`${channel}:${url}`}
        >
          <div className="relay-row-url">{url}</div>
          <button
            type="button"
            className="btn font-size-small"
            aria-label={`delete ${channel} relay ${url}`}
            onClick={() =>
              onChange(relays.filter((_, relayIndex) => relayIndex !== index))
            }
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
      <div className="relay-row">
        <input
          type="text"
          className="form-control"
          aria-label={`add ${channel} relay`}
          value={newRelay}
          placeholder="wss://"
          onChange={(event) => setNewRelay(event.target.value)}
        />
        <button
          type="button"
          className="btn font-size-small"
          aria-label={`save ${channel} relay`}
          onClick={add}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </section>
  );
}

export function Relays({
  config,
  onSubmit,
  showStorage,
}: {
  config: WorkspaceConfig;
  onSubmit: (config: WorkspaceConfig) => Promise<void>;
  showStorage: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const [storageRelays, setStorageRelays] = useState(config.storageRelays);
  const [roomRelays, setRoomRelays] = useState(config.roomRelays);

  useEffect(() => {
    setStorageRelays(config.storageRelays);
    setRoomRelays(config.roomRelays);
  }, [config]);

  const submit = async (): Promise<void> => {
    const values = {
      storageRelays: showStorage ? storageRelays : [],
      roomRelays,
    };
    const next = showStorage
      ? normalizeWebWorkspaceConfig(values)
      : normalizeWorkspaceConfig(values);
    await onSubmit(next);
  };

  return (
    <ModalForm
      submit={submit}
      onHide={() => navigate("/")}
      title="Workspace Settings"
    >
      {showStorage && (
        <RelayList
          label="Storage relays"
          channel="storage"
          relays={storageRelays}
          onChange={setStorageRelays}
        />
      )}
      <RelayList
        label="Room relays"
        channel="room"
        relays={roomRelays}
        onChange={setRoomRelays}
      />
    </ModalForm>
  );
}

export function RelaysWrapper(): JSX.Element {
  const navigate = useNavigate();
  const backend = useBackend();
  const planner = usePlanner();
  return (
    <Relays
      config={backend.workspaceConfig}
      showStorage={!backend.workspace}
      onSubmit={async (config) => {
        if (backend.workspace) {
          await backend.workspace.configure(config);
        } else {
          if (!backend.user) {
            throw new Error("Workspace settings require a signed-in user");
          }
          const event = await buildWorkspaceConfigEvent(backend.user, config);
          const plan = planner.createPlan();
          await planner.executePlan({
            ...plan,
            publishEvents: plan.publishEvents.push(event),
          });
        }
        navigate("/");
      }}
    />
  );
}
