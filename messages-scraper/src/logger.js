// logger خفيف بصيغة JSON-ish — يكفي لـ Railway logs.
function ts() {
  return new Date().toISOString();
}
function fmt(level, tag, msg, extra) {
  const base = `${ts()} [${level}] [${tag}] ${msg}`;
  return extra !== undefined ? `${base} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : base;
}
export const log = {
  info: (tag, msg, extra) => console.log(fmt('INFO', tag, msg, extra)),
  warn: (tag, msg, extra) => console.warn(fmt('WARN', tag, msg, extra)),
  error: (tag, msg, extra) => console.error(fmt('ERR ', tag, msg, extra)),
};
