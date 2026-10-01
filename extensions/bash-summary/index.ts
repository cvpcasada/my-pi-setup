import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import {
  createBashToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { collectToolRuns, createToolSummary } from "../shared/tool-summary.ts";

const toolsByCwd = new Map<
  string,
  ReturnType<typeof createBashToolDefinition>
>();

function getBashTool(cwd: string) {
  let tool = toolsByCwd.get(cwd);
  if (!tool) {
    tool = createBashToolDefinition(cwd);
    toolsByCwd.set(cwd, tool);
  }
  return tool;
}

export function formatCommandForDisplay(command: unknown): string {
  if (typeof command !== "string") return "…";
  const flattened = command
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join(" ↵ ")
    .trim();
  return flattened || "…";
}

export function collectBashRuns(
  content: AssistantMessage["content"],
): ToolCall[][] {
  return collectToolRuns(content, "bash");
}

export default function bashSummary(pi: ExtensionAPI) {
  pi.registerTool({
    ...getBashTool(process.cwd()),
    ...createToolSummary(pi, {
      toolName: "bash",
      icon: "›_",
      runningVerb: "Running",
      finishedVerb: "Ran",
      singular: "command",
      plural: "commands",
      formatArgs: (args) => formatCommandForDisplay(args.command),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashTool(ctx.cwd).execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
    },
  });
}
