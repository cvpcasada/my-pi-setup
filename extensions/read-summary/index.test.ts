import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  createReadToolDefinition,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { collectToolRuns } from "../shared/tool-summary.ts";
import readSummary, { formatReadForDisplay } from "./index.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as Theme;

function call(id: string, path = `${id}.ts`, name = "read") {
  return { type: "toolCall" as const, id, name, arguments: { path } };
}

function message(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason: "toolUse",
  } as AssistantMessage;
}

function harness() {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  let tool: any;
  readSummary({
    on(event: string, handler: (...args: any[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(definition: any) {
      tool = definition;
    },
  } as unknown as ExtensionAPI);
  return {
    tool,
    emit(event: string, value: unknown, ctx?: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(value, ctx);
    },
  };
}

function context(id: string, overrides: Record<string, unknown> = {}) {
  return {
    toolCallId: id,
    args: {},
    state: {},
    cwd: process.cwd(),
    invalidate: () => {},
    lastComponent: undefined,
    executionStarted: false,
    argsComplete: true,
    isPartial: true,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  };
}

function lines(component: Component, width = 80): string[] {
  return component
    .render(width)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(1));
}

function result(id: string, isError = false) {
  return {
    role: "toolResult",
    toolName: "read",
    toolCallId: id,
    content: [{ type: "text", text: isError ? "missing file" : "contents" }],
    isError,
  };
}

function restore(
  h: ReturnType<typeof harness>,
  entries: unknown[],
  event = "session_start",
) {
  h.emit(event, {}, { sessionManager: { buildContextEntries: () => entries } });
}

test("formats file paths and optional requested line ranges", () => {
  assert.equal(formatReadForDisplay({ path: "src/main.ts" }), "src/main.ts");
  assert.equal(
    formatReadForDisplay({ path: "a", offset: 5, limit: 10 }),
    "a (lines 5–14)",
  );
  assert.equal(formatReadForDisplay({ path: "a", limit: 3 }), "a (lines 1–3)");
  assert.equal(
    formatReadForDisplay({ path: "a", offset: 2001 }),
    "a (from line 2001)",
  );
  assert.equal(
    formatReadForDisplay({ path: "a", offset: null, limit: null }),
    "a",
  );
  assert.equal(
    formatReadForDisplay({ path: "a", limit: 0 }),
    "a (offset=1, limit=0)",
  );
  assert.equal(formatReadForDisplay({}), "…");
  assert.equal(formatReadForDisplay({ path: "a\nb\tc" }), "a b c");
});

test("groups read runs but never crosses another tool", () => {
  const content = [
    call("a"),
    { type: "thinking" as const, thinking: "next file" },
    call("b"),
    call("bash", "ignored", "bash"),
    call("c"),
  ];
  assert.deepEqual(
    collectToolRuns(content, "read").map((run) => run.map((c) => c.id)),
    [["a", "b"], ["c"]],
  );
});

test("collapses a streaming read run, expands paths and ranges, and updates on out-of-order results", () => {
  const h = harness();
  h.emit("message_update", { message: message([call("a")]) });
  let invalidations = 0;
  const ctx = context("a", { invalidate: () => invalidations++ });
  const leader = h.tool.renderCall({ path: "a.ts" }, theme, ctx) as Component;
  assert.deepEqual(lines(leader), ["≡  Reading 1 file · ctrl+o to expand"]);
  h.emit("message_update", {
    message: message([
      call("a"),
      { ...call("b"), arguments: { path: "b.ts", offset: 20, limit: 10 } },
    ]),
  });
  assert.ok(invalidations > 0);
  assert.deepEqual(lines(leader), ["≡  Reading 2 files · ctrl+o to expand"]);
  const expanded = h.tool.renderCall(
    { path: "a.ts" },
    theme,
    context("a", { expanded: true, lastComponent: leader }),
  ) as Component;
  assert.equal(expanded, leader);
  assert.deepEqual(lines(expanded), [
    "≡  Reading 2 files",
    "… a.ts",
    "… b.ts (lines 20–29)",
  ]);
  const follower = h.tool.renderCall(
    { path: "b.ts", offset: 20, limit: 10 },
    theme,
    context("b", { expanded: true }),
  ) as Component;
  assert.deepEqual(follower.render(80), []);
  assert.deepEqual(
    h.tool.renderResult(result("b"), {}, theme, context("b")).render(80),
    [],
  );
  h.emit("tool_execution_end", {
    toolName: "read",
    toolCallId: "b",
    isError: true,
  });
  h.emit("tool_execution_start", {
    toolName: "read",
    toolCallId: "b",
    args: { path: "b.ts", offset: 20, limit: 10 },
  });
  assert.deepEqual(lines(expanded), [
    "≡  Reading 2 files · 1 failed",
    "… a.ts",
    "! b.ts (lines 20–29)",
  ]);
  h.emit("message_end", { message: result("a") });
  assert.deepEqual(lines(expanded), [
    "≡  Read 2 files · 1 failed",
    "  a.ts",
    "! b.ts (lines 20–29)",
  ]);
  assert.deepEqual(expanded.render(0), []);
  for (const width of [1, 2, 4, 16, 80])
    assert.ok(
      expanded.render(width).every((line) => visibleWidth(line) <= width),
    );
});

test("separate assistant messages and mixed tools produce separate summaries", () => {
  const h = harness();
  h.emit("message_end", {
    message: message([call("a"), call("x", "", "bash"), call("b")]),
  });
  h.emit("message_end", { message: message([call("c")]) });
  for (const id of ["a", "b", "c"])
    assert.deepEqual(
      lines(h.tool.renderCall({ path: `${id}.ts` }, theme, context(id))),
      ["≡  Reading 1 file · ctrl+o to expand"],
    );
});

test("restores status on session load, tree change and compaction, retaining invalidators", () => {
  for (const event of ["session_start", "session_tree", "session_compact"]) {
    const h = harness();
    let invalidations = 0;
    h.tool.renderCall(
      { path: "a.ts" },
      theme,
      context("a", { invalidate: () => invalidations++ }),
    );
    restore(
      h,
      [
        {
          type: "message",
          message: message([call("a"), call("b"), call("interrupted")]),
        },
        { type: "message", message: result("a") },
        { type: "message", message: result("b", true) },
      ],
      event,
    );
    assert.ok(invalidations > 0);
    const component = h.tool.renderCall(
      { path: "a.ts" },
      theme,
      context("a", {
        expanded: true,
        executionStarted: true,
        isPartial: false,
      }),
    );
    assert.deepEqual(lines(component), [
      "≡  Read 3 files · 2 failed",
      "  a.ts",
      "! b.ts",
      "! interrupted.ts",
    ]);
    // A reconstructed failure must not be erased by a successful-looking render context.
    h.tool.renderCall(
      { path: "interrupted.ts" },
      theme,
      context("interrupted", { executionStarted: true, isPartial: false }),
    );
    assert.deepEqual(lines(component), [
      "≡  Read 3 files · 2 failed",
      "  a.ts",
      "! b.ts",
      "! interrupted.ts",
    ]);
  }
});

test("abort and agent end finish unresolved reads; shutdown clears grouping", () => {
  const h = harness();
  h.emit("message_end", {
    message: { ...message([call("a"), call("b")]), stopReason: "aborted" },
  });
  const leader = h.tool.renderCall({ path: "a.ts" }, theme, context("a"));
  assert.deepEqual(lines(leader), [
    "≡  Read 2 files · 2 failed · ctrl+o to expand",
  ]);
  h.emit("session_shutdown", {});
  h.emit("message_end", { message: message([call("c")]) });
  h.emit("agent_end", {});
  assert.deepEqual(
    lines(h.tool.renderCall({ path: "c.ts" }, theme, context("c"))),
    ["≡  Read 1 file · 1 failed · ctrl+o to expand"],
  );
});

test("nested reads and unrelated execution events do not affect transcript groups", () => {
  const h = harness();
  h.emit("message_end", { message: message([call("a"), call("b")]) });
  const leader = h.tool.renderCall({ path: "a.ts" }, theme, context("a"));
  h.emit("tool_execution_start", {
    toolName: "read",
    toolCallId: "parent/1",
    parentToolCallId: "parent",
    args: { path: "nested.ts" },
  });
  h.emit("tool_execution_end", {
    toolName: "read",
    toolCallId: "parent/1",
    parentToolCallId: "parent",
    isError: true,
  });
  h.emit("tool_execution_end", {
    toolName: "bash",
    toolCallId: "a",
    isError: true,
  });
  h.emit("message_end", { message: result("a") });
  h.emit("message_end", { message: result("b") });
  assert.deepEqual(lines(leader), ["≡  Read 2 files · ctrl+o to expand"]);
});

test("delegates execution unchanged, including cwd, ranges, truncation, errors, cancellation and images", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "read-summary-"));
  try {
    const h = harness();
    const original = createReadToolDefinition(cwd);
    await writeFile(join(cwd, "file.txt"), "one\ntwo\nthree\nfour");
    await writeFile(
      join(cwd, "large.txt"),
      Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n"),
    );
    await writeFile(
      join(cwd, "image.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const ctx = { cwd } as any;
    assert.deepEqual(h.tool.parameters, original.parameters);
    assert.equal(h.tool.description, original.description);
    for (const params of [
      { path: "file.txt", offset: 2, limit: 2 },
      { path: "large.txt" },
      { path: "image.png" },
    ]) {
      assert.deepEqual(
        await h.tool.execute("id", params, undefined, undefined, ctx),
        await original.execute("id", params, undefined, undefined, ctx),
      );
    }
    await assert.rejects(
      h.tool.execute("missing", { path: "missing" }, undefined, undefined, ctx),
      /ENOENT/,
    );
    await assert.rejects(
      h.tool.execute(
        "aborted",
        { path: "file.txt" },
        AbortSignal.abort(),
        undefined,
        ctx,
      ),
      /aborted/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
