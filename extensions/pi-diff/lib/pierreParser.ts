import {
  getFiletypeFromFileName,
  parseDiffFromFile,
  setLanguageOverride,
  type FileContents,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { cleanDiffLine, flattenHighlightedLine } from "./pierreHighlight.js";
import type {
  DiffLineRow,
  DiffRow,
  DiffSnapshot,
  HighlightedDiffCode,
  SplitDiffRow,
} from "../types.js";
import type { PierreTerminalPalette } from "./pierreTheme.js";

export function buildDiffMetadata(snapshot: DiffSnapshot): FileDiffMetadata {
  const oldFile: FileContents = {
    name: snapshot.path,
    contents: snapshot.oldContent,
  };
  const newFile: FileContents = {
    name: snapshot.path,
    contents: snapshot.newContent,
  };

  return normalizeDiffMetadataLanguage(
    parseDiffFromFile(oldFile, newFile, undefined, true),
    snapshot.path,
  );
}

export function normalizeDiffMetadataLanguage(
  metadata: FileDiffMetadata,
  path: string,
): FileDiffMetadata {
  const language = metadata.lang ?? getFiletypeFromFileName(path);
  return language ? setLanguageOverride(metadata, language) : metadata;
}

export function buildDiffRows(
  metadata: FileDiffMetadata,
  highlighted: HighlightedDiffCode,
  palette: PierreTerminalPalette,
): DiffRow[] {
  const rows: DiffRow[] = [];

  for (const hunk of metadata.hunks) {
    if (hunk.collapsedBefore > 0) {
      rows.push({
        kind: "collapsed",
        text: "...",
        fg: palette.metadataFg,
        bg: palette.metadataBg,
      });
    }

    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;
    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          rows.push({
            kind: "line",
            lineType: "context",
            lineNumber: additionLineNumber + offset,
            spans: flattenHighlightedLine(
              highlighted.additionLines[additionLineIndex + offset],
              palette.appearance,
              palette.contextRowBg,
              cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
            ),
            rowFg: palette.contextFg,
            rowBg: palette.contextRowBg,
            lineNumberFg: palette.lineNumberFg,
          });
        }

        deletionLineIndex += content.lines;
        additionLineIndex += content.lines;
        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
        continue;
      }

      for (let offset = 0; offset < content.deletions; offset += 1) {
        rows.push({
          kind: "line",
          lineType: "deletion",
          lineNumber: deletionLineNumber + offset,
          spans: flattenHighlightedLine(
            highlighted.deletionLines[deletionLineIndex + offset],
            palette.appearance,
            palette.deletionRowBg,
            cleanDiffLine(metadata.deletionLines[deletionLineIndex + offset]),
          ),
          rowFg: palette.deletionFg,
          rowBg: palette.deletionRowBg,
          lineNumberFg: palette.lineNumberFg,
        });
      }

      for (let offset = 0; offset < content.additions; offset += 1) {
        rows.push({
          kind: "line",
          lineType: "addition",
          lineNumber: additionLineNumber + offset,
          spans: flattenHighlightedLine(
            highlighted.additionLines[additionLineIndex + offset],
            palette.appearance,
            palette.additionRowBg,
            cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
          ),
          rowFg: palette.additionFg,
          rowBg: palette.additionRowBg,
          lineNumberFg: palette.lineNumberFg,
        });
      }

      deletionLineIndex += content.deletions;
      additionLineIndex += content.additions;
      deletionLineNumber += content.deletions;
      additionLineNumber += content.additions;
    }

    if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
      rows.push({
        kind: "metadata",
        text: "\\ No newline at end of file",
        fg: palette.metadataFg,
        bg: palette.metadataBg,
      });
    }
  }

  const trailing = trailingCollapsedLines(metadata);
  if (trailing > 0) {
    rows.push({
      kind: "collapsed",
      text: "...",
      fg: palette.metadataFg,
      bg: palette.metadataBg,
    });
  }

  return rows;
}

