import { BriefSettingsSchema, BriefUpdateSchema, snapshotBrief } from '../briefs/contract.js';

export class CloudBriefStore {
  constructor(db, guard = () => {}) { this.db = db; this.guard = guard; }
  async query(sql, args) { this.guard(); const result = await this.db.query(sql, args); this.guard(); return result; }
  async defaults(projectKey) {
    const result = await this.query('SELECT payload FROM app_project_briefs WHERE project_key=$1', [projectKey]);
    return BriefSettingsSchema.parse(result.rows[0]?.payload || {});
  }
  async set(projectKey, settings) {
    const patch = BriefUpdateSchema.parse(settings);
    const result = await this.query('INSERT INTO app_project_briefs(project_key,payload) VALUES($1,$2::jsonb || $3::jsonb) ON CONFLICT(project_key) DO UPDATE SET payload=app_project_briefs.payload || $3::jsonb RETURNING payload', [projectKey, BriefSettingsSchema.parse({}), patch]);
    return BriefSettingsSchema.parse(result.rows[0].payload);
  }
  async get(projectKey, itemId) {
    return (await this.query('SELECT payload FROM app_item_briefs WHERE project_key=$1 AND item_id=$2', [projectKey, itemId])).rows[0]?.payload || null;
  }
  async freeze(projectKey, itemId, form, origin = 'script', creation) {
    const existing = await this.get(projectKey, itemId);
    if (existing) return existing;
    const brief = snapshotBrief(projectKey, itemId, form, await this.defaults(projectKey), origin, creation);
    // First writer wins across function instances; retries return its original snapshot.
    const result = await this.query('INSERT INTO app_item_briefs(project_key,item_id,payload) VALUES($1,$2,$3) ON CONFLICT(project_key,item_id) DO UPDATE SET item_id=EXCLUDED.item_id RETURNING payload', [projectKey, itemId, brief]);
    return result.rows[0].payload;
  }
}
