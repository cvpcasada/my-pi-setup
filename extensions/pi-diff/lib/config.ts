import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const LAYOUT_STYLES = ["stacked", "split"] as const;
export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

const CONFIG_FILE_NAME = "pi-diff.json";
const DEFAULT_LAYOUT: LayoutStyle = "stacked";

export async function loadLayoutStyle(
  cwd: string,
  projectTrusted: boolean,
): Promise<LayoutStyle> {
  const [globalLayout, projectLayout] = await Promise.all([
    readLayoutConfig(join(getAgentDir(), CONFIG_FILE_NAME)),
    projectTrusted
      ? readLayoutConfig(join(cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME))
      : undefined,
  ]);

  return (
    parseLayoutStyle(process.env.PI_DIFF_LAYOUT) ??
    projectLayout ??
    globalLayout ??
    DEFAULT_LAYOUT
  );
}

export function parseLayoutStyle(value: unknown): LayoutStyle | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return LAYOUT_STYLES.find((style) => style === normalized);
}

async function readLayoutConfig(
  path: string,
): Promise<LayoutStyle | undefined> {
  try {
    const contents = await readFile(path, "utf8");
    const config = JSON.parse(contents) as { layout?: unknown };
    return parseLayoutStyle(config.layout);
  } catch {
    return undefined;
  }
}
