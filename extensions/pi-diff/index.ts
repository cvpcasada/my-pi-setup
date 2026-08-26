/**
 * Pi Diff Viewer Extension
 * Replaces inline diff rendering for edit and write tools with Pierre-owned inline blocks.
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  InlineDiffComponent,
  PierreCallComponent,
  PierreStatusComponent,
} from "./components/DiffViewer.js";
import {
  createEditSnapshots,
  createWriteSnapshot,
} from "./lib/content-snapshot.js";
import {
  LAYOUT_STYLES,
  loadLayoutStyle,
  parseLayoutStyle,
  type LayoutStyle,
} from "./lib/config.js";
import { loadHighlightedDiff } from "./lib/pierreHighlight.js";
import {
  buildDiffMetadata,
  normalizeDiffMetadataLanguage,
} from "./lib/pierreParser.js";
import type {
  DiffViewerDetails,
  DiffViewerPayload,
  HighlightedDiffSet,
} from "./types.js";

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const originalEdit = createEditToolDefinition(cwd);
  const originalWrite = createWriteToolDefinition(cwd);
  let layout: LayoutStyle = "stacked";

  pi.on("session_start", async (_event, ctx) => {
    layout = await loadLayoutStyle(ctx.cwd, ctx.isProjectTrusted());
  });

  pi.registerCommand("pi-diff-layout", {
    description: "Set the Pi diff layout for the current session",
    async handler(args, ctx) {
      const requested = args.trim();
      let nextLayout = parseLayoutStyle(requested);

      if (requested && !nextLayout) {
        ctx.ui.notify(
          `Unknown layout: ${requested}. Use stacked or split.`,
          "error",
        );
        return;
      }

      if (!nextLayout) {
        const selected = await ctx.ui.select("Pi diff layout", [
          ...LAYOUT_STYLES,
        ]);
        nextLayout = parseLayoutStyle(selected);
      }

      if (nextLayout) {
        layout = nextLayout;
        ctx.ui.notify(`Pi diff layout: ${layout}`, "info");
      }
    },
  });

  pi.registerTool({
    name: "edit",
    label: originalEdit.label,
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    promptSnippet: originalEdit.promptSnippet,
    promptGuidelines: originalEdit.promptGuidelines,
    prepareArguments: originalEdit.prepareArguments,
    renderShell: "self",

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const snapshotState = await createEditSnapshots(ctx.cwd, params.path);
      const editTool =
        ctx.cwd === cwd ? originalEdit : createEditToolDefinition(ctx.cwd);
      const result = await editTool.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
      if (resultLooksLikeError(result)) {
        return result;
      }

      try {
        const snapshot = await snapshotState.finish();
        const metadata = buildDiffMetadata(snapshot);
        const highlighted = await loadHighlightedDiff(metadata);
        return attachDiffViewerPayload(result, {
          snapshot,
          metadata,
          highlighted,
        });
      } catch {
        return result;
      }
    },

    renderCall(args, theme) {
      return new PierreCallComponent("edit", args.path, theme);
    },

    renderResult(result, options, theme, context) {
      if (options.isPartial) {
        return new PierreStatusComponent(theme, "Editing...", "pending");
      }

      const error = getErrorMessage(result);
      if (error) {
        return new PierreStatusComponent(theme, error, "error");
      }

      const payload = getRenderableDiffViewerPayload(result);
      if (payload) {
        return renderInlineDiff(
          payload,
          theme,
          maxVisibleLines(options.expanded),
          layout,
          context,
        );
      }

      if (originalEdit.renderResult) {
        return originalEdit.renderResult(
          result as AgentToolResult<any>,
          options,
          theme,
          context,
        );
      }

      return new PierreStatusComponent(theme, "Applied", "success");
    },
  });

  pi.registerTool({
    name: "write",
    label: originalWrite.label,
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    promptSnippet: originalWrite.promptSnippet,
    promptGuidelines: originalWrite.promptGuidelines,
    prepareArguments: originalWrite.prepareArguments,
    renderShell: "self",

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const snapshot = await createWriteSnapshot(
        ctx.cwd,
        params.path,
        params.content,
      );
      const writeTool =
        ctx.cwd === cwd ? originalWrite : createWriteToolDefinition(ctx.cwd);
      const result = await writeTool.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
      if (resultLooksLikeError(result)) {
        return result;
      }

      try {
        const metadata = buildDiffMetadata(snapshot);
        const highlighted = await loadHighlightedDiff(metadata);
        return attachDiffViewerPayload(result, {
          snapshot,
          metadata,
          highlighted,
        });
      } catch {
        return result;
      }
    },

    renderCall(args, theme) {
      return new PierreCallComponent("write", args.path, theme);
    },

    renderResult(result, options, theme, context) {
      if (options.isPartial) {
        return new PierreStatusComponent(theme, "Writing...", "pending");
      }

      const error = getErrorMessage(result);
      if (error) {
        return new PierreStatusComponent(theme, error, "error");
      }

      const payload = getRenderableDiffViewerPayload(result);
      if (payload) {
        return renderInlineDiff(
          payload,
          theme,
          maxVisibleLines(options.expanded),
          layout,
          context,
        );
      }

      if (originalWrite.renderResult) {
        return originalWrite.renderResult(
          result as AgentToolResult<any>,
          options,
          theme,
          context,
        );
      }

      return new PierreStatusComponent(theme, "Written", "success");
    },
  });
}

function maxVisibleLines(expanded: boolean) {
  const rows =
    typeof process.stdout.rows === "number" ? process.stdout.rows : 40;
  const expandedLimit = Math.max(8, Math.floor(rows * 0.6));
  return expanded ? expandedLimit : Math.min(expandedLimit, 12);
}

function attachDiffViewerPayload<T>(
  result: AgentToolResult<T>,
  payload: DiffViewerPayload,
): AgentToolResult<T & DiffViewerDetails> {
  return {
    ...result,
    details: {
      ...(typeof result.details === "object" && result.details
        ? result.details
        : {}),
      diffViewer: payload,
    } as T & DiffViewerDetails,
  };
}

function getDiffViewerPayload<T>(result: AgentToolResult<T>) {
  const details = result.details as (T & DiffViewerDetails) | undefined;
  return details?.diffViewer;
}

function renderInlineDiff(
  payload: DiffViewerPayload,
  theme: Theme,
  maxLines: number,
  layout: LayoutStyle,
  context: { lastComponent: unknown; invalidate: () => void },
) {
  const component =
    context.lastComponent instanceof InlineDiffComponent
      ? context.lastComponent
      : new InlineDiffComponent(
          payload,
          theme,
          maxLines,
          layout,
          context.invalidate,
        );

  component.update(payload, theme, maxLines, layout, context.invalidate);
  return component;
}

function getRenderableDiffViewerPayload<T>(result: AgentToolResult<T>) {
  return normalizeDiffViewerPayload(getDiffViewerPayload(result));
}

function normalizeDiffViewerPayload(
  payload: unknown,
): DiffViewerPayload | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const candidate = payload as Partial<DiffViewerPayload> & {
    highlighted?: Record<string, unknown>;
  };

  if (!candidate.snapshot || !candidate.metadata) {
    return undefined;
  }

  const metadata = normalizeDiffMetadataLanguage(
    candidate.metadata,
    candidate.snapshot.path,
  );
  return {
    snapshot: candidate.snapshot,
    metadata,
    highlighted: normalizeHighlightedDiffSet(candidate.highlighted),
  };
}

function normalizeHighlightedDiffSet(highlighted: unknown): HighlightedDiffSet {
  if (!highlighted || typeof highlighted !== "object") {
    return emptyHighlightedDiffSet();
  }

  const candidate = highlighted as Partial<HighlightedDiffSet>;
  return {
    dark: normalizeHighlightedDiffCode(candidate.dark),
    light: normalizeHighlightedDiffCode(candidate.light),
  };
}

function normalizeHighlightedDiffCode(
  code: unknown,
): HighlightedDiffSet["dark"] {
  if (!code || typeof code !== "object") {
    return { deletionLines: [], additionLines: [] };
  }

  const candidate = code as Partial<HighlightedDiffSet["dark"]>;
  return {
    deletionLines: Array.isArray(candidate.deletionLines)
      ? candidate.deletionLines
      : [],
    additionLines: Array.isArray(candidate.additionLines)
      ? candidate.additionLines
      : [],
  };
}

function emptyHighlightedDiffSet(): HighlightedDiffSet {
  return {
    dark: { deletionLines: [], additionLines: [] },
    light: { deletionLines: [], additionLines: [] },
  };
}

function resultLooksLikeError<T>(result: AgentToolResult<T>) {
  return Boolean(getErrorMessage(result));
}

function getErrorMessage<T>(result: AgentToolResult<T>) {
  const first = result.content[0];
  if (first?.type === "text" && first.text.startsWith("Error")) {
    return first.text.split("\n")[0];
  }
  return undefined;
}
