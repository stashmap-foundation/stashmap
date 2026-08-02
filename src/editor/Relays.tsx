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

function withRelayDraft(
  relays: string[],
  draft: string,
  channel: "storage" | "room"
): string[] {
  if (draft.length === 0) {
    return relays;
  }
  const normalized = normalizeWorkspaceConfig({
    storageRelays: channel === "storage" ? [draft] : [],
    roomRelays: channel === "room" ? [draft] : [],
  });
  const url =
    channel === "storage"
      ? normalized.storageRelays[0]
      : normalized.roomRelays[0];
  return url && !relays.includes(url) ? [...relays, url] : relays;
}

function RelayList({
  label,
  channel,
  relays,
  draft,
  onChange,
  onDraftChange,
}: {
  label: string;
  channel: "storage" | "room";
  relays: string[];
  draft: string;
  onChange: (relays: string[]) => void;
  onDraftChange: (draft: string) => void;
}): JSX.Element {
  const add = (): void => {
    onChange(withRelayDraft(relays, draft, channel));
    onDraftChange("");
  };

  return (
    <section aria-label={label} className="mb-4">
      <div className="relay-section-header">{label}</div>
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
          value={draft}
          placeholder="wss://"
          onChange={(event) => onDraftChange(event.target.value)}
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
  const [storageRelayDraft, setStorageRelayDraft] = useState("");
  const [roomRelayDraft, setRoomRelayDraft] = useState("");

  useEffect(() => {
    setStorageRelays(config.storageRelays);
    setRoomRelays(config.roomRelays);
  }, [config]);

  const submit = async (): Promise<void> => {
    const values = {
      storageRelays: showStorage
        ? withRelayDraft(storageRelays, storageRelayDraft, "storage")
        : [],
      roomRelays: withRelayDraft(roomRelays, roomRelayDraft, "room"),
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
          draft={storageRelayDraft}
          onChange={setStorageRelays}
          onDraftChange={setStorageRelayDraft}
        />
      )}
      <RelayList
        label="Room relays"
        channel="room"
        relays={roomRelays}
        draft={roomRelayDraft}
        onChange={setRoomRelays}
        onDraftChange={setRoomRelayDraft}
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
