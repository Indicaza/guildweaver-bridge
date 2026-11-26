import assert from "node:assert/strict";
import test from "node:test";
import { describeUpdate } from "../src/cli/updateStatus.js";

test("all successful update variants use Up to date", () => {
  for (const status of ["current", "package-current", "developer-current", "updated", "developer-updated"]) {
    assert.deepEqual(describeUpdate({ status, releaseVersion: "0.9.0" }), { label: "Up to date", tone: "success" });
  }
});
test("activation remains Updating and unsuccessful operations use Failed", () => {
  assert.deepEqual(describeUpdate({ status: "restart-scheduled" }), { label: "Updating", tone: "info" });
  for (const status of ["failed", "dirty", "developer-dirty", "branch", "developer-branch", "release-unavailable", "not-packaged"]) {
    assert.equal(describeUpdate({ status }).label, "Failed");
    assert.equal(describeUpdate({ status }).tone, "error");
  }
});
