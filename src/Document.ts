export type Document = {
  author: PublicKey;
  docId: string;
  updatedMs: number;
  content: string;
  filePath?: string;
};

export type DocumentDelete = {
  author: PublicKey;
  docId: string;
  deletedAt: number;
};

export function documentKeyOf(author: PublicKey, docId: string): string {
  return `${author}:${docId}`;
}
