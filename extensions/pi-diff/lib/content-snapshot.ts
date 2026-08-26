import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiffSnapshot } from "../types.js";

interface FileSnapshot {
  exists: boolean;
  content: string;
}

export function resolveToolPath(cwd: string, relativeOrAbsolutePath: string) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(cwd, relativeOrAbsolutePath);
}

export async function readTextSnapshot(
  absolutePath: string,
): Promise<FileSnapshot> {
  try {
    const content = await readFile(absolutePath, "utf8");
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
}

export async function createWriteSnapshot(
  cwd: string,
  relativePath: string,
  newContent: string,
) {
  const absolutePath = resolveToolPath(cwd, relativePath);
  const before = await readTextSnapshot(absolutePath);
  return {
    path: relativePath,
    oldContent: before.content,
    newContent,
    existedBefore: before.exists,
    existedAfter: true,
  } satisfies DiffSnapshot;
}

export async function createEditSnapshots(cwd: string, relativePath: string) {
  const absolutePath = resolveToolPath(cwd, relativePath);
  const before = await readTextSnapshot(absolutePath);
  return {
    absolutePath,
    before,
    async finish() {
      const after = await readTextSnapshot(absolutePath);
      return {
        path: relativePath,
        oldContent: before.content,
        newContent: after.content,
        existedBefore: before.exists,
        existedAfter: after.exists,
      } satisfies DiffSnapshot;
    },
  };
}
