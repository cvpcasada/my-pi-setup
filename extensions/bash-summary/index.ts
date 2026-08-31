import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

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

function getTextOutput(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter(
      (item): item is { type: "text"; text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");
}

export function countOutputLines(output: string): number {
  if (!output || output === "(no output)") return 0;
  return output.replace(/\n+$/, "").split("\n").length;
}

export default function bashSummary(pi: ExtensionAPI) {
  const original = getBashTool(process.cwd());

  pi.registerTool({
    ...original,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashTool(ctx.cwd).execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
    },

    renderResult(result, options, theme, context) {
      const output = getTextOutput(result.content);
      const lineCount = countOutputLines(output);

      if (options.expanded) {
        if (!output || output === "(no output)") {
          return new Text(theme.fg("muted", "↳ no output"), 0, 0);
        }

        const color = context.isError ? "error" : "toolOutput";
        const rendered = output
          .split("\n")
          .map((line) => theme.fg(color, line))
          .join("\n");
        return new Text(`\n${rendered}`, 0, 0);
      }

      if (options.isPartial) {
        const progress =
          lineCount === 0
            ? "running"
            : `running · ${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
        return new Text(theme.fg("muted", `↳ ${progress}`), 0, 0);
      }

      if (lineCount === 0) {
        const summary = context.isError ? "failed" : "no output";
        return new Text(
          theme.fg(context.isError ? "error" : "muted", `↳ ${summary}`),
          0,
          0,
        );
      }

      const status = context.isError ? "failed · " : "";
      const lines = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
      const hint = keyHint("app.tools.expand", "to expand");
      const summary = `↳ ${status}${lines} · ${hint}`;
      return new Text(
        theme.fg(context.isError ? "error" : "muted", summary),
        0,
        0,
      );
    },
  });
}
