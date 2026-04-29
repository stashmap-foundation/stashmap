import MarkdownIt from "markdown-it";
import markdownItFrontMatter from "markdown-it-front-matter";
// eslint-disable-next-line import/no-unresolved
import Token from "markdown-it/lib/token";

type MarkdownFrontMatterBlock = {
  raw: string;
  content: string;
  body: string;
};

type FrontMatterPlugin = (
  md: MarkdownIt,
  cb: (content: string) => void
) => void;

function createMarkdownParser(
  onFrontMatter: (content: string) => void
): MarkdownIt {
  const markdown = new MarkdownIt({ html: true });
  markdown.use(markdownItFrontMatter as FrontMatterPlugin, onFrontMatter);
  return markdown;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readLeadingFrontMatterBlock(
  markdownText: string
): MarkdownFrontMatterBlock | undefined {
  const tokens = createMarkdownParser(() => undefined).parse(
    markdownText,
    {}
  ) as unknown as Token[];
  const frontMatterToken = tokens.find(
    (token): token is Token & { meta: string } =>
      token.type === "front_matter" &&
      typeof (token.meta as unknown) === "string"
  );
  const content =
    typeof (frontMatterToken?.meta as unknown) === "string"
      ? (frontMatterToken?.meta as string)
      : undefined;

  if (content === undefined) {
    return undefined;
  }

  const rawMatch = markdownText.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/u);
  if (!rawMatch) {
    return undefined;
  }

  return {
    raw: rawMatch[0],
    content,
    body: markdownText.slice(rawMatch[0].length),
  };
}

function isEditingFrontMatter(content: string): boolean {
  return (
    /^root:\s.+$/mu.test(content) &&
    /^author:\s.+$/mu.test(content) &&
    /^sourceRoot:\s.+$/mu.test(content) &&
    /^sourceNode:\s.+$/mu.test(content)
  );
}

export function extractTitle(content: string): string | undefined {
  const titleLine = content
    .split(/\r?\n/u)
    .find((line) => /^title:\s+/u.test(line.trim()));
  if (!titleLine) {
    return undefined;
  }
  const [, rawValue = ""] = titleLine.match(/^title:\s*(.+)$/u) || [];
  const title = stripWrappingQuotes(rawValue);
  return title || undefined;
}

export function extractImportedFrontMatter(markdownText: string): {
  body: string;
  frontMatter?: string;
  metadata: {
    title?: string;
  };
} {
  const extractBlocks = (
    remaining: string,
    userBlock?: MarkdownFrontMatterBlock
  ): { body: string; userBlock?: MarkdownFrontMatterBlock } => {
    const candidate = remaining.replace(/^(?:\r?\n)+/u, "");
    const block = readLeadingFrontMatterBlock(candidate);
    if (!block) {
      return {
        body: remaining,
        userBlock,
      };
    }

    return extractBlocks(
      block.body,
      !isEditingFrontMatter(block.content) && !userBlock ? block : userBlock
    );
  };
  const extracted = extractBlocks(markdownText);

  return {
    body: extracted.body,
    ...(extracted.userBlock ? { frontMatter: extracted.userBlock.raw } : {}),
    metadata: {
      ...(extracted.userBlock?.content
        ? { title: extractTitle(extracted.userBlock.content) }
        : {}),
    },
  };
}

export function stripFrontMatter(markdownText: string): string {
  return extractImportedFrontMatter(markdownText).body;
}
