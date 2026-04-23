export type Document = {
  author: PublicKey;
  dTag: string;
  updatedMs: number;
  content: string;
  filePath?: string;
};

export type DocumentDelete = {
  author: PublicKey;
  dTag: string;
  deletedAt: number;
};

export function documentKeyOf(author: PublicKey, dTag: string): string {
  return `${author}:${dTag}`;
}
