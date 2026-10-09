import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import backgroundTerminals from "./index.ts";
import { createTerminalToolRenderers } from "./src/ui/tool-rendering.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  bg: (_color: string, text: string) => text,
} as Theme;

for (const name of ["bg_start", "bg_status", "bg_list", "bg_kill"] as const) {
  test(`${name} collapses to one row and expands full arguments/output`, () => {
    const renderer = createTerminalToolRenderers(name);
    const args = {
      id: "bt-1",
      title: "Build\nproject",
      command: "npm run build",
      ids: ["bt-1"],
    };
    const context = { args, state: {}, isError: false };
    const call = renderer.renderCall(args, theme, context);
    assert.equal(call.render(80).length, 1);
    const result = {
      content: [
        { type: "text", text: "bt-1 done\nstdout:\nall output\nlast line" },
      ],
      details: { terminals: [{ id: "bt-1" }] },
    };
    const collapsed = renderer.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      context,
    );
    assert.deepEqual(collapsed.render(80), []);
    assert.match(call.render(80)[0], /ctrl\+o to expand/);
    assert.match(
      call.render(80)[0],
      name === "bg_list" ? /1 background terminal/ : /bt-1 done/,
    );
    for (const width of [1, 10, 40]) {
      const lines = call.render(width);
      assert.equal(lines.length, 1);
      assert.ok(visibleWidth(lines[0]) <= width);
    }
    const expanded = renderer.renderResult(
      result,
      { expanded: true, isPartial: false },
      theme,
      context,
    );
    const text = expanded.render(120).join("\n");
    assert.match(text, /npm run build/);
    assert.match(text, /all output/);
    assert.match(text, /last line/);
    renderer.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      context,
    );
    assert.equal(call.render(80).length, 1);
  });
}

test("failed and partial results stay compact and strip terminal controls", () => {
  const renderer = createTerminalToolRenderers("bg_status");
  const context = { args: { id: "bt-unknown" }, state: {}, isError: true };
  const call = renderer.renderCall(context.args, theme, context);
  const result = {
    content: [
      { type: "text", text: "\x1b[31mUnknown terminal\x1b[0m\nerror detail" },
    ],
  };
  assert.deepEqual(
    renderer
      .renderResult(
        result,
        { expanded: false, isPartial: true },
        theme,
        context,
      )
      .render(80),
    [],
  );
  assert.match(call.render(80)[0], /Unknown terminal/);
  assert.ok(!call.render(80)[0].includes("\x1b"));
  const expanded = renderer.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    context,
  );
  assert.match(expanded.render(80).join("\n"), /error detail/);
});

test("all tool registrations use compact renderers and completion messages hide output", () => {
  const tools: any[] = [];
  let renderMessage: any;
  backgroundTerminals({
    on: () => {},
    registerTool: (tool: any) => tools.push(tool),
    registerMessageRenderer: (_name: string, renderer: any) => {
      renderMessage = renderer;
    },
    registerCommand: () => {},
  } as unknown as ExtensionAPI);
  assert.equal(tools.length, 4);
  for (const tool of tools) {
    assert.equal(tool.renderShell, "default");
    assert.equal(typeof tool.renderCall, "function");
    assert.equal(typeof tool.renderResult, "function");
  }
  const message = {
    details: { id: "bt-1", title: "Build", status: "done", exitCode: 0 },
    content: "Completed\nstdout:\nsecret output\nlast line",
  };
  const backgrounds: string[] = [];
  const trackedTheme = {
    ...theme,
    bg: (color: string, text: string) => {
      backgrounds.push(color);
      return text;
    },
  } as Theme;
  const collapsed = renderMessage(
    message,
    { expanded: false, outputPad: 1 },
    trackedTheme,
  );
  const lines: string[] = collapsed.render(80);
  // Same single compact row as tool calls: no box, no output.
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ .+Terminal bt-1 · Build · exit 0 +✓ › $/);
  assert.ok(lines.every((line) => visibleWidth(line) === 80));
  assert.deepEqual(backgrounds, []);
  assert.ok(
    collapsed.render(10).every((line: string) => visibleWidth(line) <= 10),
  );
  const expanded = renderMessage(
    message,
    { expanded: true, outputPad: 1 },
    trackedTheme,
  );
  const text = expanded.render(80).join("\n");
  assert.match(text, /⌄/);
  assert.match(text, /secret output/);
  assert.match(text, /last line/);
  assert.deepEqual([...new Set(backgrounds)], ["toolSuccessBg"]);
  backgrounds.length = 0;
  const failed = {
    ...message,
    details: { ...message.details, status: "failed", exitCode: 1 },
  };
  assert.match(
    renderMessage(
      failed,
      { expanded: false, outputPad: 1 },
      trackedTheme,
    ).render(80)[0],
    /exit 1 +✗ › $/,
  );
  renderMessage(failed, { expanded: true, outputPad: 1 }, trackedTheme).render(
    80,
  );
  assert.deepEqual([...new Set(backgrounds)], ["toolErrorBg"]);

  // Clicking a collapsed result expands just that message; ctrl+o wins after.
  const click = { type: "click", button: "left" } as any;
  const row = renderMessage(message, { expanded: false, outputPad: 1 }, theme);
  assert.deepEqual(row.handleMouse(click), { handled: true });
  assert.match(row.render(80).join("\n"), /secret output/);
  row.handleMouse(click);
  assert.doesNotMatch(row.render(80).join("\n"), /secret output/);
  row.handleMouse(click);
  const reexpanded = renderMessage(
    message,
    { expanded: true, outputPad: 1 },
    theme,
  );
  assert.match(reexpanded.render(80).join("\n"), /secret output/);
});
