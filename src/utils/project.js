import { getField } from './field.js';

export function projectKey(project) {
  const key = getField(project?.fields || {}, 'project_id');
  if (typeof key !== 'string' || !key.trim()) {
    throw Object.assign(new Error('Project has no project_id'), { statusCode: 409 });
  }
  return key;
}

export function belongsToProject(record, project) {
  const reference = getField(record?.fields || {}, 'Projects');
  return Array.isArray(reference)
    ? reference.includes(project.id)
    : reference === projectKey(project);
}

export function assertProjectActive(project) {
  const status = getField(project?.fields || {}, 'status') || 'Active';
  if (status !== 'Active') {
    throw Object.assign(new Error(`Project is ${status.toLowerCase()}; activate it before starting new work`), { statusCode: 409 });
  }
}

export function normalizeRecord(record) {
  return { ...record, fields: Object.fromEntries(Object.entries(record.fields || {}).map(([key, value]) => [key.trim(), value])) };
}
