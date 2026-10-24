import { JsonStateFile } from '../utils/jsonStateFile.js';
import { config } from '../config.js';
import { BriefSettingsSchema, BriefUpdateSchema, snapshotBrief } from './contract.js';

export class BriefStore {
  constructor({ filePath } = {}) { this.state = new JsonStateFile(filePath, { projects: {}, items: {} }); }
  defaults(projectKey) {
    return this.state.transaction(state => BriefSettingsSchema.parse(state.projects[JSON.stringify([projectKey])] || {}));
  }
  set(projectKey, settings) {
    const patch = BriefUpdateSchema.parse(settings);
    return this.state.transaction(state => {
      const key = JSON.stringify([projectKey]);
      const clean = BriefSettingsSchema.parse({ ...state.projects[key], ...patch });
      state.projects[key] = clean;
      return structuredClone(clean);
    });
  }
  get(projectKey, itemId) {
    return this.state.transaction(state => structuredClone(state.items[JSON.stringify([projectKey, itemId])] || null));
  }
  freeze(projectKey, itemId, form, origin = 'script', creation) {
    return this.state.transaction(state => {
      const key = JSON.stringify([projectKey, itemId]);
      if (!state.items[key]) state.items[key] = snapshotBrief(projectKey, itemId, form, state.projects[JSON.stringify([projectKey])] || {}, origin, creation);
      return structuredClone(state.items[key]);
    });
  }
}
export const productionBriefs = () => new BriefStore({ filePath: config.pipeline.briefStatePath });
