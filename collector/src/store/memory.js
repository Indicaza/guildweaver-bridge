export class MemoryCollectorStore {
  constructor() {
    this.enrollmentCodes = new Map();
    this.installations = new Map();
    this.installationByTokenHash = new Map();
    this.installationByPublicId = new Map();
    this.events = [];
    this.consumers = new Map();
    this.consumerByTokenHash = new Map();
    this.checkpoints = new Map();
    this.nextEventId = 1;
  }

  async migrate() {}

  async ping() {
    return true;
  }

  async close() {}

  async createEnrollmentCode({ id, codeHash, label = "", maxUses = 1 }) {
    const value = {
      id,
      codeHash,
      label,
      maxUses,
      useCount: 0,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.enrollmentCodes.set(codeHash, value);
    return value;
  }

  async revokeEnrollmentCode(id) {
    for (const value of this.enrollmentCodes.values()) {
      if (value.id === id) {
        value.revokedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  async consumeEnrollmentCode({
    codeHash,
    installationId,
    publicId,
    tokenHash,
    metadata,
  }) {
    const code = this.enrollmentCodes.get(codeHash);
    if (!code || code.revokedAt || code.useCount >= code.maxUses) {
      return { status: "invalid-code" };
    }

    if (this.installationByPublicId.has(publicId)) {
      return { status: "installation-exists" };
    }

    const installation = {
      id: installationId,
      publicId,
      tokenHash,
      metadata,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      revokedAt: null,
    };
    code.useCount += 1;
    this.installations.set(installationId, installation);
    this.installationByTokenHash.set(tokenHash, installationId);
    this.installationByPublicId.set(publicId, installationId);
    return { status: "created", installation };
  }

  async authenticateInstallation(tokenHash) {
    const id = this.installationByTokenHash.get(tokenHash);
    const installation = id ? this.installations.get(id) : null;
    return installation && !installation.revokedAt ? installation : null;
  }

  async revokeInstallation(publicId) {
    const id = this.installationByPublicId.get(publicId);
    const installation = id ? this.installations.get(id) : null;
    if (!installation) return false;
    installation.revokedAt = new Date().toISOString();
    return true;
  }

  async ingestTelemetry({ installationId, idempotencyKey, record, capturedAt }) {
    const duplicate = this.events.find(
      (event) =>
        event.installationId === installationId &&
        (event.idempotencyKey === idempotencyKey ||
          (event.streamKey === record.streamKey && event.revision === record.revision)),
    );
    if (duplicate) return { status: "duplicate", event: duplicate };

    const event = {
      id: this.nextEventId++,
      installationId,
      idempotencyKey,
      streamKey: record.streamKey,
      revision: record.revision,
      envelopeSchemaVersion: record.envelope.schemaVersion,
      eventType: record.envelope.eventType,
      capturedAt,
      realm: record.envelope.realm,
      region: record.envelope.region,
      characterId: record.envelope.characterId,
      guildId: record.envelope.guildId,
      envelope: record.envelope,
      receivedAt: new Date().toISOString(),
    };
    this.events.push(event);
    const installation = this.installations.get(installationId);
    if (installation) installation.lastSeenAt = event.receivedAt;
    return { status: "accepted", event };
  }

  async createConsumer({ id, name, tokenHash }) {
    const consumer = {
      id,
      name,
      tokenHash,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.consumers.set(id, consumer);
    this.consumerByTokenHash.set(tokenHash, id);
    this.checkpoints.set(id, 0);
    return consumer;
  }

  async authenticateConsumer(tokenHash) {
    const id = this.consumerByTokenHash.get(tokenHash);
    const consumer = id ? this.consumers.get(id) : null;
    return consumer && !consumer.revokedAt ? consumer : null;
  }

  async revokeConsumer(id) {
    const consumer = this.consumers.get(id);
    if (!consumer) return false;
    consumer.revokedAt = new Date().toISOString();
    return true;
  }

  async getConsumerCheckpoint(consumerId) {
    return this.checkpoints.get(consumerId) || 0;
  }

  async setConsumerCheckpoint(consumerId, cursor) {
    const current = this.checkpoints.get(consumerId) || 0;
    const next = Math.max(current, cursor);
    this.checkpoints.set(consumerId, next);
    return next;
  }

  async listEvents({ after = 0, limit = 100, eventType = null }) {
    return this.events
      .filter((event) => event.id > after && (!eventType || event.eventType === eventType))
      .slice(0, limit);
  }
}
