import type { RowFocusIntent, TemporaryViewState } from "./types";

type HasTemporaryView = {
  temporaryView: TemporaryViewState;
};

export function planSetRowFocusIntent<T extends HasTemporaryView>(
  plan: T,
  intent: Omit<RowFocusIntent, "requestId">
): T {
  const currentMaxRequestId = Math.max(
    0,
    ...plan.temporaryView.rowFocusIntents
      .valueSeq()
      .map((currentIntent) => currentIntent.requestId)
      .toArray()
  );
  const requestId = currentMaxRequestId + 1;
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      rowFocusIntents: plan.temporaryView.rowFocusIntents.set(
        intent.paneIndex,
        {
          ...intent,
          requestId,
        }
      ),
    },
  };
}
