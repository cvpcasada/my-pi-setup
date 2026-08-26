import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { InlineDiffComponent } from "./components/DiffViewer.js";
import { loadLayoutStyle, parseLayoutStyle } from "./lib/config.js";
import { loadHighlightedDiff } from "./lib/pierreHighlight.js";
import { buildDiffMetadata } from "./lib/pierreParser.js";
import type { DiffViewerPayload } from "./types.js";

const theme = { name: "vesper" } as Theme;

function createPayload(): DiffViewerPayload {
  const snapshot = {
    path: "example.ts",
    oldContent: "const answer = 41;\nconst removed = true;\n",
    newContent: "const answer = 42;\nconst added = true;\n",
    existedBefore: true,
    existedAfter: true,
  };

  return {
    snapshot,
    metadata: buildDiffMetadata(snapshot),
    highlighted: {
      dark: { deletionLines: [], additionLines: [] },
      light: { deletionLines: [], additionLines: [] },
    },
  };
}

function plain(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

test("parses supported layout names", () => {
  assert.equal(parseLayoutStyle("stacked"), "stacked");
  assert.equal(parseLayoutStyle(" SPLIT "), "split");
  assert.equal(parseLayoutStyle("side-by-side"), undefined);
});

test("trusted project config overrides the default layout", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-diff-config-"));
  const configDir = join(cwd, CONFIG_DIR_NAME);
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "pi-diff.json"),
    JSON.stringify({ layout: "split" }),
    "utf8",
  );

  const previous = process.env.PI_DIFF_LAYOUT;
  delete process.env.PI_DIFF_LAYOUT;
  try {
    assert.equal(await loadLayoutStyle(cwd, true), "split");
  } finally {
    if (previous === undefined) {
      delete process.env.PI_DIFF_LAYOUT;
    } else {
      process.env.PI_DIFF_LAYOUT = previous;
    }
  }
});

test("syntax-highlights recognized file types", async () => {
  const payload = createPayload();
  const highlighted = await loadHighlightedDiff(payload.metadata);
  const tokenColors = new Set<string>();

  for (const line of [
    ...highlighted.dark.deletionLines,
    ...highlighted.dark.additionLines,
  ]) {
    collectTokenColors(line, tokenColors);
  }

  payload.highlighted = highlighted;
  const rendered = new InlineDiffComponent(payload, theme, 100, "split")
    .render(100)
    .join("\n");
  const terminalColors = new Set(rendered.match(/38;2;\d+;\d+;\d+/g) ?? []);

  assert.equal(payload.metadata.lang, "typescript");
  assert.equal(
    findTextColor(highlighted.dark.deletionLines[0], "const"),
    "#A0A0A0",
  );
  assert.ok(tokenColors.size > 1);
  assert.ok(terminalColors.size > 2);
});

test("renders stacked and split layouts within the available width", () => {
  const payload = createPayload();
  const stacked = new InlineDiffComponent(
    payload,
    theme,
    100,
    "stacked",
  ).render(100);
  const split = new InlineDiffComponent(payload, theme, 100, "split").render(
    100,
  );
  const narrowSplit = new InlineDiffComponent(
    payload,
    theme,
    100,
    "split",
  ).render(30);

  assert.ok(
    !stacked.some(
      (line) => plain(line).includes("41") && plain(line).includes("42"),
    ),
  );
  assert.ok(
    split.some(
      (line) => plain(line).includes("41") && plain(line).includes("42"),
    ),
  );
  assert.ok(split.some((line) => plain(line).includes("│")));
  assert.ok(split.every((line) => visibleWidth(line) === 100));
  assert.ok(narrowSplit.every((line) => visibleWidth(line) === 30));
});

function findTextColor(
  node: unknown,
  text: string,
  inheritedColor?: string,
): string | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  const candidate = node as {
    type?: unknown;
    value?: unknown;
    properties?: { style?: unknown };
    children?: unknown[];
  };
  const style =
    typeof candidate.properties?.style === "string"
      ? candidate.properties.style
      : "";
  const color = style.match(/(?:^|;)color:([^;]+)/)?.[1] ?? inheritedColor;
  if (candidate.type === "text" && candidate.value === text) {
    return color;
  }

  for (const child of candidate.children ?? []) {
    const found = findTextColor(child, text, color);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function collectTokenColors(node: unknown, colors: Set<string>) {
  if (!node || typeof node !== "object") {
    return;
  }

  const candidate = node as {
    properties?: { style?: unknown };
    children?: unknown[];
  };
  if (typeof candidate.properties?.style === "string") {
    const match = candidate.properties.style.match(/(?:^|;)color:([^;]+)/);
    if (match?.[1]) {
      colors.add(match[1]);
    }
  }

  for (const child of candidate.children ?? []) {
    collectTokenColors(child, colors);
  }
}
