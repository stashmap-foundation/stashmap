import React, { Dispatch, SetStateAction } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { useDocumentStore } from "../../DocumentStore";
import { ExecutorProvider } from "../../ExecutorContext";
import { buildDocumentEvents, Plan } from "../../planner";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../../nostr";

export function FilesystemExecutorProvider({
  setPublishEvents,
  setPanes,
  setViews,
  children,
}: {
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setViews: Dispatch<SetStateAction<Views>>;
  children: React.ReactNode;
}): JSX.Element {
  const addEvents = useDocumentStore()?.addEvents;

  const executePlan = (plan: Plan): Promise<void> => {
    setPanes(plan.panes);
    setViews(plan.views);
    const filteredEvents = buildDocumentEvents(plan);

    setPublishEvents((prevStatus) => {
      const newTemporaryEvents = prevStatus.temporaryEvents.concat(
        plan.temporaryEvents
      );
      return {
        ...prevStatus,
        temporaryView: plan.temporaryView,
        temporaryEvents: newTemporaryEvents,
      };
    });

    if (filteredEvents.size === 0) return Promise.resolve();

    const writable = filteredEvents.filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT || event.kind === KIND_DELETE
    );

    if (writable.size === 0 || !addEvents) return Promise.resolve();

    addEvents(
      ImmutableMap<string, Event | UnsignedEvent>(
        writable
          .map(
            (event, index) =>
              [`exec-${Date.now()}-${index}`, event] as [
                string,
                Event | UnsignedEvent
              ]
          )
          .toArray()
      )
    );

    // eslint-disable-next-line no-console
    console.warn(
      "Filesystem executor: disk write not yet implemented",
      writable.size,
      "events"
    );
    return Promise.resolve();
  };

  const republishEventsOnRelay = (): Promise<void> => {
    // No relays in filesystem mode; no-op.
    return Promise.resolve();
  };

  return (
    <ExecutorProvider
      executor={{
        executePlan,
        republishEvents: republishEventsOnRelay,
      }}
    >
      {children}
    </ExecutorProvider>
  );
}
