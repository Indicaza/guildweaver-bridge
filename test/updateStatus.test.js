import assert from "node:assert/strict";
import test from "node:test";
import { describeUpdate } from "../src/cli/updateStatus.js";

test("current packaged and addon builds share a clear success label", () => {
  for (const status of ["current", "package-current", "developer-current"]) {
    assert.deepEqual(describeUpdate({ status, releaseVersion: "0.9.0" }), { label: "Up to date · 0.9.0", tone: "success" });
  }
});
test("staged package does not claim the new version is running", () => {
  const result = describeUpdate({ status: "restart-scheduled", releaseVersion: "0.9.1" });
  assert.equal(result.tone, "info");
  assert.match(result.label, /Update ready.*restarting automatically.*0\.9\.1/);
  assert.equal(describeUpdate({ status: "failed" }).tone, "error");
  assert.equal(describeUpdate({ status: "release-unavailable" }).tone, "warning");
});
