import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Text,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { sanitizeText } from "./output-view.ts";

type TerminalToolName = "bg_start" | "bg_status" | "bg_list" | "bg_kill";
interface RenderContext {
  state: { summary?: string };
  args: unknown;
  isError: boolean;
}

function oneLine(text: string) {
  return sanitizeText(text).replace(/\s+/g, " ").trim();
}

/** Truncate rather than wrap so even narrow terminals get exactly one row. */
function summaryRow(text: () => string): Component {
  return {
    render: (width) => [truncateToWidth(text(), width)],
    invalidate: () => {},
  };
}

/** Pi owns Ctrl+O; its expanded flag controls whether we show the full result. */
export function createTerminalToolRenderers(name: TerminalToolName) {
  return {
    // Let Pi supply the standard padding and pending/success/error background.
    renderShell: "default" as const,
    renderCall(input: object, theme: Theme, context: RenderContext) {
      const args = input as Record<string, unknown>;
      const target =
        name === "bg_start"
          ? (args.title ?? args.command)
          : name === "bg_status"
            ? args.id
            : name === "bg_kill" && Array.isArray(args.ids)
              ? args.ids.join(", ")
              : "";
      const pending = oneLine(String(target ?? ""));
      // Read shared state at render time: renderResult runs after renderCall
      // and can replace this row without adding a second collapsed line.
      return summaryRow(
        () =>
          theme.fg(context.isError ? "error" : "toolTitle", theme.bold(name)) +
          theme.fg("muted", ` · ${context.state.summary ?? (pending || "…")}`) +
          theme.fg("dim", " (ctrl+o to expand)"),
      );
    },
    renderResult(
      result: { content: Array<{ type: string; text?: string }> },
      { expanded }: ToolRenderResultOptions,
      theme: Theme,
      context: RenderContext,
    ) {
      const output = sanitizeText(
        result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n"),
      );
      const details = (result as { details?: { terminals?: unknown[] } })
        .details;
      context.state.summary =
        name === "bg_list" && Array.isArray(details?.terminals)
          ? `${details.terminals.length} background terminal${details.terminals.length === 1 ? "" : "s"}`
          : oneLine(
              output.split("\n").find((line) => line.trim()) ?? "No output",
            );
      if (!expanded) return new Container();
      const args = sanitizeText(JSON.stringify(context.args, null, 2));
      return new Text(
        theme.fg(
          context.isError ? "error" : "toolOutput",
          `${args}\n\n${output}`,
        ),
        0,
        0,
      );
    },
  };
}
