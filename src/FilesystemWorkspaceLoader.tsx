import React, { useEffect } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { useDocumentStore } from "./DocumentStore";
import { consumeInitialWorkspaceEvents } from "./filesystemBootstrap";

export function FilesystemWorkspaceLoader(): null {
  const addEvents = useDocumentStore()?.addEvents;
  useEffect(() => {
    if (!addEvents) {
      return;
    }
    const events = consumeInitialWorkspaceEvents();
    if (events.length === 0) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[filesystem] injecting ${events.length} events into DocumentStore`
    );
    addEvents(
      ImmutableMap<string, Event | UnsignedEvent>(
        events.map(
          (event, index) =>
            [`workspace-${index}`, event] as [string, Event | UnsignedEvent]
        )
      )
    );
  }, [addEvents]);
  return null;
}
