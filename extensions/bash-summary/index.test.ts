import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import bashSummary, {
  collectBashRuns,
  formatCommandForDisplay,
} from "./index.ts";

function assistantMessage(
  content: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason: "toolUse",
  } as AssistantMessage;
}

function toolCall(id: string, name: string, command: string) {
  return {
    type: "toolCall" as const,
    id,
    name,
    arguments: { command },
  };
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as Theme;

function renderedContent(component: Component, width = 80): string[] {
  return component
    .render(width)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(1));
}

function renderContext(
  toolCallId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    args: {},
    toolCallId,
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: false,
    argsComplete: true,
    isPartial: true,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  };
}

test("formats each bash invocation onto one display line", () => {
  assert.equal(
    formatCommandForDisplay("  printf foo\r\n  printf bar  "),
    "printf foo ↵ printf bar",
  );
  assert.equal(formatCommandForDisplay(""), "…");
  assert.equal(formatCommandForDisplay(undefined), "…");
});

test("groups maximal bash runs and lets non-bash tools split them", () => {
  const message = assistantMessage([
    { type: "text", text: "Running checks" },
    toolCall("bash-1", "bash", "one"),
    { type: "thinking", thinking: "still part of the same run" },
    toolCall("bash-2", "bash", "two"),
    toolCall("read-1", "read", "ignored"),
    toolCall("bash-3", "bash", "three"),
  ]);

  assert.deepEqual(
    collectBashRuns(message.content).map((run) => run.map((call) => call.id)),
    [["bash-1", "bash-2"], ["bash-3"]],
  );
});

test("renders one minimal row for a bash group", () => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  let bashTool: any;

  const pi = {
    on(event: string, handler: (...args: any[]) => void) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerTool(tool: any) {
      bashTool = tool;
    },
  } as unknown as ExtensionAPI;

  bashSummary(pi);

  const backgrounds: string[] = [];
  const trackedTheme = {
    ...plainTheme,
    bg: (color: string, text: string) => {
      backgrounds.push(color);
      return text;
    },
  } as Theme;

  const message = assistantMessage([
    toolCall("bash-1", "bash", "echo one\npwd"),
    toolCall("bash-2", "bash", "echo two"),
  ]);
  handlers.get("message_update")?.[0]?.({ message });

  let invalidations = 0;
  const leaderContext = renderContext("bash-1", {
    expanded: true,
    invalidate: () => invalidations++,
  });
  const followerContext = renderContext("bash-2", {
    expanded: true,
    invalidate: () => invalidations++,
  });

  const leader = bashTool.renderCall(
    { command: "echo one\npwd" },
    trackedTheme,
    leaderContext,
  ) as Component;
  const follower = bashTool.renderCall(
    { command: "echo two" },
    trackedTheme,
    followerContext,
  ) as Component;

  assert.deepEqual(renderedContent(leader), [
    "›_  Running 2 commands",
    "… echo one ↵ pwd",
    "… echo two",
  ]);
  assert.deepEqual(follower.render(80), []);
  assert.ok(backgrounds.includes("toolSuccessBg"));
  backgrounds.length = 0;

  handlers.get("tool_execution_end")?.[0]?.({
    toolName: "bash",
    toolCallId: "bash-2",
    isError: true,
  });
  assert.deepEqual(renderedContent(leader), [
    "›_  Running 2 commands · 1 failed",
    "… echo one ↵ pwd",
    "! echo two",
  ]);

  handlers.get("tool_execution_end")?.[0]?.({
    toolName: "bash",
    toolCallId: "bash-1",
    isError: false,
  });

  assert.ok(invalidations > 0);
  assert.deepEqual(renderedContent(leader), [
    "›_  Ran 2 commands · 1 failed",
    "  echo one ↵ pwd",
    "! echo two",
  ]);
  assert.ok(backgrounds.includes("toolErrorBg"));

  const collapsed = bashTool.renderCall(
    { command: "echo one\npwd" },
    trackedTheme,
    renderContext("bash-1", { lastComponent: leader }),
  ) as Component;
  assert.deepEqual(renderedContent(collapsed), [
    "›_  Ran 2 commands · 1 failed · ctrl+o to expand",
  ]);

  const narrow = leader.render(16);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 16));
});

test("reconstructs grouped command status from a restored session", () => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  let bashTool: any;

  const pi = {
    on(event: string, handler: (...args: any[]) => void) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerTool(tool: any) {
      bashTool = tool;
    },
  } as unknown as ExtensionAPI;

  bashSummary(pi);

  let invalidations = 0;
  const provisionalLeader = bashTool.renderCall(
    { command: "echo restored" },
    plainTheme,
    renderContext("bash-1", { invalidate: () => invalidations++ }),
  ) as Component;
  const provisionalFollower = bashTool.renderCall(
    { command: "false" },
    plainTheme,
    renderContext("bash-2", { invalidate: () => invalidations++ }),
  ) as Component;
  assert.deepEqual(renderedContent(provisionalLeader), [
    "›_  Running 1 command · ctrl+o to expand",
  ]);
  assert.deepEqual(renderedContent(provisionalFollower), [
    "›_  Running 1 command · ctrl+o to expand",
  ]);

  const message = assistantMessage([
    toolCall("bash-1", "bash", "echo restored"),
    toolCall("bash-2", "bash", "false"),
  ]);
  const entries = [
    { type: "message", message },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "bash-1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "bash-2",
        toolName: "bash",
        content: [{ type: "text", text: "failed" }],
        isError: true,
      },
    },
  ];

  handlers.get("session_start")?.[0]?.(
    {},
    {
      sessionManager: {
        buildContextEntries: () => entries,
      },
    },
  );

  assert.equal(invalidations, 2);

  const leader = bashTool.renderCall(
    { command: "echo restored" },
    plainTheme,
    renderContext("bash-1", {
      expanded: true,
      lastComponent: provisionalLeader,
      invalidate: () => invalidations++,
    }),
  ) as Component;
  const follower = bashTool.renderCall(
    { command: "false" },
    plainTheme,
    renderContext("bash-2", {
      expanded: true,
      lastComponent: provisionalFollower,
      invalidate: () => invalidations++,
    }),
  ) as Component;

  assert.deepEqual(renderedContent(leader), [
    "›_  Ran 2 commands · 1 failed",
    "  echo restored",
    "! false",
  ]);
  assert.deepEqual(follower.render(80), []);

  const beforeTreeChange = invalidations;
  handlers.get("session_tree")?.[0]?.(
    {},
    {
      sessionManager: {
        buildContextEntries: () => [],
      },
    },
  );
  assert.equal(invalidations, beforeTreeChange);
});

test("marks restored commands without results as failed", () => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  let bashTool: any;

  const pi = {
    on(event: string, handler: (...args: any[]) => void) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerTool(tool: any) {
      bashTool = tool;
    },
  } as unknown as ExtensionAPI;

  bashSummary(pi);

  const message = assistantMessage([
    toolCall("interrupted", "bash", "sleep 100"),
  ]);
  handlers.get("session_start")?.[0]?.(
    {},
    {
      sessionManager: {
        buildContextEntries: () => [{ type: "message", message }],
      },
    },
  );

  const component = bashTool.renderCall(
    { command: "sleep 100" },
    plainTheme,
    renderContext("interrupted", { expanded: true }),
  ) as Component;

  assert.deepEqual(renderedContent(component), [
    "›_  Ran 1 command · 1 failed",
    "! sleep 100",
  ]);
});
