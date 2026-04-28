import { Map } from "immutable";
import type { TextSeed } from "../core/connections";

function isMatch(input: string, test: string): boolean {
  const searchStr = input.toLowerCase().replace(/\n/g, "");
  const str = test.toLowerCase().replace(/\n/g, "");
  return str.indexOf(searchStr) !== -1;
}

export function filterForKeyword(
  nodes: Map<string, TextSeed>,
  filter: string
): Map<string, TextSeed> {
  return filter === ""
    ? Map<string, TextSeed>()
    : nodes
        .filter((node) => {
          return isMatch(filter, node.text);
        })
        .slice(0, 25);
}