export function buildSplitDiffRows(
  metadata: FileDiffMetadata,
  highlighted: HighlightedDiffCode,
  palette: PierreTerminalPalette,
): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];

  for (const hunk of metadata.hunks) {
    if (hunk.collapsedBefore > 0) {
      rows.push({
        kind: "collapsed",
        text: "...",
        fg: palette.metadataFg,
        bg: palette.metadataBg,
      });
    }

    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          rows.push({
            kind: "line",
            deletion: buildSplitLine(
              "context",
              deletionLineNumber + offset,
              highlighted.deletionLines[content.deletionLineIndex + offset],
              metadata.deletionLines[content.deletionLineIndex + offset],
              palette,
            ),
            addition: buildSplitLine(
              "context",
              additionLineNumber + offset,
              highlighted.additionLines[content.additionLineIndex + offset],
              metadata.additionLines[content.additionLineIndex + offset],
              palette,
            ),
          });
        }

        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
        continue;
      }

      const lineCount = Math.max(content.deletions, content.additions);
      for (let offset = 0; offset < lineCount; offset += 1) {
        rows.push({
          kind: "line",
          deletion:
            offset < content.deletions
              ? buildSplitLine(
                  "deletion",
                  deletionLineNumber + offset,
                  highlighted.deletionLines[content.deletionLineIndex + offset],
                  metadata.deletionLines[content.deletionLineIndex + offset],
                  palette,
                )
              : undefined,
          addition:
            offset < content.additions
              ? buildSplitLine(
                  "addition",
                  additionLineNumber + offset,
                  highlighted.additionLines[content.additionLineIndex + offset],
                  metadata.additionLines[content.additionLineIndex + offset],
                  palette,
                )
              : undefined,
        });
      }

      deletionLineNumber += content.deletions;
      additionLineNumber += content.additions;
    }

    if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
      rows.push({
        kind: "metadata",
        text: "\\ No newline at end of file",
        fg: palette.metadataFg,
        bg: palette.metadataBg,
      });
    }
  }

  if (trailingCollapsedLines(metadata) > 0) {
    rows.push({
      kind: "collapsed",
      text: "...",
      fg: palette.metadataFg,
      bg: palette.metadataBg,
    });
  }

  return rows;
}

function buildSplitLine(
  lineType: DiffLineRow["lineType"],
  lineNumber: number,
  highlightedLine: Parameters<typeof flattenHighlightedLine>[0],
  fallbackLine: string | undefined,
  palette: PierreTerminalPalette,
): DiffLineRow {
  const rowFg =
    lineType === "addition"
      ? palette.additionFg
      : lineType === "deletion"
        ? palette.deletionFg
        : palette.contextFg;
  const rowBg =
    lineType === "addition"
      ? palette.additionRowBg
      : lineType === "deletion"
        ? palette.deletionRowBg
        : palette.contextRowBg;

  return {
    kind: "line",
    lineType,
    lineNumber,
    spans: flattenHighlightedLine(
      highlightedLine,
      palette.appearance,
      rowBg,
      cleanDiffLine(fallbackLine),
    ),
    rowFg,
    rowBg,
    lineNumberFg: palette.lineNumberFg,
  };
}

function trailingCollapsedLines(metadata: FileDiffMetadata) {
  const lastHunk =
    metadata.hunks.length > 0
      ? metadata.hunks[metadata.hunks.length - 1]
      : undefined;
  if (!lastHunk || metadata.isPartial) {
    return 0;
  }

  const additionRemaining =
    metadata.additionLines.length -
    (lastHunk.additionLineIndex + lastHunk.additionCount);
  const deletionRemaining =
    metadata.deletionLines.length -
    (lastHunk.deletionLineIndex + lastHunk.deletionCount);

  if (additionRemaining !== deletionRemaining) {
    return 0;
  }

  return Math.max(additionRemaining, 0);
}
