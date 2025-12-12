import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export function shorten(nodeText: string): string {
  return nodeText.substr(0, 30);
}

export function useWorkspaceFromURL(): LongID | undefined {
  const params = useParams<{
    workspaceID?: LongID;
  }>();
  const wsID = params.workspaceID;
  const [lastWSFromURL, setLastWSFromURL] = useState<LongID | undefined>(wsID);
  useEffect(() => {
    if (wsID !== lastWSFromURL && wsID) {
      setLastWSFromURL(wsID);
    }
  }, [wsID]);
  return lastWSFromURL;
}
