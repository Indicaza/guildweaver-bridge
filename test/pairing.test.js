import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensurePaired, clearCredentials } from "../src/pairing.js";

test("first run opens browser, polls, and persists a device credential", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-pairing-"));
  const credentialsPath = path.join(directory, "credentials.json");
  const opened = [];
  const requests = [];
  let exchangeCalls = 0;

  const fetchImpl = async (url, options) => {
    requests.push({ url, options });

    if (url.endsWith("/pairing/start")) {
      return new Response(
        JSON.stringify({
          status: "pending",
          deviceCode: "gwp_device_code",
          userCode: "ABCD-2345",
          verificationUri: "https://holdfast.example/guildweaver/connect?code=ABCD-2345",
          expiresIn: 600,
          interval: 1,
        }),
        { status: 201 },
      );
    }

    exchangeCalls += 1;

    if (exchangeCalls === 1) {
      return new Response(JSON.stringify({ status: "pending" }), { status: 202 });
    }

    return new Response(
      JSON.stringify({
        status: "connected",
        deviceId: "device-one",
        deviceToken: "gwd_secret",
        memberId: "discord-member-one",
        deviceName: "Gaming PC",
      }),
      { status: 200 },
    );
  };

  const config = {
    holdfastUrl: "https://holdfast.example",
    credentialsPath,
  };

  try {
    const credentials = await ensurePaired(config, {
      fetchImpl,
      log: () => {},
      openBrowserImpl: (url) => opened.push(url),
      sleepImpl: async () => {},
    });

    assert.equal(credentials.deviceToken, "gwd_secret");
    assert.equal(credentials.memberId, "discord-member-one");
    assert.deepEqual(opened, [
      "https://holdfast.example/guildweaver/connect?code=ABCD-2345",
    ]);
    assert.equal(requests.length, 3);

    const stored = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    assert.equal(stored.deviceId, "device-one");
    assert.equal(stored.deviceToken, "gwd_secret");

    const second = await ensurePaired(config, {
      fetchImpl: async () => {
        throw new Error("paired bridge should not call Holdfast again");
      },
      log: () => {},
      openBrowserImpl: () => {
        throw new Error("paired bridge should not reopen browser");
      },
    });

    assert.equal(second.deviceToken, "gwd_secret");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("account binding survives revoked credentials and prevents a replacement account from uploading", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-owner-"));
  const config = { holdfastUrl: "https://example.test", credentialsPath: path.join(directory, "credentials.json"), statePath: path.join(directory, "state.json") };
  const old = { holdfastUrl: config.holdfastUrl, memberId: "member-original", deviceId: "old-device", deviceToken: "old-token" };
  const bind = (memberId) => ({
    log: () => {}, openBrowserImpl: () => {}, sleepImpl: async () => {},
    fetchImpl: async (url) => new Response(JSON.stringify(url.endsWith("/start")
      ? { deviceCode: "code", verificationUri: config.holdfastUrl, userCode: "ABC" }
      : { status: "connected", memberId, deviceId: "new-device", deviceToken: "new-token" })),
  });
  try {
    fs.writeFileSync(config.credentialsPath, JSON.stringify(old));
    fs.writeFileSync(config.statePath, "preserve me");
    assert.deepEqual(await ensurePaired(config), old);
    assert.equal(JSON.parse(fs.readFileSync(config.credentialsPath + ".owner.json")).memberId, old.memberId);
    clearCredentials(config.credentialsPath);
    await assert.rejects(ensurePaired(config, bind("wrong-member")), /account mismatch/);
    assert.equal(fs.existsSync(config.credentialsPath), false);
    assert.equal(fs.readFileSync(config.statePath, "utf8"), "preserve me");
    const replacement = await ensurePaired(config, bind(old.memberId));
    assert.equal(replacement.deviceId, "new-device");
    await assert.rejects(ensurePaired({ ...config, holdfastUrl: "https://other.test" }), /another website/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy state without original credentials cannot be silently assigned to a new account", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-owner-legacy-"));
  const config = { holdfastUrl: "https://example.test", credentialsPath: path.join(directory, "credentials.json"), statePath: path.join(directory, "state.json") };
  try {
    fs.writeFileSync(config.statePath, "legacy-state");
    await assert.rejects(ensurePaired(config, { fetchImpl: assert.fail }), /no account binding/);
    assert.equal(fs.readFileSync(config.statePath, "utf8"), "legacy-state");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
