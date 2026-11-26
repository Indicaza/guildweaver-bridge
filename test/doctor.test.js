import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnose } from "../src/doctor.js";

test("doctor reads local state without exposing account data or contacting authenticated endpoints", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-doctor-private-"));
  const config = { addonPath: path.join(directory, "addon"), savedVariablesPath: path.join(directory, "Guildweaver.lua"), credentialsPath: path.join(directory,"credentials.json"), lockPath: path.join(directory,"lock"), logPath:path.join(directory,"log"), holdfastUrl:"https://example.test" };
  try {
    fs.mkdirSync(config.addonPath);
    fs.writeFileSync(path.join(config.addonPath,"Guildweaver.toc"), "## Version: 1");
    fs.writeFileSync(path.join(config.addonPath,"release.json"), JSON.stringify({releaseVersion:"0.5.0"}));
    fs.writeFileSync(config.credentialsPath, JSON.stringify({deviceToken:"gwd_SECRET",memberId:"PRIVATE_MEMBER"}));
    fs.writeFileSync(config.savedVariablesPath, 'GuildweaverDB = {gameRelease="forever-live",schemaVersion=4,meta={releaseValidation={reason="live"}},sync={outbound={telemetry={["PRIVATE_CHARACTER"]={kind="state"}}}}}');
    const report = await diagnose(config,{runtime:()=>null,fetchImpl:async(url, options)=>{
      assert.equal(url,"https://example.test/api/bridge/release");
      assert.equal(options.headers,undefined);
      return new Response(JSON.stringify({gameRelease:"forever-live"}));
    }});
    assert.equal(report.checks.find(c=>c.name==="Addon files").status,"pass");
    assert.equal(report.checks.find(c=>c.name==="SavedVariables").status,"pass");
    assert.equal(report.checks.find(c=>c.name==="Website release").status,"pass");
    assert.equal(report.checks.find(c=>c.name==="Background bridge").status,"warn");
    const serialized=JSON.stringify(report);
    for(const secret of ["gwd_SECRET","PRIVATE_MEMBER","PRIVATE_CHARACTER",directory]) assert.ok(!serialized.includes(secret));
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
