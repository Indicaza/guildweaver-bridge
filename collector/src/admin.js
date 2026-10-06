import { loadCollectorConfig } from "./config.js";
import { identifier, opaqueToken, tokenHash } from "./crypto.js";
import { PostgresCollectorStore } from "./store/postgres.js";

function usage() {
  console.log(`Guildweaver Collector admin

Usage:
  node src/admin.js enrollment <label> [maxUses]
  node src/admin.js consumer <name>
  node src/admin.js revoke-enrollment <id>
  node src/admin.js revoke-installation <publicId>
  node src/admin.js revoke-consumer <id>
`);
}

const [command, value, extra] = process.argv.slice(2);
if (!command) {
  usage();
  process.exitCode = 1;
} else {
  const config = loadCollectorConfig();
  const store = new PostgresCollectorStore({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
  });

  try {
    await store.migrate();

    if (command === "enrollment") {
      const label = String(value || "").trim();
      const maxUses = Number(extra || 1);
      if (!label || !Number.isInteger(maxUses) || maxUses < 1) {
        throw new Error("enrollment requires a label and optional positive maxUses");
      }
      const code = opaqueToken("gwe");
      const id = identifier("enrollment");
      await store.createEnrollmentCode({
        id,
        codeHash: tokenHash(code),
        label,
        maxUses,
      });
      console.log(JSON.stringify({ id, label, maxUses, enrollmentCode: code }, null, 2));
    } else if (command === "consumer") {
      const name = String(value || "").trim();
      if (!name) throw new Error("consumer requires a name");
      const token = opaqueToken("gwc");
      const id = identifier("consumer");
      await store.createConsumer({ id, name, tokenHash: tokenHash(token) });
      console.log(JSON.stringify({ id, name, consumerToken: token }, null, 2));
    } else if (command === "revoke-enrollment") {
      if (!value) throw new Error("revoke-enrollment requires an id");
      const changed = await store.revokeEnrollmentCode(value);
      console.log(JSON.stringify({ revoked: changed, id: value }));
    } else if (command === "revoke-installation") {
      if (!value) throw new Error("revoke-installation requires a public installation id");
      const changed = await store.revokeInstallation(value);
      console.log(JSON.stringify({ revoked: changed, installationId: value }));
    } else if (command === "revoke-consumer") {
      if (!value) throw new Error("revoke-consumer requires an id");
      const changed = await store.revokeConsumer(value);
      console.log(JSON.stringify({ revoked: changed, id: value }));
    } else {
      usage();
      process.exitCode = 1;
    }
  } finally {
    await store.close();
  }
}
