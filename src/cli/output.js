const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, value) => color ? "\x1b[" + code + "m" + value + "\x1b[0m" : String(value);
export const gold = (value) => paint("33;1", value);
export const muted = (value) => paint("90", value);
export const green = (value) => paint("32", value);
export const warn = (value) => paint("33", value);
export const red = (value) => paint("31", value);
export function heading(title) {
  console.log("\n" + gold("◆ GUILDWEAVER") + "  " + muted(title));
}
export function rows(values) {
  const width = Math.max(0, ...values.map(([key]) => key.length));
  for (const [key, value] of values) console.log("  " + muted(key.padEnd(width)) + "  " + value);
}
export async function loading(label, run, { json = false } = {}) {
  if (json || !process.stdout.isTTY) return run();
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  const draw = () => process.stdout.write("\r\x1b[2K" + gold(frames[index++ % frames.length]) + " " + label);
  draw();
  const timer = setInterval(draw, 80);
  try { return await run(); }
  finally { clearInterval(timer); process.stdout.write("\r\x1b[2K"); }
}
