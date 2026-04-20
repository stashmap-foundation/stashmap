import { UnsignedEvent } from "nostr-tools";
import { scanWorkspaceDocuments, WorkspaceSaveProfile } from "./workspaceSave";
import { buildDocumentEventFromMarkdownTree } from "../standaloneDocumentEvent";

export async function loadWorkspaceAsEvents(
  profile: WorkspaceSaveProfile
): Promise<ReadonlyArray<UnsignedEvent>> {
  const documents = await scanWorkspaceDocuments(profile);
  return documents.map((document) => {
    const rootTree = {
      ...document.mainRoot,
      frontMatter: document.frontMatter,
    };
    return buildDocumentEventFromMarkdownTree(profile.pubkey, rootTree).event;
  });
}
