function write(level, message, fields = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info(message, fields) {
    write("info", message, fields);
  },
  warn(message, fields) {
    write("warn", message, fields);
  },
  error(message, fields) {
    write("error", message, fields);
  },
};
