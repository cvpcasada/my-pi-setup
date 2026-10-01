import {
  createReadToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { createToolSummary } from "../shared/tool-summary.ts";

const toolsByCwd = new Map<
  string,
  ReturnType<typeof createReadToolDefinition>
>();

function getReadTool(cwd: string) {
  let tool = toolsByCwd.get(cwd);
  if (!tool) {
    tool = createReadToolDefinition(cwd);
    toolsByCwd.set(cwd, tool);
  }
  return tool;
}

export function formatReadForDisplay(args: Record<string, unknown>): string {
  const path =
    typeof args.path === "string" && args.path.length > 0
      ? args.path.replace(/[\r\n\t]/g, " ")
      : "…";
  const offset =
    typeof args.offset === "number" && Number.isFinite(args.offset)
      ? Math.max(1, args.offset)
      : 1;
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? args.limit
      : undefined;
  if (limit !== undefined && limit > 0)
    return `${path} (lines ${offset}–${offset + limit - 1})`;
  if (limit !== undefined) return `${path} (offset=${offset}, limit=${limit})`;
  if (offset > 1) return `${path} (from line ${offset})`;
  return path;
}

export default function readSummary(pi: ExtensionAPI) {
  pi.registerTool({
    ...getReadTool(process.cwd()),
    ...createToolSummary(pi, {
      toolName: "read",
      icon: "≡",
      runningVerb: "Reading",
      finishedVerb: "Read",
      singular: "file",
      plural: "files",
      formatArgs: formatReadForDisplay,
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getReadTool(ctx.cwd).execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
    },
  });
}
