import { List } from "immutable";
import React, { useEffect, useState } from "react";
import { useMediaQuery } from "react-responsive";
import { Link } from "react-router-dom";
import ReactQuill from "react-quill";
import { textVide } from "text-vide";
import DOMPurify from "dompurify";
import { getRelations } from "../connections";
import {
  useNode,
  useViewKey,
  useViewPath,
  ViewPath,
  useIsAddToNode,
  addNodeToPath,
  addAddToNodeToPath,
  addDiffItemToPath,
  getDiffItemsForNode,
  getNodeIDFromView,
  useNodeID,
  getViewFromPath,
  popViewPath,
} from "../ViewContext";
import {
  NodeSelectbox,
  toggleEditing,
  useTemporaryView,
  useIsEditingOn,
  useIsParentMultiselectBtnOn,
  isMutableNode,
} from "./TemporaryViewContext";
import { IS_MOBILE } from "./responsive";
import { AddNodeToNode, getImageUrlFromText } from "./AddNode";
import { NodeMenu } from "./Menu";
import { ReadonlyRelations } from "./SelectRelations";
import { DeleteNode } from "./DeleteNode";
import { useData } from "../DataContext";
import { planUpsertNode, usePlanner } from "../planner";
import { ReactQuillWrapper } from "./ReactQuillWrapper";
import { useNodeIsLoading } from "../LoadingStatus";
import { NodeIcon } from "./NodeIcon";
import { getRelationTypeByRelationsID } from "./RelationTypes";
import { LoadingSpinnerButton } from "../commons/LoadingSpinnerButton";
import { useInputElementFocus } from "../commons/FocusContextProvider";
import { CancelButton, NodeCard } from "../commons/Ui";
import { useProjectContext } from "../ProjectContext";

function getLevels(viewPath: ViewPath): number {
  // Subtract 1: for pane index at position 0
  // This gives: root = 1, first children = 2, nested = 3, etc.
  return viewPath.length - 1;
}

export function LoadingNode(): JSX.Element {
  return (
    <div className="ph-item">
      <div>
        <div className="ph-row">
          <div className="ph-col-12" />
          <div className="ph-col-8" />
          <div className="ph-col-12 " />
          <div className="ph-col-4" />
        </div>
      </div>
    </div>
  );
}

function ErrorContent(): JSX.Element {
  return (
    <div>
      <b>Error: Node not found</b>
      <p>The node you requested could not be found. Possible reasons are:</p>
      <ul>
        <li>You do not have permission to see this node.</li>
        <li>The node has been deleted.</li>
      </ul>
      <p>Please check your permissions and try again.</p>
    </div>
  );
}

type InlineEditorProps = {
  onCreateNode: (text: string, imageUrl?: string) => void;
  onStopEditing: () => void;
};

function InlineEditor({
  onCreateNode,
  onStopEditing,
}: InlineEditorProps): JSX.Element {
  const [node] = useNode();
  const ref = React.createRef<ReactQuill>();
  if (!node) {
    return <ErrorContent />;
  }
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      const quill = ref.current.getEditor();
      quill.deleteText(0, 1000000);
      quill.insertText(0, node.text);
    }
  }, []);
  const onSave = async (): Promise<void> => {
    if (!ref.current) {
      return;
    }
    const text = ref.current.getEditor().getText();
    const imageUrl = await getImageUrlFromText(text);
    const isNewLineAdded = text.endsWith("\n");
    onCreateNode(isNewLineAdded ? text.slice(0, -1) : text, imageUrl);
  };
  return (
    <>
      <div className="editor pb-2">
        <div className="scrolling-container flex-row-start w-100">
          <ReactQuillWrapper ref={ref} />
        </div>
      </div>
      <div className="flex-row-space-between">
        <DeleteNode
          afterOnClick={() => {
            onStopEditing();
          }}
        />
        <div className="flex-row-end">
          <LoadingSpinnerButton
            className="btn font-size-small"
            onClick={() => onSave()}
            ariaLabel="save"
          >
            <span>Save</span>
          </LoadingSpinnerButton>
          <CancelButton
            onClose={() => {
              onStopEditing();
            }}
          />
        </div>
      </div>
    </>
  );
}

function BionicText({ nodeText }: { nodeText: string }): JSX.Element {
  // need sanitizing, i.e. removing <script>-tags or onClick handles
  // otherwise dangerouslySetInnerHTML allows Cross-Site Scripting (XSS) attacks
  const sanitizedNodeText = `<span>${DOMPurify.sanitize(nodeText)}</span>`;
  const bionicNodeText = textVide(sanitizedNodeText, {
    sep: ["<b>", "</b>"],
    fixationPoint: 4,
  });
  // eslint-disable-next-line react/no-danger
  return <div dangerouslySetInnerHTML={{ __html: bionicNodeText }} />;
}

