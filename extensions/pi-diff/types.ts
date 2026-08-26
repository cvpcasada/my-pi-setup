import type { FileDiffMetadata } from "@pierre/diffs";

export type PierreAppearance = "dark" | "light";

export interface DiffSnapshot {
  path: string;
  oldContent: string;
  newContent: string;
  existedBefore: boolean;
  existedAfter: boolean;
}

export interface HastTextNode {
  type: "text";
  value: string;
}

export interface HastElementNode {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export type HastNode = HastTextNode | HastElementNode;

export interface HighlightedDiffCode {
  deletionLines: Array<HastNode | undefined>;
  additionLines: Array<HastNode | undefined>;
}

export type HighlightedDiffSet = Record<PierreAppearance, HighlightedDiffCode>;

export interface DiffViewerPayload {
  snapshot: DiffSnapshot;
  metadata: FileDiffMetadata;
  highlighted: HighlightedDiffSet;
}

export interface DiffViewerDetails {
  diffViewer?: DiffViewerPayload;
}

export interface DiffSpan {
  text: string;
  fg?: string;
  bg?: string;
}

export interface DiffInfoRow {
  kind: "collapsed" | "metadata";
  text: string;
  fg: string;
  bg: string;
}

export interface DiffLineRow {
  kind: "line";
  lineType: "context" | "addition" | "deletion";
  lineNumber?: number;
  spans: DiffSpan[];
  rowFg: string;
  rowBg: string;
  lineNumberFg: string;
}

export type DiffRow = DiffInfoRow | DiffLineRow;

export type SplitDiffRow =
  | DiffInfoRow
  | {
      kind: "line";
      deletion?: DiffLineRow;
      addition?: DiffLineRow;
    };
