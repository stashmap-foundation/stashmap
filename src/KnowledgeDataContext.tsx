import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export function shorten(nodeText: string): string {
  return nodeText.substr(0, 30);
}

export function useRootFromURL(): ID | undefined {
  const params = useParams<{
    workspaceID?: ID;
  }>();
  const rootID = params.workspaceID;
  const [lastRootFromURL, setLastRootFromURL] = useState<ID | undefined>(
    rootID
  );
  useEffect(() => {
    if (rootID !== lastRootFromURL && rootID) {
      setLastRootFromURL(rootID);
    }
  }, [rootID]);
  return lastRootFromURL;
}
