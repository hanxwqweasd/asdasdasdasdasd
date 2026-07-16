import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

interface LockPackage {
  version?: string;
  resolved?: string;
}

interface LockFile {
  packages: Record<string, LockPackage>;
}

test("package lock pins only published logging dependencies", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8")) as LockFile;

  assert.equal(pkg.overrides?.["thread-stream"], "4.2.0");
  assert.equal(lock.packages["node_modules/thread-stream"]?.version, "4.2.0");
  assert.equal(lock.packages["node_modules/split2"]?.version, "4.2.0");
  assert.equal(lock.packages["node_modules/@fastify/error"]?.version, "4.2.0");

  for (const dependency of ["thread-stream", "split2", "@fastify/error"]) {
    const entry = lock.packages[`node_modules/${dependency}`];
    assert.ok(entry?.resolved?.startsWith("https://registry.npmjs.org/"));
    assert.doesNotMatch(entry?.resolved ?? "", /-4\.3\.0\.tgz$/);
  }
});
