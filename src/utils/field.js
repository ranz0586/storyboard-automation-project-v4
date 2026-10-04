export function getField(fields, name) {
  const key = Object.keys(fields).find(k => k.trim().toLowerCase() === name.toLowerCase());
  return key ? fields[key] : undefined;
}