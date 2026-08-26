import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { LayoutStyle } from "../lib/config.js";
import { loadHighlightedDiff } from "../lib/pierreHighlight.js";
import { buildDiffRows, buildSplitDiffRows } from "../lib/pierreParser.js";
import {
  getPierrePalette,
  type PierreTerminalPalette,
} from "../lib/pierreTheme.js";
import type {
  DiffLineRow,
  DiffRow,
  DiffSpan,
  DiffViewerPayload,
  HighlightedDiffSet,
  SplitDiffRow,
} from "../types.js";

const ANSI_RESET = "\u001b[22m\u001b[39m\u001b[49m";
const MIN_SPLIT_WIDTH = 40;

interface RenderSegment {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
}

export class PierreCallComponent implements Component {
  private readonly tool: string;
  private readonly path: string;
  private readonly palette: PierreTerminalPalette;

  constructor(tool: string, path: string, theme: Theme) {
    this.tool = tool;
    this.path = path;
    this.palette = getPierrePalette(theme);
  }

  render(width: number): string[] {
    return [
      renderFullWidthLine(
        [
          {
            text: `${this.tool} `,
            fg: this.palette.titleFg,
            bg: this.palette.titleBg,
            bold: true,
          },
          {
            text: this.path,
            fg: this.palette.titleAccentFg,
            bg: this.palette.titleBg,
          },
        ],
        width,
        { fg: this.palette.titleFg, bg: this.palette.titleBg },
      ),
    ];
  }

  invalidate() {}
}

export class PierreStatusComponent implements Component {
  private readonly text: string;
  private readonly colors: { fg: string; bg: string };

  constructor(
    theme: Theme,
    text: string,
    kind: "pending" | "success" | "error",
  ) {
    const palette = getPierrePalette(theme);
    this.text = text;
    this.colors =
      kind === "success"
        ? { fg: palette.successFg, bg: palette.successBg }
        : kind === "error"
          ? { fg: palette.errorFg, bg: palette.errorBg }
          : { fg: palette.pendingFg, bg: palette.pendingBg };
  }

  render(width: number): string[] {
    return [
      renderFullWidthLine(
        [{ text: this.text, fg: this.colors.fg, bg: this.colors.bg }],
        width,
        this.colors,
      ),
    ];
  }

  invalidate() {}
}

export class InlineDiffComponent implements Component {
  private payload: DiffViewerPayload;
  private palette: PierreTerminalPalette;
  private maxVisibleLines: number;
  private layout: LayoutStyle;
  private invalidateView: (() => void) | undefined;
  private refreshPromise: Promise<void> | undefined;
  private refreshKey: string | undefined;

  constructor(
    payload: DiffViewerPayload,
    theme: Theme,
    maxVisibleLines: number,
    layout: LayoutStyle,
    invalidateView?: () => void,
  ) {
    this.payload = payload;
    this.palette = getPierrePalette(theme);
    this.maxVisibleLines = maxVisibleLines;
    this.layout = layout;
    this.invalidateView = invalidateView;
    this.maybeRefreshHighlightedDiff();
  }

  update(
    payload: DiffViewerPayload,
    theme: Theme,
    maxVisibleLines: number,
    layout: LayoutStyle,
    invalidateView?: () => void,
  ) {
    const nextKey = refreshKeyFor(payload);
    const currentKey = refreshKeyFor(this.payload);
    const shouldKeepRefreshedPayload =
      currentKey === nextKey &&
      needsHighlightRefresh(payload) &&
      !needsHighlightRefresh(this.payload);
    this.payload = shouldKeepRefreshedPayload ? this.payload : payload;
    this.palette = getPierrePalette(theme);
    this.maxVisibleLines = maxVisibleLines;
    this.layout = layout;
    this.invalidateView = invalidateView;
    this.maybeRefreshHighlightedDiff();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const highlighted = this.payload.highlighted[this.palette.appearance];
    const useSplitLayout =
      this.layout === "split" && safeWidth >= MIN_SPLIT_WIDTH;
    const allLines = useSplitLayout
      ? buildSplitDiffRows(
          this.payload.metadata,
          highlighted,
          this.palette,
        ).flatMap((row) => this.renderSplitRow(row, safeWidth))
      : buildDiffRows(this.payload.metadata, highlighted, this.palette).flatMap(
          (row) => this.renderRow(row, safeWidth),
        );

    if (allLines.length <= this.maxVisibleLines) {
      return allLines;
    }

    const visible = Math.max(1, this.maxVisibleLines - 1);
    return [
      ...allLines.slice(0, visible),
      renderFullWidthLine(
        [
          {
            text: `... ${allLines.length - visible} more lines`,
            fg: this.palette.metadataFg,
            bg: this.palette.metadataBg,
          },
        ],
        safeWidth,
        { fg: this.palette.metadataFg, bg: this.palette.metadataBg },
      ),
    ];
  }

