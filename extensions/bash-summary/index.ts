import type {
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  keyText,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Container,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

type CommandStatus = "queued" | "running" | "succeeded" | "failed";

type BashArgs = {
  command?: unknown;
};

type BashRenderContext = {
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  executionStarted: boolean;
  isPartial: boolean;
  expanded: boolean;
  isError: boolean;
};

type CommandCall = {
  id: string;
  command: string;
  status: CommandStatus;
  groupLeaderId: string;
  invalidate?: () => void;
};

type CommandGroup = {
  leaderId: string;
  callIds: string[];
};

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
  const runs: ToolCall[][] = [];
  let current: ToolCall[] = [];

  const flush = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };

  for (const item of content) {
    if (item.type !== "toolCall") continue;

    if (item.name === "bash") {
      current.push(item);
    } else {
      flush();
    }
  }

  flush();
  return runs;
}

class CommandGroupComponent implements Component {
  constructor(
    private group: CommandGroup,
    private readonly getCall: (id: string) => CommandCall | undefined,
    private theme: Theme,
    private expanded: boolean,
  ) {}

  update(group: CommandGroup, theme: Theme, expanded: boolean): void {
    this.group = group;
    this.theme = theme;
    this.expanded = expanded;
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    const calls = this.group.callIds
      .map((id) => this.getCall(id))
      .filter((call): call is CommandCall => call !== undefined);
    if (calls.length === 0) return [];

    const isRunning = calls.some(
      (call) => call.status === "queued" || call.status === "running",
    );
    const failed = calls.filter((call) => call.status === "failed").length;
    const background = failed > 0 ? "toolErrorBg" : "toolSuccessBg";

    const box = new Box(1, 1, (text) => this.theme.bg(background, text));
    box.addChild({
      render: (contentWidth) =>
        this.renderContent(contentWidth, calls, isRunning, failed),
      invalidate: () => {},
    });
    return box.render(width);
  }

  invalidate(): void {}

  private renderContent(
    width: number,
    calls: CommandCall[],
    isRunning: boolean,
    failed: number,
  ): string[] {
    const count = calls.length;
    const verb = isRunning ? "Running" : "Ran";
    const noun = count === 1 ? "command" : "commands";

    let header = this.theme.fg("toolTitle", "›_  ");
    header += this.theme.fg("muted", `${verb} ${count} ${noun}`);
    if (failed > 0) {
      header += this.theme.fg("error", ` · ${failed} failed`);
    }
    if (!this.expanded) {
      const expandKey = keyText("app.tools.expand") || "ctrl+o";
      header += this.theme.fg("dim", ` · ${expandKey}`);
      header += this.theme.fg("muted", " to expand");
    }

    const lines = [truncateToWidth(header, width, "…")];
    if (!this.expanded) return lines;

    for (const call of calls) {
      let marker: string;
      if (call.status === "failed") {
        marker = this.theme.fg("error", "! ");
      } else if (call.status === "queued" || call.status === "running") {
        marker = this.theme.fg("warning", "… ");
      } else {
        marker = "  ";
      }

      const command = this.theme.fg("muted", call.command);
      lines.push(truncateToWidth(`${marker}${command}`, width, "…"));
    }

    return lines;
  }
}

class CommandGroupRegistry {
  private readonly calls = new Map<string, CommandCall>();
  private readonly groups = new Map<string, CommandGroup>();

  reset(): void {
    this.calls.clear();
    this.groups.clear();
  }

  rebuild(ctx: ExtensionContext): void {
    const previousInvalidators = new Map(
      [...this.calls].flatMap(([id, call]) =>
        call.invalidate ? [[id, call.invalidate] as const] : [],
      ),
    );
    this.reset();

    const messages = ctx.sessionManager
      .buildContextEntries()
      .flatMap((entry) => sessionEntryToContextMessages(entry));

    for (const message of messages) {
      if (message.role === "assistant") {
        this.processAssistantMessage(message, false);
      } else if (message.role === "toolResult") {
        this.processToolResult(message, false);
      }
    }

    for (const call of this.calls.values()) {
      if (call.status === "queued" || call.status === "running") {
        call.status = "failed";
      }
    }

    const retainedInvalidators = new Set<() => void>();
    for (const [id, invalidate] of previousInvalidators) {
      const call = this.calls.get(id);
      if (!call) continue;
      call.invalidate = invalidate;
      retainedInvalidators.add(invalidate);
    }
    for (const invalidate of retainedInvalidators) invalidate();
  }

  processAssistantMessage(message: AssistantMessage, notify = true): void {
    const affected = new Set<string>();

    for (const run of collectBashRuns(message.content)) {
      const leaderId = run[0]?.id;
      if (!leaderId) continue;

      let group = this.groups.get(leaderId);
      if (!group) {
        group = { leaderId, callIds: [] };
        this.groups.set(leaderId, group);
      }

      const nextCallIds = run.map((toolCall) => toolCall.id);
      for (const oldCallId of group.callIds) affected.add(oldCallId);
      group.callIds = nextCallIds;

      for (const toolCall of run) {
        const call = this.ensureCall(toolCall.id, toolCall.arguments?.command);
        const previousLeaderId = call.groupLeaderId;

        if (previousLeaderId !== leaderId) {
          this.detachFromGroup(call.id, previousLeaderId);
          affected.add(previousLeaderId);
          call.groupLeaderId = leaderId;
        }

        call.command = formatCommandForDisplay(toolCall.arguments?.command);
        affected.add(call.id);
      }

      affected.add(leaderId);
    }

    if (message.stopReason === "aborted" || message.stopReason === "error") {
      for (const item of message.content) {
        if (item.type !== "toolCall" || item.name !== "bash") continue;
        const call = this.ensureCall(item.id, item.arguments?.command);
        call.status = "failed";
        affected.add(call.groupLeaderId);
      }
    }

    if (notify) this.invalidateCalls(affected);
  }

