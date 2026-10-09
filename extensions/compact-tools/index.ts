/**
 * Compact Tools
 * Draws every tool call as one line: icon, title, args, status, chevron.
 * Expanding a row (click or app.tools.expand) shows the original renderer's result.
 */

import { isAbsolute, relative } from "node:path";
import type {
  ExtensionAPI,
  Theme,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component } from "@earendil-works/pi-tui";
import { compactRow } from "../shared/compact-row.ts";

type Args = Record<string, any>;
type ToolRenderContext = Parameters<
  NonNullable<ToolRenderers["renderCall"]>
>[2];

// Nerd Font codicons (bundled with Ghostty).
const ICONS: Record<string, string> = {
  read: "\uea7b",
  write: "\uea7f",
  edit: "\uea73",
  bash: "\uea85",
  grep: "\uea6d",
  find: "\uea6d",
  search: "\uea6d",
  ls: "\uea83",
  scrape: "\ueb01",
  crawl: "\ueb01",
  ask_user: "\ueb32",
};
const DEFAULT_ICON = "\ueb6d";
const INNER = Symbol("compact-tools");

function shortPath(path: unknown, cwd: string): string {
  if (typeof path !== "string" || !path) return "";
  return isAbsolute(path) ? relative(cwd, path) || "." : path;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function summarize(toolName: string, args: Args, cwd: string): string {
  switch (toolName) {
    case "read": {
      let text = shortPath(args.path, cwd);
      if (args.offset !== undefined || args.limit !== undefined) {
        const start = args.offset ?? 1;
        text += `:${start}`;
        if (args.limit !== undefined) text += `-${start + args.limit - 1}`;
      }
      return text;
    }
    case "edit":
    case "write":
      return shortPath(args.path, cwd);
    case "ls":
      return shortPath(args.path, cwd) || ".";
    case "bash":
      return oneLine(String(args.command ?? ""));
    case "grep":
    case "find": {
      const where = shortPath(args.path, cwd);
      return oneLine(`${args.pattern ?? ""}${where ? ` in ${where}` : ""}`);
    }
  }
  for (const key of ["path", "command", "query", "url", "question", "id"]) {
    if (typeof args[key] === "string")
      return key === "path" ? shortPath(args[key], cwd) : oneLine(args[key]);
  }
  const first = Object.values(args ?? {}).find((v) => typeof v === "string");
  return first ? oneLine(first) : "";
}

function title(toolName: string): string {
  if (toolName === "bash") return "";
  const words = toolName.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function header(
  toolName: string,
  args: Args,
  theme: Theme,
  ctx: ToolRenderContext,
): Component {
  const status = ctx.isError ? "error" : ctx.isPartial ? "running" : "done";
  return compactRow(
    ICONS[toolName] ?? DEFAULT_ICON,
    title(toolName),
    summarize(toolName, args ?? {}, ctx.cwd),
    status,
    ctx.expanded,
    theme,
    ctx.outputPad,
  );
}

function textOutput(result: { content: any[] }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setHiddenThinkingLabel("✦ Thought ›");
  });

  pi.registerToolRenderer((toolName, next) => {
    const inner = next();
    return {
      renderShell: "self",
      renderCall: (args, theme, ctx) =>
        header(toolName, args as Args, theme, ctx),
      renderResult(result, options, theme, ctx) {
        if (!options.expanded || options.isPartial) return new Container();

        // Inner renderers reuse their own previous component, not ours.
        const state = (ctx.state[INNER] ??= {}) as { last?: Component };
        let body: Component;
        if (inner?.renderResult) {
          body = inner.renderResult(result, options, theme, {
            ...ctx,
            lastComponent: state.last,
          });
          state.last = body;
        } else {
          const text = textOutput(result);
          if (!text) return new Container();
          body = new Text(theme.fg("toolOutput", text), 0, 0);
        }
        if (inner?.renderShell === "self") return body;

        const box = new Box(ctx.outputPad, 1, (s) =>
          theme.bg(ctx.isError ? "toolErrorBg" : "toolSuccessBg", s),
        );
        box.addChild(body);
        return box;
      },
    };
  });
}
