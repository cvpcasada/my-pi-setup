import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "./index.ts";

test("summarize tool args into one line", () => {
  const cwd = "/repo";
  assert.equal(
    summarize(
      "read",
      { path: "/repo/test/web.test.ts", offset: 238, limit: 36 },
      cwd,
    ),
    "test/web.test.ts:238-273",
  );
  assert.equal(
    summarize("write", { path: "/usr/tmp/x.mjs" }, cwd),
    "../usr/tmp/x.mjs",
  );
  assert.equal(
    summarize("bash", { command: "node a.mjs\n  rm a" }, cwd),
    "node a.mjs rm a",
  );
  assert.equal(summarize("ls", {}, cwd), ".");
  assert.equal(
    summarize("bg_start", { title: "dev", command: "npm run dev" }, cwd),
    "npm run dev",
  );
  assert.equal(summarize("mystery", { foo: 1, bar: "baz" }, cwd), "baz");
});
