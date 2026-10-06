import fs from "node:fs";

import pg from "pg";

const { Pool } = pg;
const migrationSql = fs.readFileSync(
  new URL("../../migrations/001_init.sql", import.meta.url),
  "utf8",
);

function eventFromRow(row) {
  return {
    id: Number(row.id),
    installationId: row.installation_id,
    idempotencyKey: row.idempotency_key,
    streamKey: row.stream_key,
    revision: Number(row.revision),
    envelopeSchemaVersion: Number(row.envelope_schema_version),
    eventType: row.event_type,
    capturedAt: row.captured_at?.toISOString?.() || row.captured_at,
    realm: row.realm,
    region: row.region,
    characterId: row.character_id,
    guildId: row.guild_id,
    envelope: row.envelope,
    receivedAt: row.received_at?.toISOString?.() || row.received_at,
  };
}

function installationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    tokenHash: row.token_hash,
    metadata: row.metadata || {},
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    lastSeenAt: row.last_seen_at?.toISOString?.() || row.last_seen_at,
    revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at,
  };
}

function consumerFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at,
  };
}

export class PostgresCollectorStore {
  constructor({ connectionString, ssl = false, pool = null }) {
    this.pool =
      pool ||
      new Pool({
        connectionString,
        ssl: ssl ? { rejectUnauthorized: false } : false,
        max: 10,
      });
  }

  async migrate() {
    await this.pool.query(migrationSql);
  }

  async ping() {
    await this.pool.query("SELECT 1");
    return true;
  }

  async close() {
    await this.pool.end();
  }

  async createEnrollmentCode({ id, codeHash, label = "", maxUses = 1 }) {
    const result = await this.pool.query(
      `INSERT INTO collector_enrollment_codes (id, code_hash, label, max_uses)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, codeHash, label, maxUses],
    );
    return result.rows[0];
  }

  async revokeEnrollmentCode(id) {
    const result = await this.pool.query(
      `UPDATE collector_enrollment_codes SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
    return result.rowCount > 0;
  }

  async consumeEnrollmentCode({
    codeHash,
    installationId,
    publicId,
    tokenHash,
    metadata,
  }) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const codeResult = await client.query(
        `SELECT * FROM collector_enrollment_codes
         WHERE code_hash = $1
         FOR UPDATE`,
        [codeHash],
      );
      const code = codeResult.rows[0];

      if (!code || code.revoked_at || Number(code.use_count) >= Number(code.max_uses)) {
        await client.query("ROLLBACK");
        return { status: "invalid-code" };
      }

      const existing = await client.query(
        "SELECT id FROM collector_installations WHERE public_id = $1",
        [publicId],
      );
      if (existing.rowCount > 0) {
        await client.query("ROLLBACK");
        return { status: "installation-exists" };
      }

      const inserted = await client.query(
        `INSERT INTO collector_installations (id, public_id, token_hash, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING *`,
        [installationId, publicId, tokenHash, JSON.stringify(metadata || {})],
      );
      await client.query(
        `UPDATE collector_enrollment_codes
         SET use_count = use_count + 1
         WHERE id = $1`,
        [code.id],
      );
      await client.query("COMMIT");
      return {
        status: "created",
        installation: installationFromRow(inserted.rows[0]),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticateInstallation(tokenHash) {
    const result = await this.pool.query(
      `SELECT * FROM collector_installations
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    return installationFromRow(result.rows[0]);
  }

  async revokeInstallation(publicId) {
    const result = await this.pool.query(
      `UPDATE collector_installations SET revoked_at = NOW()
       WHERE public_id = $1 AND revoked_at IS NULL`,
      [publicId],
    );
    return result.rowCount > 0;
  }

  async ingestTelemetry({ installationId, idempotencyKey, record, capturedAt }) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO collector_events (
           installation_id, idempotency_key, stream_key, revision,
           envelope_schema_version, event_type, captured_at, realm, region,
           character_id, guild_id, envelope
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          installationId,
          idempotencyKey,
          record.streamKey,
          record.revision,
          record.envelope.schemaVersion,
          record.envelope.eventType,
          capturedAt,
          record.envelope.realm,
          record.envelope.region,
          record.envelope.characterId,
          record.envelope.guildId,
          JSON.stringify(record.envelope),
        ],
      );

      let status = "accepted";
      let eventRow = inserted.rows[0];

      if (!eventRow) {
        status = "duplicate";
        const duplicate = await client.query(
          `SELECT * FROM collector_events
           WHERE installation_id = $1
             AND (idempotency_key = $2 OR (stream_key = $3 AND revision = $4))
           ORDER BY id
           LIMIT 1`,
          [installationId, idempotencyKey, record.streamKey, record.revision],
        );
        eventRow = duplicate.rows[0];
      }

      await client.query(
        "UPDATE collector_installations SET last_seen_at = NOW() WHERE id = $1",
        [installationId],
      );
      await client.query("COMMIT");
      return { status, event: eventFromRow(eventRow) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createConsumer({ id, name, tokenHash }) {
    const result = await this.pool.query(
      `INSERT INTO collector_consumers (id, name, token_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, name, tokenHash],
    );
    await this.pool.query(
      `INSERT INTO collector_consumer_checkpoints (consumer_id, event_id)
       VALUES ($1, 0)
       ON CONFLICT (consumer_id) DO NOTHING`,
      [id],
    );
    return consumerFromRow(result.rows[0]);
  }

  async authenticateConsumer(tokenHash) {
    const result = await this.pool.query(
      `SELECT * FROM collector_consumers
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    return consumerFromRow(result.rows[0]);
  }

  async revokeConsumer(id) {
    const result = await this.pool.query(
      `UPDATE collector_consumers SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
    return result.rowCount > 0;
  }

  async getConsumerCheckpoint(consumerId) {
    const result = await this.pool.query(
      `SELECT event_id FROM collector_consumer_checkpoints WHERE consumer_id = $1`,
      [consumerId],
    );
    return Number(result.rows[0]?.event_id || 0);
  }

  async setConsumerCheckpoint(consumerId, cursor) {
    const result = await this.pool.query(
      `INSERT INTO collector_consumer_checkpoints (consumer_id, event_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (consumer_id) DO UPDATE SET
         event_id = GREATEST(collector_consumer_checkpoints.event_id, EXCLUDED.event_id),
         updated_at = NOW()
       RETURNING event_id`,
      [consumerId, cursor],
    );
    return Number(result.rows[0].event_id);
  }

  async listEvents({ after = 0, limit = 100, eventType = null }) {
    const values = [after, limit];
    let filter = "";

    if (eventType) {
      values.push(eventType);
      filter = `AND event_type = $${values.length}`;
    }

    const result = await this.pool.query(
      `SELECT * FROM collector_events
       WHERE id > $1 ${filter}
       ORDER BY id
       LIMIT $2`,
      values,
    );
    return result.rows.map(eventFromRow);
  }
}