  processToolResult(message: ToolResultMessage, notify = true): void {
    if (message.toolName !== "bash" && !this.calls.has(message.toolCallId)) {
      return;
    }

    this.updateStatus(
      message.toolCallId,
      message.isError ? "failed" : "succeeded",
      undefined,
      notify,
    );
  }

  updateStatus(
    id: string,
    status: CommandStatus,
    command?: unknown,
    notify = true,
  ): void {
    const call = this.ensureCall(id, command);
    if (command !== undefined) {
      call.command = formatCommandForDisplay(command);
    }

    const isTerminal = call.status === "succeeded" || call.status === "failed";
    const isNonTerminalUpdate = status === "queued" || status === "running";
    if (!(isTerminal && isNonTerminalUpdate)) {
      call.status = status;
    }

    if (notify) this.invalidateGroup(call.groupLeaderId);
  }

  markUnresolvedFailed(): void {
    const affected = new Set<string>();

    for (const call of this.calls.values()) {
      if (call.status !== "queued" && call.status !== "running") continue;
      call.status = "failed";
      affected.add(call.groupLeaderId);
    }

    this.invalidateCalls(affected);
  }

  renderCall(
    args: BashArgs,
    theme: Theme,
    context: BashRenderContext,
  ): Component {
    const call = this.ensureCall(context.toolCallId, args.command);
    call.command = formatCommandForDisplay(args.command);
    call.invalidate = context.invalidate;

    if (context.isError) {
      call.status = "failed";
    } else if (context.executionStarted && context.isPartial) {
      if (call.status !== "succeeded" && call.status !== "failed") {
        call.status = "running";
      }
    } else if (context.executionStarted && !context.isPartial) {
      call.status = "succeeded";
    }

    const group = this.groups.get(call.groupLeaderId);
    if (!group || group.leaderId !== call.id) return new Container();

    const previous = context.lastComponent;
    const component =
      previous instanceof CommandGroupComponent
        ? previous
        : new CommandGroupComponent(
            group,
            (id) => this.calls.get(id),
            theme,
            context.expanded,
          );
    component.update(group, theme, context.expanded);
    return component;
  }

  private ensureCall(id: string, command?: unknown): CommandCall {
    let call = this.calls.get(id);
    if (call) return call;

    call = {
      id,
      command: formatCommandForDisplay(command),
      status: "queued",
      groupLeaderId: id,
    };
    this.calls.set(id, call);
    if (!this.groups.has(id)) {
      this.groups.set(id, { leaderId: id, callIds: [id] });
    }
    return call;
  }

  private detachFromGroup(id: string, leaderId: string): void {
    const group = this.groups.get(leaderId);
    if (!group) return;

    group.callIds = group.callIds.filter((callId) => callId !== id);
    if (group.callIds.length === 0) this.groups.delete(leaderId);
  }

  private invalidateGroup(leaderId: string): void {
    this.calls.get(leaderId)?.invalidate?.();
  }

  private invalidateCalls(ids: Iterable<string>): void {
    const callbacks = new Set<() => void>();

    for (const id of ids) {
      const call = this.calls.get(id);
      if (call?.invalidate) callbacks.add(call.invalidate);
      const leader = call
        ? this.calls.get(call.groupLeaderId)
        : this.calls.get(id);
      if (leader?.invalidate) callbacks.add(leader.invalidate);
    }

    for (const invalidate of callbacks) invalidate();
  }
}

export default function bashSummary(pi: ExtensionAPI) {
  const original = getBashTool(process.cwd());
  const registry = new CommandGroupRegistry();

  pi.on("session_start", (_event, ctx) => {
    registry.rebuild(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    registry.rebuild(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    registry.rebuild(ctx);
  });

  pi.on("session_shutdown", () => {
    registry.reset();
  });

  pi.on("message_update", (event) => {
    if (event.message.role === "assistant") {
      registry.processAssistantMessage(event.message);
    }
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      registry.processAssistantMessage(event.message);
    } else if (event.message.role === "toolResult") {
      registry.processToolResult(event.message);
    }
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName === "bash") {
      registry.updateStatus(event.toolCallId, "running", event.args?.command);
    }
  });

  pi.on("tool_execution_update", (event) => {
    if (event.toolName === "bash") {
      registry.updateStatus(event.toolCallId, "running", event.args?.command);
    }
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName === "bash") {
      registry.updateStatus(
        event.toolCallId,
        event.isError ? "failed" : "succeeded",
      );
    }
  });

  pi.on("agent_end", () => {
    registry.markUnresolvedFailed();
  });

  pi.registerTool({
    ...original,
    renderShell: "self",

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBashTool(ctx.cwd).execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
    },

    renderCall(args, theme, context) {
      return registry.renderCall(args, theme, context);
    },

    renderResult(_result, _options, _theme, context) {
      return context.lastComponent instanceof Container
        ? context.lastComponent
        : new Container();
    },
  });
}
