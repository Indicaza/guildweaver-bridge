const SUPPORTED_SAVED_VARIABLES_SCHEMA = 4;

class LuaReader {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  error(message) {
    const start = Math.max(0, this.index - 30);
    const end = Math.min(this.source.length, this.index + 30);
    const context = this.source.slice(start, end).replace(/\s+/g, " ");
    throw new Error(`${message} near \"${context}\"`);
  }

  skipIgnored() {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index += 1;
        continue;
      }

      if (this.source.startsWith("--[[", this.index)) {
        const end = this.source.indexOf("]]", this.index + 4);
        this.index = end === -1 ? this.source.length : end + 2;
        continue;
      }

      if (this.source.startsWith("--", this.index)) {
        const end = this.source.indexOf("\n", this.index + 2);
        this.index = end === -1 ? this.source.length : end + 1;
        continue;
      }

      break;
    }
  }

  peek(value) {
    this.skipIgnored();
    return this.source.startsWith(value, this.index);
  }

  consume(value) {
    this.skipIgnored();

    if (!this.source.startsWith(value, this.index)) {
      this.error(`Expected ${value}`);
    }

    this.index += value.length;
  }

  identifier() {
    this.skipIgnored();
    const match = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_]*/);

    if (!match) {
      this.error("Expected identifier");
    }

    this.index += match[0].length;
    return match[0];
  }

  string() {
    this.skipIgnored();
    const quote = this.source[this.index];

    if (quote !== '"' && quote !== "'") {
      this.error("Expected string");
    }

    this.index += 1;
    let output = "";

    while (this.index < this.source.length) {
      const character = this.source[this.index++];

      if (character === quote) {
        return output;
      }

      if (character !== "\\") {
        output += character;
        continue;
      }

      if (this.index >= this.source.length) {
        this.error("Unterminated string escape");
      }

      const escaped = this.source[this.index++];
      const mapped = {
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        "\\": "\\",
        '"': '"',
        "'": "'",
      }[escaped];

      if (mapped !== undefined) {
        output += mapped;
        continue;
      }

      if (/\d/.test(escaped)) {
        let digits = escaped;

        while (digits.length < 3 && /\d/.test(this.source[this.index] || "")) {
          digits += this.source[this.index++];
        }

        output += String.fromCharCode(Number(digits));
        continue;
      }

      output += escaped;
    }

    this.error("Unterminated string");
  }

  number() {
    this.skipIgnored();
    const match = this.source
      .slice(this.index)
      .match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);

    if (!match) {
      this.error("Expected number");
    }

    this.index += match[0].length;
    return Number(match[0]);
  }

  value() {
    this.skipIgnored();
    const character = this.source[this.index];

    if (character === "{") {
      return this.table();
    }

    if (character === '"' || character === "'") {
      return this.string();
    }

    if (/[+\-.\d]/.test(character || "")) {
      return this.number();
    }

    const identifier = this.identifier();

    if (identifier === "true") return true;
    if (identifier === "false") return false;
    if (identifier === "nil") return null;

    this.error(`Unsupported Lua value ${identifier}`);
  }

  table() {
    this.consume("{");
    const entries = [];
    let implicitIndex = 1;

    while (!this.peek("}")) {
      let key;
      let value;

      if (this.peek("[")) {
        this.consume("[");
        key = this.value();
        this.consume("]");
        this.consume("=");
        value = this.value();
      } else {
        const checkpoint = this.index;
        this.skipIgnored();
        const match = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_]*/);

        if (match) {
          const candidate = this.identifier();

          if (this.peek("=")) {
            this.consume("=");
            key = candidate;
            value = this.value();
          } else {
            this.index = checkpoint;
          }
        }

        if (value === undefined) {
          key = implicitIndex++;
          value = this.value();
        }
      }

      entries.push([key, value]);

      if (this.peek(",")) this.consume(",");
      else if (this.peek(";")) this.consume(";");
      else if (!this.peek("}")) this.error("Expected table separator");
    }

    this.consume("}");

    if (!entries.length) {
      return {};
    }

    const integerKeys = entries
      .map(([key]) => key)
      .filter((key) => Number.isInteger(key) && key >= 1);
    const isArray =
      integerKeys.length === entries.length &&
      new Set(integerKeys).size === entries.length &&
      Math.max(...integerKeys) === entries.length;

    if (isArray) {
      const output = new Array(entries.length);

      for (const [key, entryValue] of entries) {
        output[key - 1] = entryValue;
      }

      return output;
    }

    const output = {};

    for (const [key, entryValue] of entries) {
      output[String(key)] = entryValue;
    }

    return output;
  }
}

export function parseSavedVariables(source, variableName = "GuildweaverDB") {
  const assignment = new RegExp(`(?:^|\\n)\\s*${variableName}\\s*=`).exec(source);

  if (!assignment) {
    throw new Error(`${variableName} assignment was not found`);
  }

  const equalsIndex = source.indexOf("=", assignment.index);
  const reader = new LuaReader(source);
  reader.index = equalsIndex + 1;
  return reader.value();
}

export function savedVariablesSchemaVersion(database) {
  const version = Number(database?.schemaVersion);
  return Number.isInteger(version) && version >= 1 ? version : 0;
}

export function assertSupportedSavedVariablesSchema(database) {
  const version = savedVariablesSchemaVersion(database);

  if (version > SUPPORTED_SAVED_VARIABLES_SCHEMA) {
    throw new Error(
      `Unsupported Guildweaver SavedVariables schema ${version}; bridge supports through ${SUPPORTED_SAVED_VARIABLES_SCHEMA}`,
    );
  }

  return version;
}

export function outboundTelemetry(database) {
  const telemetry = database?.sync?.outbound?.telemetry;

  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) {
    return {};
  }

  return telemetry;
}
