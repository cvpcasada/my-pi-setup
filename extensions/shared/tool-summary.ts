import type {
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
  keyText,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Container,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

type Status = "queued" | "running" | "succeeded" | "failed";
type Args = Record<string, unknown>;
type ToolRenderContext = {
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  executionStarted: boolean;
  isPartial: boolean;
  expanded: boolean;
  isError: boolean;
};
type Call = {
  id: string;
  label: string;
  status: Status;
  leaderId: string;
  invalidate?: () => void;
};
type Group = { leaderId: string; callIds: string[] };

type SummaryOptions = {
  toolName: string;
  icon?: string;
  titleStyle?: "tool" | "muted";
  runningVerb: string;
  finishedVerb: string;
  singular: string;
  plural: string;
  formatArgs: (args: Args) => string;
};

/** Runs within one assistant message; other tools are hard boundaries. */
export function collectToolRuns(
  content: AssistantMessage["content"],
  toolName: string,
): ToolCall[][] {
  const runs: ToolCall[][] = [];
  let current: ToolCall[] = [];
  const flush = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const item of content) {
    if (item.type !== "toolCall") continue;
    if (item.name === toolName) current.push(item);
    else flush();
  }
  flush();
  return runs;
}

class GroupComponent implements Component {
  constructor(
    private group: Group,
    private readonly getCall: (id: string) => Call | undefined,
    private readonly options: SummaryOptions,
    private theme: Theme,
    private expanded: boolean,
  ) {}

  update(group: Group, theme: Theme, expanded: boolean): void {
    this.group = group;
    this.theme = theme;
    this.expanded = expanded;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const calls = this.group.callIds
      .map(this.getCall)
      .filter((call): call is Call => call !== undefined);
    if (calls.length === 0) return [];

    const running = calls.some(
      (call) => call.status === "queued" || call.status === "running",
    );
    const failed = calls.filter((call) => call.status === "failed").length;
    const box = new Box(width > 2 ? 1 : 0, 1, (text) =>
      this.theme.bg(failed > 0 ? "toolErrorBg" : "toolSuccessBg", text),
    );
    box.addChild({
      render: (contentWidth) => {
        const { icon, runningVerb, finishedVerb, singular, plural } =
          this.options;
        const verb = running ? runningVerb : finishedVerb;
        const noun = calls.length === 1 ? singular : plural;
        let header = icon ? this.theme.fg("toolTitle", `${icon}  `) : "";
        header +=
          this.options.titleStyle === "tool"
            ? this.theme.fg("toolTitle", this.theme.bold(verb)) +
              this.theme.fg("muted", ` ${calls.length} ${noun}`)
            : this.theme.fg("muted", `${verb} ${calls.length} ${noun}`);
        if (failed > 0) header += this.theme.fg("error", ` · ${failed} failed`);
        if (!this.expanded) {
          const expandKey = keyText("app.tools.expand") || "ctrl+o";
          header += this.theme.fg("dim", ` · ${expandKey}`);
          header += this.theme.fg("muted", " to expand");
        }
        const lines = [truncateToWidth(header, contentWidth, "…")];
        if (!this.expanded) return lines;
        for (const call of calls) {
          const marker =
            call.status === "failed"
              ? this.theme.fg("error", "! ")
              : call.status === "queued" || call.status === "running"
                ? this.theme.fg("warning", "… ")
                : "  ";
          lines.push(
            truncateToWidth(
              `${marker}${this.theme.fg("muted", call.label)}`,
              contentWidth,
              "…",
            ),
          );
        }
        return lines;
      },
      invalidate: () => {},
    });
    return box.render(width);
  }

  invalidate(): void {}
}

class GroupRegistry {
  private readonly calls = new Map<string, Call>();
  private readonly groups = new Map<string, Group>();

