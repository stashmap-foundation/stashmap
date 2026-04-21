import { useEffect } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { useDocumentStore } from "./DocumentStore";
import { useBackend } from "./BackendContext";

export function FilesystemWorkspaceLoader(): null {
  const addEvents = useDocumentStore()?.addEvents;
  const events = useBackend().workspace?.events;
  useEffect(() => {
    if (!addEvents || !events || events.length === 0) {
      return;
    }
    addEvents(
      ImmutableMap<string, Event | UnsignedEvent>(
        events.map(
          (event, index) =>
            [`workspace-${index}`, event] as [string, Event | UnsignedEvent]
        )
      )
    );
  }, [addEvents, events]);
  return null;
}
