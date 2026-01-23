import React from "react";
import { List } from "immutable";
import { useDropzone } from "react-dropzone";
import MarkdownIt from "markdown-it";
import { newNode, bulkAddRelations } from "../connections";
import { newRelations } from "../ViewContext";
import {
  Plan,
  planBulkUpsertNodes,
  planUpsertRelations,
  usePlanner,
} from "../planner";

/* eslint-disable functional/immutable-data */
function convertToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent as string;
}
/* eslint-enable functional/immutable-data */

function createRelationsFromParagraphNodes(
  nodes: KnowNode[],
  myself: PublicKey,
  context: List<ID> = List()
): [relations: Relations, topNodeID: ID] {
  const topParagraph = nodes[0];
  const furtherParagraphs = nodes.slice(1);
  const relations = bulkAddRelations(
    newRelations(topParagraph.id, context, myself),
    furtherParagraphs.map((n) => n.id)
  );
  return [relations, topParagraph.id];
}

export function createNodesFromMarkdown(markdown: string): KnowNode[] {
  const markdownParagraphs = markdown.split("\n\n");
  const plainTextParagraphs = markdownParagraphs
    .map((paragraph: string) => {
      const md = new MarkdownIt();
      return convertToPlainText(md.render(paragraph)).trim();
    })
    .filter((paragraph) => paragraph !== "");
  return plainTextParagraphs.map((paragraph) => {
    return newNode(paragraph);
  });
}

const CHUNK_SIZE = 8196;

function splitMarkdownInChunkSizes(markdown: string): string[] {
  const paragraphs = markdown.split("\n\n");
  return paragraphs.reduce((rdx: string[], p: string, i: number): string[] => {
    const currentChunk = rdx[rdx.length - 1] || "";

    const paragraph = i === paragraphs.length - 1 ? p : `${p}\n\n`;
    if (currentChunk.length + paragraph.length > CHUNK_SIZE) {
      return [...rdx, paragraph];
    }
    return [...rdx.slice(0, -1), `${currentChunk}${paragraph}`];
  }, []);
}

export function planCreateNodesFromMarkdown(
  plan: Plan,
  markdown: string,
  context: List<ID> = List()
): [Plan, topNodeID: ID] {
  const splittedMarkdown = splitMarkdownInChunkSizes(markdown);
  const nodes = splittedMarkdown.reduce((rdx: KnowNode[], md: string) => {
    const mdNodes = createNodesFromMarkdown(md);
    return [...rdx, ...mdNodes];
  }, []);
  // Always create relations with empty context (standalone)
  const [emptyContextRelations, topNodeID] = createRelationsFromParagraphNodes(
    nodes,
    plan.user.publicKey,
    List()
  );
  const planWithNodes = planBulkUpsertNodes(plan, nodes);
  const planWithEmptyContextRelations = planUpsertRelations(
    planWithNodes,
    emptyContextRelations
  );

  // Also create relations with the provided context if non-empty
  if (context.size > 0) {
    const [contextRelations] = createRelationsFromParagraphNodes(
      nodes,
      plan.user.publicKey,
      context
    );
    return [
      planUpsertRelations(planWithEmptyContextRelations, contextRelations),
      topNodeID,
    ];
  }

  return [planWithEmptyContextRelations, topNodeID];
}

type FileDropZoneProps = {
  children: React.ReactNode;
  onDrop: (plan: Plan, topNodes: Array<ID>) => void;
};

type MarkdownReducer = {
  plan: Plan;
  topNodeIDs: ID[];
};

/* eslint-disable react/jsx-props-no-spreading */
export function FileDropZone({
  children,
  onDrop,
}: FileDropZoneProps): JSX.Element {
  const { createPlan } = usePlanner();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    noClick: true,
    noKeyboard: true,
    accept: ".md",
    onDrop: async (acceptedFiles: Array<File>) => {
      const markdowns = await Promise.all(
        acceptedFiles.map((file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            /* eslint-disable functional/immutable-data */
            reader.onload = () => {
              resolve(reader.result as string);
            };
            reader.onerror = reject;
            reader.readAsText(file);
            /* eslint-enable functional/immutable-data */
          });
        })
      );
      const mdNodes = markdowns.reduce<MarkdownReducer>(
        (rdx, markdown) => {
          const [plan, topNodeID] = planCreateNodesFromMarkdown(
            rdx.plan,
            markdown
          );
          return {
            plan,
            topNodeIDs: [...rdx.topNodeIDs, topNodeID],
          };
        },
        {
          plan: createPlan(),
          topNodeIDs: [] as ID[],
        }
      );
      onDrop(mdNodes.plan, mdNodes.topNodeIDs);
    },
  });
  const className = isDragActive ? "dimmed flex-col-100" : "flex-col-100";
  return (
    <div {...getRootProps({ className })}>
      {children}
      <input {...getInputProps()} />
    </div>
  );
}
/* eslint-enable react/jsx-props-no-spreading */