  invalidate() {}

  private maybeRefreshHighlightedDiff() {
    if (!needsHighlightRefresh(this.payload)) {
      this.refreshPromise = undefined;
      this.refreshKey = undefined;
      return;
    }

    const nextKey = refreshKeyFor(this.payload);
    if (this.refreshPromise && this.refreshKey === nextKey) {
      return;
    }

    this.refreshKey = nextKey;
    this.refreshPromise = loadHighlightedDiff(this.payload.metadata)
      .then((highlighted) => {
        this.payload = {
          ...this.payload,
          highlighted,
        };
        this.invalidateView?.();
      })
      .catch(() => {
        // Keep flat diff rendering when lazy re-highlighting fails.
      })
      .finally(() => {
        if (this.refreshKey === nextKey) {
          this.refreshPromise = undefined;
        }
      });
  }

  private renderRow(row: DiffRow, width: number): string[] {
    if (row.kind !== "line") {
      const lineNumberWidth = lineNumberWidthFor(this.payload.metadata);
      const paddedText =
        row.kind === "collapsed"
          ? ` ${" ".repeat(lineNumberWidth)} ${row.text}`
          : row.text;
      return [
        renderFullWidthLine(
          [{ text: paddedText, fg: row.fg, bg: row.bg }],
          width,
          { fg: row.fg, bg: row.bg },
        ),
      ];
    }

    return this.renderLine(row, width);
  }

  private renderSplitRow(row: SplitDiffRow, width: number): string[] {
    if (row.kind !== "line") {
      return [
        renderFullWidthLine(
          [{ text: row.text, fg: row.fg, bg: row.bg }],
          width,
          { fg: row.fg, bg: row.bg },
        ),
      ];
    }

    const separatorWidth = 1;
    const deletionWidth = Math.floor((width - separatorWidth) / 2);
    const additionWidth = width - separatorWidth - deletionWidth;
    const deletionLines = this.renderSplitSide(row.deletion, deletionWidth);
    const additionLines = this.renderSplitSide(row.addition, additionWidth);
    const lineCount = Math.max(deletionLines.length, additionLines.length);
    const separator = renderSegments(
      [{ text: "│", fg: this.palette.lineNumberFg, bg: this.palette.editorBg }],
      { fg: this.palette.lineNumberFg, bg: this.palette.editorBg },
    );

    return Array.from({ length: lineCount }, (_, index) => {
      const deletion =
        deletionLines[index] ?? this.renderEmptySplitSide(deletionWidth);
      const addition =
        additionLines[index] ?? this.renderEmptySplitSide(additionWidth);
      return `${deletion}${separator}${addition}`;
    });
  }

  private renderSplitSide(
    row: DiffLineRow | undefined,
    width: number,
  ): string[] {
    return row
      ? this.renderLine(row, width)
      : [this.renderEmptySplitSide(width)];
  }

  private renderEmptySplitSide(width: number) {
    return renderFullWidthLine([], width, {
      fg: this.palette.contextFg,
      bg: this.palette.contextRowBg,
    });
  }

