export type Platform = "telegram" | "x" | "weibo";
export type MomentMedia = { type: "image" | "video" | "audio"; url: string; alt: string };
export type MomentInput = {
  externalId: string;
  sourceUrl: string;
  title: string;
  text: string;
  html: string;
  publishedAt: string;
  tags: string[];
  media: MomentMedia[];
};
export type MomentPage = { posts: MomentInput[]; nextCursor?: string; observedIds?: string[] };
export interface MomentAdapter {
  fetchPage(cursor?: string, signal?: AbortSignal): Promise<MomentPage>;
  close?(): Promise<void>;
}
export type SyncState = {
  checkpoint?: string;
  catchupTarget?: string;
  catchupHead?: string;
  catchupCursor?: string;
  backfillCursor?: string;
  backfillComplete?: boolean;
};
export const platformLabels: Record<Platform, string> = {
  telegram: "Telegram", x: "X / Twitter", weibo: "微博",
};