  constructor(private readonly options: SummaryOptions) {}

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
      if (message.role === "assistant") this.processAssistant(message, false);
      else if (message.role === "toolResult")
        this.processResult(message, false);
    }
    this.markUnresolvedFailed();

    const callbacks = new Set<() => void>();
    for (const [id, invalidate] of previousInvalidators) {
      const call = this.calls.get(id);
      if (!call) continue;
      call.invalidate = invalidate;
      callbacks.add(invalidate);
    }
    for (const invalidate of callbacks) invalidate();
  }

  processAssistant(message: AssistantMessage, notify = true): void {
    const affected = new Set<string>();
    for (const run of collectToolRuns(message.content, this.options.toolName)) {
      const leaderId = run[0]?.id;
      if (!leaderId) continue;
      let group = this.groups.get(leaderId);
      if (!group) {
        group = { leaderId, callIds: [] };
        this.groups.set(leaderId, group);
      }
      for (const id of group.callIds) affected.add(id);
      group.callIds = run.map((call) => call.id);
      for (const toolCall of run) {
        const call = this.ensureCall(toolCall.id, toolCall.arguments);
        if (call.leaderId !== leaderId) {
          const oldGroup = this.groups.get(call.leaderId);
          if (oldGroup) {
            oldGroup.callIds = oldGroup.callIds.filter((id) => id !== call.id);
            if (oldGroup.callIds.length === 0)
              this.groups.delete(call.leaderId);
          }
          affected.add(call.leaderId);
          call.leaderId = leaderId;
        }
        call.label = this.options.formatArgs(toolCall.arguments ?? {});
        affected.add(call.id);
      }
      affected.add(leaderId);
    }
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      for (const item of message.content) {
        if (item.type !== "toolCall" || item.name !== this.options.toolName)
          continue;
        const call = this.ensureCall(item.id, item.arguments);
        call.status = "failed";
        affected.add(call.leaderId);
      }
    }
    if (notify) this.invalidateCalls(affected);
  }

  processResult(message: ToolResultMessage, notify = true): void {
    if (
      message.toolName !== this.options.toolName &&
      !this.calls.has(message.toolCallId)
    )
      return;
    this.updateStatus(
      message.toolCallId,
      message.isError ? "failed" : "succeeded",
      undefined,
      notify,
    );
  }

  updateStatus(id: string, status: Status, args?: Args, notify = true): void {
    const call = this.ensureCall(id, args);
    if (args !== undefined) call.label = this.options.formatArgs(args);
    const terminal = call.status === "succeeded" || call.status === "failed";
    if (!(terminal && (status === "queued" || status === "running")))
      call.status = status;
    if (notify) this.invalidateCalls([call.leaderId]);
  }

  markUnresolvedFailed(): void {
    const affected = new Set<string>();
    for (const call of this.calls.values()) {
      if (call.status !== "queued" && call.status !== "running") continue;
      call.status = "failed";
      affected.add(call.leaderId);
    }
    this.invalidateCalls(affected);
  }

  renderCall(args: Args, theme: Theme, context: ToolRenderContext): Component {
    const call = this.ensureCall(context.toolCallId, args);
    call.label = this.options.formatArgs(args);
    call.invalidate = context.invalidate;
    if (context.isError) call.status = "failed";
    else if (call.status !== "succeeded" && call.status !== "failed") {
      if (context.executionStarted)
        call.status = context.isPartial ? "running" : "succeeded";
    }
    const group = this.groups.get(call.leaderId);
    if (!group || group.leaderId !== call.id) return new Container();
    const component =
      context.lastComponent instanceof GroupComponent
        ? context.lastComponent
        : new GroupComponent(
            group,
            (id) => this.calls.get(id),
            this.options,
            theme,
            context.expanded,
          );
    component.update(group, theme, context.expanded);
    return component;
  }

  private ensureCall(id: string, args: Args = {}): Call {
    let call = this.calls.get(id);
    if (call) return call;
    call = {
      id,
      label: this.options.formatArgs(args),
      status: "queued",
      leaderId: id,
    };
    this.calls.set(id, call);
    if (!this.groups.has(id))
      this.groups.set(id, { leaderId: id, callIds: [id] });
    return call;
  }

  private invalidateCalls(ids: Iterable<string>): void {
    const callbacks = new Set<() => void>();
    for (const id of ids) {
      const call = this.calls.get(id);
      if (call?.invalidate) callbacks.add(call.invalidate);
      const leader = call ? this.calls.get(call.leaderId) : this.calls.get(id);
      if (leader?.invalidate) callbacks.add(leader.invalidate);
    }
    for (const invalidate of callbacks) invalidate();
  }
}

/** Presentation only: callers retain their original tool schema and execution. */
export function createToolSummary(pi: ExtensionAPI, options: SummaryOptions) {
  const registry = new GroupRegistry(options);
  pi.on("session_start", (_event, ctx) => registry.rebuild(ctx));
  pi.on("session_tree", (_event, ctx) => registry.rebuild(ctx));
  pi.on("session_compact", (_event, ctx) => registry.rebuild(ctx));
  pi.on("session_shutdown", () => registry.reset());
  pi.on("message_update", (event) => {
    if (event.message.role === "assistant")
      registry.processAssistant(event.message);
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant")
      registry.processAssistant(event.message);
    else if (event.message.role === "toolResult")
      registry.processResult(event.message);
  });
  pi.on("tool_execution_start", (event) => {
    if (event.toolName === options.toolName && !event.parentToolCallId)
      registry.updateStatus(event.toolCallId, "running", event.args);
  });
  pi.on("tool_execution_update", (event) => {
    if (event.toolName === options.toolName && !event.parentToolCallId)
      registry.updateStatus(event.toolCallId, "running", event.args);
  });
  pi.on("tool_execution_end", (event) => {
    if (event.toolName === options.toolName && !event.parentToolCallId)
      registry.updateStatus(
        event.toolCallId,
        event.isError ? "failed" : "succeeded",
      );
  });
  pi.on("agent_end", () => registry.markUnresolvedFailed());

  return {
    renderShell: "self" as const,
    renderCall: (args: Args, theme: Theme, context: ToolRenderContext) =>
      registry.renderCall(args, theme, context),
    renderResult: (
      _result: unknown,
      _options: unknown,
      _theme: Theme,
      context: ToolRenderContext,
    ) =>
      context.lastComponent instanceof Container
        ? context.lastComponent
        : new Container(),
  };
}
