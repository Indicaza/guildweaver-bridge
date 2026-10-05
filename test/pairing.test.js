import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensurePaired } from "../src/pairing.js";

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
