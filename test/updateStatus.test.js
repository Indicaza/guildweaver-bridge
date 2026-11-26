import assert from "node:assert/strict";
import test from "node:test";
import { describeUpdate } from "../src/cli/updateStatus.js";

test("all current and updated variants have identical labels regardless of version", () => {
  for (const status of ["current", "package-current", "developer-current"]) {
    assert.deepEqual(describeUpdate({ status, releaseVersion: "0.9.0" }), { label: "Up to date", tone: "success" });
  }
  for (const status of ["updated", "developer-updated"]) {
    assert.deepEqual(describeUpdate({ status, commit: "abc12345" }), { label: "Updated", tone: "success" });
  }
});

test("restart, failure and skipped states are short and reasons are separate", () => {
  assert.deepEqual(describeUpdate({ status: "restart-scheduled", releaseVersion: "0.9.1" }), { label: "Restarting", tone: "info" });
  assert.deepEqual(describeUpdate({ status: "failed" }), { label: "Failed", tone: "error" });
  for (const status of ["dirty", "developer-dirty", "branch", "developer-branch"]) {
    const result = describeUpdate({ status });
    assert.equal(result.label, "Skipped");
    assert.ok(result.detail);
  }
  assert.equal(describeUpdate({ status: "release-unavailable" }).label, "Unavailable");
});
