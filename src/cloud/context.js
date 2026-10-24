import { CloudProductionStore } from './productionStore.js';
import { CloudAuditStore } from './auditStore.js';
import { CloudBriefStore } from './briefStore.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { database } from './database.js';
import { CloudState } from './state.js';
import { createDatabaseLock, DatabaseKeyPool, DeferredError } from './coordination.js';
import { config } from '../config.js';
import { GeminiClient } from '../clients/gemini.js';
import { airtable } from '../clients/airtable.js';
import { searchYouTubeApi } from '../clients/youtube.js';
import { telegram } from '../clients/telegram.js';
const guards = new AsyncLocalStorage();
let shared;
export function cloudContext() {
  return (shared ||= createCloudContext());
}
export function createCloudContext({
  db = database(),
  makeGemini = (options) => new GeminiClient(options),
  makeAirtable = airtable,
  makeTelegram = telegram,
  searchMetadata = searchYouTubeApi,
} = {}) {
  const state = new CloudState(db),
    lock = createDatabaseLock(db);
  const withLock = (id, work) =>
    lock(id, (check) => guards.run([...(guards.getStore() || []), check], work));
  const guard = () => {
    for (const check of guards.getStore() || []) check();
  };
  const briefStore = new CloudBriefStore(db, guard);
  const productionStore=new CloudProductionStore(db,guard), auditStore=new CloudAuditStore(db,guard);
  const keyPool = new DatabaseKeyPool(db, config.gemini.apiKeys, config.gemini.keyCooldownMs);
  const clients = (namespace) => {
    let provider;
    const real = makeAirtable();
    const gemini = {
      generate: async (input) => {
        guard();
        const id =
          namespace +
          ':model:' +
          createHash('sha256')
            .update(
              JSON.stringify([config.gemini.modelPrimary, config.gemini.modelFallback, input]),
            )
            .digest('hex');
        const cached = await state.effect(id);
        if (cached !== undefined) return cached;
        const value = await (provider ||= makeGemini({ keyPool })).generate(input);
        guard();
        return state.saveEffect(id, value);
      },
    };
    const client = new Proxy(real, {
      get(target, key) {
        const fn = target[key];
        if (typeof fn !== 'function') return fn;
        return async (...args) => {
          guard();
          // Keep saved ideas and the editorial history snapshot stable across replay.
          if (key === 'upsertIdea' || key === 'recentProjectContent') {
            const id =
              namespace +
              (key === 'upsertIdea' ? ':idea:' : ':history:') +
              createHash('sha256').update(JSON.stringify(key === 'upsertIdea' ? args[0] : args)).digest('hex');
            const saved = await state.effect(id);
            if (saved !== undefined) return saved;
            const value = await fn.apply(target, args);
            guard();
            return state.saveEffect(id, value);
          }
          const value = await fn.apply(target, args);
          guard();
          return value;
        };
      },
    });
    const search = async (query) => {
      guard();
      const id = namespace + ':youtube:' + createHash('sha256').update(query).digest('hex');
      const cached = await state.effect(id);
      if (cached !== undefined) return cached;
      const value = await searchMetadata(query, {
        limit: config.ytdlp.searchLimit,
        timeoutMs: config.ytdlp.timeoutMs,
      });
      guard();
      return state.saveEffect(id, value);
    };
    return { gemini, airtable: client, telegram: makeTelegram(), search, briefStore, auditStore };
  };
  const withSlot = async (work) => {
    for (let slot = 0; slot < config.server.maxConcurrentPipelines; slot++) {
      let entered = false;
      try {
        return await withLock('pipeline-slot:' + slot, async () => {
          entered = true;
          return work();
        });
      } catch (error) {
        if (entered || error.code !== 'DEFERRED') throw error;
      }
    }
    throw new DeferredError('Pipeline capacity is busy');
  };
  return { db, state, withLock, withSlot, clients, briefStore, productionStore, auditStore };
}
