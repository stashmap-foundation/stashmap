import { Event, EventTemplate, VerifiedEvent } from "nostr-tools";
import { List, Map } from "immutable";
import { buildDocumentEvents, GraphPlan } from "../../planner";
import { FinalizeEvent } from "../../Apis";
import { Backend } from "../../BackendContext";
import {
  isUserLoggedIn,
  isUserLoggedInWithExtension,
} from "../../NostrAuthContext";
import { KIND_KNOWLEDGE_DOCUMENT } from "../../nostr";
import { buildStorageEnvelope } from "../../storageEncryption";
import {
  defaultWebWorkspaceConfig,
  normalizeWorkspaceRelayUrl,
  WorkspaceConfig,
} from "../../workspaceConfig";
import { publishEventToRelays, PUBLISH_TIMEOUT } from "./nostrPublish";

export { PUBLISH_TIMEOUT };

export type SignedEventWithRoute = {
  readonly event: VerifiedEvent;
  readonly route: PublicationRoute;
};

function publicationRouteCandidates(
  route: PublicationRoute,
  config: WorkspaceConfig
): string[] {
  if (route.kind === "configuration") {
    return route.relays;
  }
  if (route.kind === "storage") {
    return config.storageRelays;
  }
  return config.roomRelays;
}

export function publicationRouteUrls(
  route: PublicationRoute,
  config: WorkspaceConfig
): string[] | undefined {
  if (route.kind === "shared" && config.roomRelays.length === 0) {
    return undefined;
  }
  const candidates = publicationRouteCandidates(route, config);
  return [
    ...new Set(
      candidates
        .map((url) => normalizeWorkspaceRelayUrl(url))
        .filter((url): url is string => url !== undefined)
    ),
  ];
}

export async function signEvents(
  events: List<EventTemplate & EventAttachment>,
  user: User | undefined,
  finalizeEvent: FinalizeEvent
): Promise<List<SignedEventWithRoute>> {
  if (!isUserLoggedIn(user)) {
    return List();
  }

  const signEventWithExtension = async (
    event: EventTemplate
  ): Promise<Event> => {
    try {
      return window.nostr.signEvent(event);
    } catch {
      throw new Error("Failed to sign event with extension");
    }
  };

  const toWireTemplate = async (
    event: EventTemplate & EventAttachment
  ): Promise<{ template: EventTemplate; route: PublicationRoute }> => {
    const { route, storageKey, ...template } = event;
    if (template.kind !== KIND_KNOWLEDGE_DOCUMENT) {
      return { template, route };
    }
    if (!storageKey) {
      throw new Error("Storage event without a storage key");
    }
    return {
      template: {
        ...template,
        content: await buildStorageEnvelope(user, storageKey, template.content),
      },
      route,
    };
  };

  const wireEvents = await Promise.all(events.toArray().map(toWireTemplate));

  return isUserLoggedInWithExtension(user)
    ? List<SignedEventWithRoute>(
        await Promise.all(
          wireEvents.map(async ({ template, route }) => ({
            event: (await signEventWithExtension(template)) as VerifiedEvent,
            route,
          }))
        )
      )
    : List<SignedEventWithRoute>(
        wireEvents.map(({ template, route }) => ({
          event: finalizeEvent(
            template,
            (user as KeyPair).privateKey
          ) as VerifiedEvent,
          route,
        }))
      );
}

export async function publishEventsByRoute(
  backend: Pick<Backend, "publish">,
  config: WorkspaceConfig,
  finalizedEvents: List<SignedEventWithRoute>
): Promise<PublishResultsEventMap> {
  const results = await Promise.all(
    finalizedEvents.toArray().map(({ event, route }) => {
      const urls = publicationRouteUrls(route, config);
      return urls
        ? publishEventToRelays(backend, event, urls)
        : Promise.resolve(undefined);
    })
  );

  return results.reduce((rdx, result, index) => {
    const eventId = finalizedEvents.get(index)?.event.id;
    return eventId && result ? rdx.set(eventId, result) : rdx;
  }, Map<string, PublishResultsOfEvent>());
}

export async function execute({
  plan,
  backend,
  finalizeEvent,
  workspaceConfig = defaultWebWorkspaceConfig(),
}: {
  plan: GraphPlan;
  backend: Pick<Backend, "publish">;
  finalizeEvent: FinalizeEvent;
  workspaceConfig?: WorkspaceConfig;
}): Promise<PublishResultsEventMap> {
  const allEvents = buildDocumentEvents(plan);

  if (allEvents.size === 0) {
    return Map();
  }

  const finalizedEvents = await signEvents(allEvents, plan.user, finalizeEvent);

  if (finalizedEvents.size === 0) {
    return Map();
  }

  return publishEventsByRoute(backend, workspaceConfig, finalizedEvents);
}

export async function republishEvents({
  events,
  backend,
  writeRelayUrl,
}: {
  events: List<Event>;
  backend: Pick<Backend, "publish">;
  writeRelayUrl: string;
}): Promise<PublishResultsEventMap> {
  if (events.size === 0) {
    return Map();
  }

  const results = await Promise.all(
    events
      .toArray()
      .map((event) => publishEventToRelays(backend, event, [writeRelayUrl]))
  );

  return results.reduce((rdx, result, index) => {
    const eventId = events.get(index)?.id;
    return eventId ? rdx.set(eventId, result) : rdx;
  }, Map<string, PublishResultsOfEvent>());
}