  private renderLine(row: DiffLineRow, width: number): string[] {
    const lineNumberWidth = lineNumberWidthFor(this.payload.metadata);
    const prefixSegments: RenderSegment[] = [
      { text: lineMarker(row.lineType), fg: row.rowFg, bg: row.rowBg },
      {
        text: formatLineNumber(row.lineNumber, lineNumberWidth),
        fg: row.lineNumberFg,
        bg: row.rowBg,
      },
      { text: " ", fg: row.lineNumberFg, bg: row.rowBg },
    ];

    const prefix = `${lineMarker(row.lineType)}${formatLineNumber(row.lineNumber, lineNumberWidth)} `;
    const prefixWidth = visibleWidth(prefix);
    if (width <= prefixWidth) {
      return [
        renderFullWidthLine(prefixSegments, width, {
          fg: row.rowFg,
          bg: row.rowBg,
        }),
      ];
    }

    const contentWidth = width - prefixWidth;
    const prefixAnsi = renderSegments(prefixSegments, {
      fg: row.rowFg,
      bg: row.rowBg,
    });
    const continuationAnsi = renderSegments(
      [{ text: " ".repeat(prefixWidth), fg: row.rowFg, bg: row.rowBg }],
      {
        fg: row.rowFg,
        bg: row.rowBg,
      },
    );
    const contentAnsi = renderSegments(row.spans, {
      fg: row.rowFg,
      bg: row.rowBg,
    });
    const wrapped = wrapTextWithAnsi(
      contentAnsi.length > 0
        ? contentAnsi
        : renderSegments([{ text: " " }], { fg: row.rowFg, bg: row.rowBg }),
      contentWidth,
    );

    return wrapped.map((segment, index) =>
      padRenderedLine(
        `${index === 0 ? prefixAnsi : continuationAnsi}${segment}`,
        width,
        {
          fg: row.rowFg,
          bg: row.rowBg,
        },
      ),
    );
  }
}

function renderFullWidthLine(
  segments: RenderSegment[],
  width: number,
  base: { fg?: string; bg?: string; bold?: boolean },
) {
  const rendered = renderSegments(segments, base);
  return padRenderedLine(truncateToWidth(rendered, width), width, base);
}

function padRenderedLine(
  line: string,
  width: number,
  base: { fg?: string; bg?: string; bold?: boolean },
) {
  const padding = Math.max(0, width - visibleWidth(line));
  return `${line}${openAnsi(base)}${" ".repeat(padding)}${ANSI_RESET}`;
}

function renderSegments(
  segments: RenderSegment[],
  base: { fg?: string; bg?: string; bold?: boolean },
) {
  let output = openAnsi(base);
  for (const segment of segments) {
    output += openAnsi({
      fg: segment.fg ?? base.fg,
      bg: segment.bg ?? base.bg,
      bold: segment.bold ?? base.bold,
    });
    output += segment.text;
  }
  output += openAnsi(base);
  return output;
}

function openAnsi(style: { fg?: string; bg?: string; bold?: boolean }) {
  const codes: string[] = [];
  codes.push(style.bold ? "1" : "22");

  const fg = toRgb(style.fg);
  if (fg) {
    codes.push(`38;2;${fg.r};${fg.g};${fg.b}`);
  } else {
    codes.push("39");
  }

  const bg = toRgb(style.bg);
  if (bg) {
    codes.push(`48;2;${bg.r};${bg.g};${bg.b}`);
  } else {
    codes.push("49");
  }

  return `\u001b[${codes.join(";")}m`;
}

function toRgb(hex: string | undefined) {
  const normalized = hex?.trim();
  if (!normalized || !/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return undefined;
  }

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function formatLineNumber(lineNumber: number | undefined, width: number) {
  return lineNumber === undefined
    ? " ".repeat(width)
    : String(lineNumber).padStart(width, " ");
}

function lineMarker(lineType: "context" | "addition" | "deletion") {
  return lineType === "addition" ? "+" : lineType === "deletion" ? "-" : " ";
}

function lineNumberWidthFor(metadata: DiffViewerPayload["metadata"]) {
  return Math.max(
    3,
    String(
      Math.max(metadata.deletionLines.length, metadata.additionLines.length, 1),
    ).length,
  );
}

function needsHighlightRefresh(payload: DiffViewerPayload) {
  const lineCount =
    payload.metadata.deletionLines.length +
    payload.metadata.additionLines.length;
  return lineCount > 0 && !hasHighlightedLines(payload.highlighted);
}

function hasHighlightedLines(highlighted: HighlightedDiffSet) {
  return (
    highlighted.dark.deletionLines.length > 0 ||
    highlighted.dark.additionLines.length > 0 ||
    highlighted.light.deletionLines.length > 0 ||
    highlighted.light.additionLines.length > 0
  );
}

function refreshKeyFor(payload: DiffViewerPayload) {
  return `${payload.snapshot.path}\u0000${payload.snapshot.oldContent}\u0000${payload.snapshot.newContent}\u0000${payload.metadata.lang ?? ""}`;
}