function EditableNodeContent({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { editingViews, setEditingState } = useTemporaryView();
  const viewKey = useViewKey();
  const handleInteraction = (
    event:
      | React.KeyboardEvent<HTMLButtonElement>
      | React.MouseEvent<HTMLButtonElement>
  ): void => {
    if (
      (event instanceof KeyboardEvent && event.key === "Enter") ||
      event.type === "click"
    ) {
      setEditingState(toggleEditing(editingViews, viewKey));
    }
  };

  return (
    <button
      type="button"
      onClick={handleInteraction}
      onKeyDown={handleInteraction}
      className="node-content-button cursor-on-hover w-100"
    >
      {children}
    </button>
  );
}

function NodeContent({ node }: { node: KnowNode }): JSX.Element {
  const { settings } = useData();
  const isBionic = settings.bionicReading;
  const [isImageAccessible, setIsImageAccessible] = useState<boolean>(false);

  useEffect(() => {
    const checkImageAccessibility = async (): Promise<void> => {
      if (node.imageUrl) {
        try {
          await fetch(node.imageUrl, {
            method: "HEAD",
            mode: "no-cors",
          });
          // Since the response is opaque, we assume the image is accessible
          setIsImageAccessible(true);
        } catch {
          setIsImageAccessible(false);
          // eslint-disable-next-line no-console
          console.warn(`Invalid URL: ${node.imageUrl}`);
        }
      }
    };

    checkImageAccessibility();
  }, [node.imageUrl]);
  const textToDisplay = node.imageUrl
    ? node.text.replace(node.imageUrl, "")
    : node.text;

  return (
    <span className="break-word">
      <NodeIcon node={node} />
      {isBionic ? <BionicText nodeText={textToDisplay} /> : textToDisplay}
      {node.imageUrl && isImageAccessible && (
        <div>
          <img
            src={node.imageUrl}
            alt={node.imageUrl}
            style={{ maxWidth: "100%", height: "auto", marginTop: "10px" }}
          />
        </div>
      )}
    </span>
  );
}

function InteractiveNodeContent({
  editOnClick,
}: {
  editOnClick?: boolean;
}): JSX.Element {
  const { user } = useData();
  const [node] = useNode();
  const isLoading = useNodeIsLoading();
  if (isLoading) {
    return <LoadingNode />;
  }
  if (!node) {
    return <ErrorContent />;
  }
  if (editOnClick && isMutableNode(node, user)) {
    <EditableNodeContent>
      <NodeContent node={node} />
    </EditableNodeContent>;
  }
  return <NodeContent node={node} />;
}

function NodeAutoLink({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const { bookmarkedProjects } = useProjectContext();
  const [nodeID] = useNodeID();
  const [node] = useNode();
  if (node && node.type === "project") {
    const project = node as ProjectNode;
    if (bookmarkedProjects.find((bookmark) => bookmark === nodeID)) {
      if (project.dashboardInternal) {
        return (
          <Link
            className="no-underline"
            to={`/w/${escape(project.dashboardInternal)}?p=${escape(
              project.id
            )}`}
          >
            {children}
          </Link>
        );
      }
    }
  }

  return <>{children}</>;
}

function EditingNodeContent(): JSX.Element | null {
  const [node] = useNode();
  const { createPlan, executePlan } = usePlanner();
  const viewKey = useViewKey();
  const { editingViews, setEditingState } = useTemporaryView();
  const { setIsInputElementInFocus } = useInputElementFocus();
  if (!node) {
    return null;
  }
  const editNodeText = (text: string, imageUrl?: string): void => {
    executePlan(
      planUpsertNode(createPlan(), {
        ...node,
        text,
        imageUrl,
      })
    );
  };
  const closeEditor = (): void => {
    setIsInputElementInFocus(false);
    setEditingState(toggleEditing(editingViews, viewKey));
  };
  return (
    <InlineEditor
      onCreateNode={(text, imageUrl) => {
        editNodeText(text, imageUrl);
        closeEditor();
      }}
      onStopEditing={closeEditor}
    />
  );
}

const INDENTATION = 10;
const ARROW_WIDTH = 0;

export function Indent({ levels }: { levels: number }): JSX.Element {
  const viewPath = useViewPath();
  const data = useData();

  return (
    <>
      {Array.from(Array(levels).keys()).map((k) => {
        // For line at position k (where k > 0), pop back to get the ancestor view
        // k=0: no line (just spacing)
        // k=1: first line, pop back (levels - 1) times to get header column view
        // k=2: second line, pop back (levels - 2) times to get first child view
        // etc.
        const color =
          k > 0
            ? (() => {
                const pathForColor = popViewPath(viewPath, levels - k);
                if (!pathForColor) {
                  return undefined;
                }
                const viewForColor = getViewFromPath(data, pathForColor);
                const [relationType] = viewForColor?.relations
                  ? getRelationTypeByRelationsID(data, viewForColor.relations)
                  : [undefined];
                return relationType?.color || undefined;
              })()
            : undefined;

        const style = color
          ? {
              borderLeft: `2px solid ${color}`,
            }
          : {};

        return (
          <div key={k} style={{ marginLeft: ARROW_WIDTH }}>
            <div style={{ width: INDENTATION }} />
            {k !== 0 && (
              <div>
                <div className="vl" style={style} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function getNodesInTree(
  data: Data,
  parentPath: ViewPath,
  ctx: List<ViewPath>,
  noExpansion?: boolean
): List<ViewPath> {
  const [parentNodeID, parentView] = getNodeIDFromView(data, parentPath);
  const relations = getRelations(
    data.knowledgeDBs,
    parentView.relations,
    data.user.publicKey,
    parentNodeID
  );
  if (!relations) {
    return ctx;
  }
  const childPaths = relations.items.map((_, i) =>
    addNodeToPath(data, parentPath, i)
  );
  const addNodePath = addAddToNodeToPath(data, parentPath);
  const nodesInTree = childPaths.reduce(
    (nodesList: List<ViewPath>, childPath: ViewPath) => {
      const childView = getNodeIDFromView(data, childPath)[1];
      if (noExpansion) {
        return nodesList.push(childPath);
      }
      if (childView.expanded) {
        // Recursively get children of expanded node
        // The recursive call will handle adding diff items for childPath at its level
        return getNodesInTree(data, childPath, nodesList.push(childPath));
      }
      return nodesList.push(childPath);
    },
    ctx
  );

  const diffItems = getDiffItemsForNode(
    data.knowledgeDBs,
    data.user.publicKey,
    parentNodeID,
    relations.type,
    relations.id
  );

  // Root has getLevels = 1 (path is [pane, root])
  const isRoot = getLevels(parentPath) === 1;

  // Add diff items at the parent level (after regular items, before Add Note)
  // Always add them - useIsDiffItem() will handle the rendering
  const withDiffItems =
    diffItems.size > 0 && !isRoot
      ? diffItems.reduce(
          (list, diffItem, idx) =>
            list.push(
              addDiffItemToPath(data, parentPath, diffItem.nodeID, idx)
            ),
          nodesInTree
        )
      : nodesInTree;

  // Add inline "Add Note" for all nodes including root
  return withDiffItems.push(addNodePath);
}

function DiffItemIndicator(): JSX.Element {
  return (
    <span
      className="iconsminds-conference diff-indicator"
      title="From other users"
    />
  );
}

export function Node({
  className,
  cardBodyClassName,
  isDiffItem,
}: {
  className?: string;
  cardBodyClassName?: string;
  isDiffItem?: boolean;
}): JSX.Element | null {
  const isDesktop = !useMediaQuery(IS_MOBILE);
  const viewPath = useViewPath();
  const levels = getLevels(viewPath);
  const isAddToNode = useIsAddToNode();
  const isNodeBeingEdited = useIsEditingOn();
  const isMultiselect = useIsParentMultiselectBtnOn();
  const defaultCls = isDesktop ? "hover-light-bg" : "";
  const cls =
    className !== undefined ? `${className} hover-light-bg` : defaultCls;
  const clsBody = cardBodyClassName || "ps-0 pt-4 pb-0";

  return (
    <NodeCard className={cls} cardBodyClassName={clsBody}>
      {levels > 0 && <Indent levels={levels} />}
      {isAddToNode && levels !== 1 && <AddNodeToNode />}
      {!isAddToNode && (
        <>
          {isMultiselect && <NodeSelectbox />}
          <div className="flex-column w-100">
            {isNodeBeingEdited && !isDiffItem && <EditingNodeContent />}
            {(!isNodeBeingEdited || isDiffItem) && (
              <>
                <NodeAutoLink>
                  {isDiffItem && <DiffItemIndicator />}
                  <InteractiveNodeContent editOnClick={!isDiffItem} />
                </NodeAutoLink>
              </>
            )}
            {!isDiffItem && <NodeMenu />}
            {isDiffItem && <ReadonlyRelations />}
          </div>
        </>
      )}
    </NodeCard>
  );
}

export const NOTE_TYPE = "note";
