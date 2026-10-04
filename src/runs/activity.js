export function startActivity(store, { projectId, type, source = 'OPERATOR' }) {
  if (!store || !projectId) return null;
  return store.transaction(() => {
    const run = store.create({ projectId, type, source, requestedCount: 1 });
    return store.update(run.id, { status: 'RUNNING', startedAt: new Date().toISOString() });
  });
}

export function finishActivity(store, run, item, error) {
  if (!store || !run) return;
  store.transaction(() => {
    const message = error ? String(error.message || error).slice(0, 1000) : null;
    store.addItem(run.id, { ...item, status: error ? 'FAILED' : 'SUCCEEDED', ...(message ? { error: message } : {}) });
    store.update(run.id, { status: error ? 'FAILED' : 'COMPLETED', processedCount: 1,
      successfulCount: error ? 0 : 1, failedCount: error ? 1 : 0,
      error: message, currentItem: null, completedAt: new Date().toISOString() });
  });
}
