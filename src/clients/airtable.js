import Airtable from 'airtable';
import { config } from '../config.js';
import { projectKey, normalizeRecord } from '../utils/project.js';

// Wraps the Airtable operations used by the workflow:
//  - Save to Project (create)     -> Projects table
//  - Save Ideas to Airtable (title scoped to linked Project) -> Ideas table
//  - Save to Airtable (create)    -> Scripts table
//  - Search records / Get a record -> Scripts table (storyboard branch)
export class AirtableClient {
  constructor({
    apiKey = config.airtable.apiKey,
    baseId = config.airtable.baseId,
    base,
    fetchImpl = globalThis.fetch,
    identityFieldsHaveBom = config.airtable.identityFieldsHaveBom,
  } = {}) {
    if (!apiKey && !base) throw new Error('AIRTABLE_API_KEY is not set');
    this.apiKey = apiKey;
    this.baseId = baseId;
    this.fetch = fetchImpl;
    this.base = base || new Airtable({ apiKey }).base(baseId);
    this.tables = config.airtable.tables;
    // Keep application fields clean and translate legacy BOM names only at
    // the API boundary. The three live tables do not share one naming rule.
    const bom = typeof identityFieldsHaveBom === 'boolean'
      ? { ideas: identityFieldsHaveBom, scripts: identityFieldsHaveBom, storyboards: identityFieldsHaveBom }
      : identityFieldsHaveBom;
    this.identityFields = {
      ...(bom.ideas ? { [this.tables.ideas]: { title: '\ufefftitle' } } : {}),
      ...(bom.scripts ? { [this.tables.scripts]: { video_id: '\ufeffvideo_id' } } : {}),
      ...(bom.storyboards ? { [this.tables.storyboards]: { storyboard_id: '\ufeffstoryboard_id' } } : {}),
    };
    // Coerce near-miss values server-side (see config.airtable.typecast).
    this.writeOpts = { typecast: config.airtable.typecast };
  }

  // Airtable's performUpsert executes matching and persistence in one server
  // request. Unlike select-then-create, concurrent server/CLI processes cannot
  // both observe a missing row and create duplicates for the same stable key.
  async #upsert(table, fields, matchFields) {
    if (!this.apiKey || typeof this.fetch !== 'function') {
      throw new Error('Atomic Airtable upsert requires an API key and fetch implementation');
    }
    const response = await this.fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(this.baseId)}/${encodeURIComponent(table)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: [{ fields: this.#storageFields(table, fields) }],
          performUpsert: { fieldsToMergeOn: [matchFields].flat().map((field) => this.#fieldName(table, field)) },
          typecast: this.writeOpts.typecast,
        }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || data?.error?.type || `HTTP ${response.status}`;
      const error = new Error(`Airtable upsert failed: ${detail}`);
      error.statusCode = response.status;
      throw error;
    }
    const record = data.records?.[0];
    if (!record?.id) throw new Error('Airtable upsert returned no record');
    return {
      id: record.id,
      createdTime: record.createdTime,
      fields: normalizeRecord(record).fields,
      updated: !(data.createdRecords || []).includes(record.id),
    };
  }

  #fieldName(table, name) {
    return this.identityFields[table]?.[name] || name;
  }

  #storageFields(table, fields) {
    return Object.fromEntries(Object.entries(fields).map(([name, value]) => [this.#fieldName(table, name), value]));
  }

  // Projects are keyed by project_id (niche + "_" + platform-without-spaces);
  // a rerun updates the existing project instead of creating a duplicate.
  async upsertProject(fields, matchField = 'project_id') {
    return this.#upsert(this.tables.projects, fields, matchField);
  }

  // Dashboard project creation is explicit, but requestId-backed project_id
  // makes a retried POST return the same record rather than duplicating it.
  async createProject(fields) {
    return this.#upsert(this.tables.projects, fields, 'project_id');
  }

  async findUserByUsername(username) {
    const records = await this.base(this.tables.users).select({
      filterByFormula: `LOWER({username}) = ${escapeFormulaValue(username)}`, maxRecords: 2,
    }).firstPage();
    if (records.length > 1) throw new Error('Duplicate username');
    return records.length ? normalizeRecord({ id: records[0].id, fields: records[0].fields }) : null;
  }

  async getUser(id) {
    const record = await this.base(this.tables.users).find(id);
    return normalizeRecord({ id: record.id, fields: record.fields });
  }

  async createUser(fields) {
    const [record] = await this.base(this.tables.users).create([{ fields }], this.writeOpts);
    return normalizeRecord({ id: record.id, fields: record.fields });
  }

  async listProjectsForUser(user, limit = 50) {
    const ids = [...new Set(user.projectIds)].slice(0, Math.max(1, Math.min(Number(limit) || 50, 100)));
    if (!ids.length) return [];
    const records = await this.base(this.tables.projects).select({
      filterByFormula: `OR(${ids.map(id => `RECORD_ID() = ${escapeFormulaValue(id)}`).join(',')})`,
      maxRecords: ids.length,
    }).firstPage();
    return records.map(record => normalizeRecord({ id: record.id, createdTime: record._rawJson?.createdTime, fields: record.fields }));
  }

  async listProjectsPageForUser(user, { limit = 50, offset } = {}) {
    const ids = [...new Set(user.projectIds)].sort();
    const start = offset ? ids.indexOf(offset) + 1 : 0;
    if (offset && start === 0) throw Object.assign(new Error('Invalid project page cursor'), { statusCode: 400 });
    const size = Math.max(1, Math.min(Number(limit) || 50, 50));
    const pageIds = ids.slice(start, start + size);
    const projects = await this.listProjectsForUser({ ...user, projectIds: pageIds }, size);
    const byId = new Map(projects.map(project => [project.id, project]));
    return { projects: pageIds.map(id => byId.get(id)).filter(Boolean),
      nextOffset: start + size < ids.length ? pageIds.at(-1) : null };
  }

  async listProjects(maxRecords = 50) {
    const page = await this.base(this.tables.projects)
      .select({ maxRecords: Math.max(1, Math.min(Number(maxRecords) || 50, 100)) })
      .firstPage();
    return page.map((r) => ({ id: r.id, createdTime: r._rawJson?.createdTime, fields: r.fields }));
  }

  async createScript(fields) {
    const [rec] = await this.base(this.tables.scripts).create([{ fields: this.#storageFields(this.tables.scripts, fields) }], this.writeOpts);
    return normalizeRecord({ id: rec.id, createdTime: rec._rawJson?.createdTime, fields: rec.fields });
  }

  // Idea-backed scripts use a deterministic video_id, allowing retries to
  // update an incomplete row instead of creating a duplicate.
  async upsertScript(fields, matchField = 'video_id') {
    return this.#upsert(this.tables.scripts, fields, matchField);
  }

  async findScriptByVideoId(videoId) {
    if (!videoId) return null;
    const page = await this.base(this.tables.scripts)
      .select({ filterByFormula: `{${this.#fieldName(this.tables.scripts, 'video_id')}} = ${escapeFormulaValue(videoId)}`, maxRecords: 1 })
      .firstPage();
    if (!page.length) return null;
    const rec = page[0];
    return normalizeRecord({ id: rec.id, createdTime: rec._rawJson?.createdTime, fields: rec.fields });
  }

  async findStoryboardById(storyboardId) {
    if (!storyboardId) return null;
    const page = await this.base(this.tables.storyboards).select({
      filterByFormula: `{${this.#fieldName(this.tables.storyboards, 'storyboard_id')}} = ${escapeFormulaValue(storyboardId)}`,
      maxRecords: 2,
    }).firstPage();
    if (page.length > 1) throw new Error('Multiple storyboards share the same storyboard_id');
    if (!page.length) return null;
    const record = page[0];
    return normalizeRecord({ id: record.id, fields: record.fields });
  }

  // The original workflow matched Ideas globally on title. Explicit projects
  // make that unsafe: two projects may legitimately generate the same title.
  // Match title within the scalar project key used by the live Ideas table.
  // Both fields are simple text/select fields, so Airtable can match them in
  // one atomic request even when two workers save the same idea concurrently.
  async upsertIdea(fields, matchField = 'title') {
    if (typeof fields.Projects !== 'string' || !fields.Projects.trim()) {
      throw new Error('Idea requires a scalar Projects project key');
    }
    if (typeof fields[matchField] !== 'string' || !fields[matchField].trim()) {
      throw new Error(`Idea requires ${matchField}`);
    }
    return this.#upsert(this.tables.ideas, fields, [matchField, 'Projects']);
  }

  // Recovery flow: find idea records whose script generation never completed.
  async searchIdeas(filterByFormula, maxRecords = 50) {
    const page = await this.base(this.tables.ideas)
      .select({ ...(filterByFormula ? { filterByFormula } : {}), maxRecords })
      .firstPage();
    return page.map((r) => normalizeRecord({ id: r.id, fields: r.fields }));
  }

  // Recovery counterpart to forEachEligibleIdea: keep at most one Airtable
  // page in memory and await each item before requesting the next page.
  async forEachStuckIdea(filterByFormula, { limit = 50 } = {}, visit) {
    const max = Math.max(1, Math.min(Number(limit) || 50, 50));
    let visited = 0;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };
      this.base(this.tables.ideas).select({
        ...(filterByFormula ? { filterByFormula } : {}),
        pageSize: Math.min(100, max),
      }).eachPage(
        (records, next) => {
          Promise.resolve().then(async () => {
            for (const record of records) {
              await visit(normalizeRecord({ id: record.id, fields: record.fields }));
              visited += 1;
              if (visited >= max) return finish();
            }
            next();
          }).catch(finish);
        },
        finish
      );
    });
    return visited;
  }

  // Recovery counterpart to forEachEligibleIdea: keep at most one Airtable
  // page in memory and await each item before requesting the next page.
  // Uses Airtable REST pagination directly instead of the legacy SDK's
  // eachPage() implementation.
  // async forEachStuckIdea(filterByFormula, { limit = 50 } = {}, visit) {
  //   const max = Math.max(1, Math.min(Number(limit) || 50, 50));
  //   let visited = 0;

  //   await this.#eachRestPage(
  //     this.tables.ideas,
  //     {
  //       ...(filterByFormula ? { filterByFormula } : {}),
  //       pageSize: Math.min(100, max),
  //     },
  //     async (records) => {
  //       for (const record of records) {
  //         await visit({ id: record.id, fields: record.fields });
  //         visited += 1;
  //         if (visited >= max) return false;
  //       }
  //       return true;
  //     }
  //   );

  //   return visited;
  // }

  async updateIdea(id, fields) {
    const [rec] = await this.base(this.tables.ideas).update([{ id, fields: this.#storageFields(this.tables.ideas, fields) }], this.writeOpts);
    return normalizeRecord({ id: rec.id, fields: rec.fields });
  }

  async getIdea(id) {
    const rec = await this.base(this.tables.ideas).find(id);
    return normalizeRecord({ id: rec.id, fields: rec.fields });
  }

  // Stream eligible ideas page-by-page and await each visitor before moving
  // on. This is the low-memory primitive used by count-based script runs.
  async forEachEligibleIdea(projectId, { limit = 50 } = {}, visit) {
    const max = Math.max(1, Math.min(Number(limit) || 50, 50));
    const key = projectKey(await this.getProject(projectId));
    let visited = 0;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };
      this.base(this.tables.ideas).select({
        filterByFormula: `AND({Projects} = ${escapeFormulaValue(key)}, OR({Idea Status} = 'Draft', {Idea Status} = BLANK()))`,
        maxRecords: max,
        pageSize: Math.min(100, max),
      }).eachPage(
        (records, next) => {
          Promise.resolve().then(async () => {
            for (const record of records) {
              const f = record.fields;
              const eligible = !f['Idea Status'] || f['Idea Status'] === 'Draft';
              if (!eligible || f.Projects !== key) continue;
              await visit(normalizeRecord({ id: record.id, fields: f }));
              visited += 1;
              if (visited >= max) return finish();
            }
            next();
          }).catch(finish);
        },
        finish
      );
    });
    return visited;
  }

  // Stream eligible ideas page-by-page and await each visitor before moving
  // on. This is the low-memory primitive used by count-based script runs.
  // Uses Airtable REST pagination directly instead of the legacy SDK's
  // eachPage() implementation.
  // async forEachEligibleIdea(projectId, { limit = 50 } = {}, visit) {
  //   const max = Math.max(1, Math.min(Number(limit) || 50, 50));
  //   let visited = 0;

  //   await this.#eachRestPage(
  //     this.tables.ideas,
  //     {
  //       filterByFormula: "OR({Idea Status} = 'Draft', {Idea Status} = BLANK())",
  //       pageSize: 100,
  //     },
  //     async (records) => {
  //       for (const record of records) {
  //         const f = record.fields;
  //         const eligible = !f['Idea Status'] || f['Idea Status'] === 'Draft';
  //         if (!eligible || !(f.Projects || []).includes(projectId)) continue;

  //         await visit({ id: record.id, fields: f });
  //         visited += 1;
  //         if (visited >= max) return false;
  //       }
  //       return true;
  //     }
  //   );

  //   return visited;
  // }

  async listIdeasForProject(projectId, limit = 50) {
    const ideas = [];
    await this.forEachEligibleIdea(projectId, { limit }, async (idea) => ideas.push(idea));
    return ideas;
  }

  async listIdeasPageForProject(projectId, { limit = 50, offset } = {}) {
    const key = projectKey(await this.getProject(projectId));
    const params = new URLSearchParams({
      filterByFormula: `AND({Projects} = ${escapeFormulaValue(key)}, OR({Idea Status} = 'Draft', {Idea Status} = BLANK()))`,
      pageSize: String(Math.max(1, Math.min(Number(limit) || 50, 50))),
      'sort[0][field]': this.#fieldName(this.tables.ideas, 'title'),
      'sort[0][direction]': 'asc',
    });
    if (offset) params.set('offset', offset);
    const response = await this.fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(this.baseId)}/${encodeURIComponent(this.tables.ideas)}?${params}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) throw Object.assign(new Error(`Idea listing failed (HTTP ${response.status})`), { statusCode: response.status });
    const data = await response.json();
    return { ideas: (data.records || []).map(normalizeRecord), nextOffset: data.offset || null };
  }

  // Storyboard branch: resolve the project a script links to.
  async getProject(id) {
    const rec = await this.base(this.tables.projects).find(id);
    return normalizeRecord({ id: rec.id, fields: rec.fields });
  }

  async findProjectByKey(key) {
    if (!key) return null;
    const page = await this.base(this.tables.projects)
      .select({ filterByFormula: `{project_id} = ${escapeFormulaValue(key)}`, maxRecords: 1 })
      .firstPage();
    if (!page.length) return null;
    const record = page[0];
    return normalizeRecord({ id: record.id, fields: record.fields });
  }

  async updateProjectStatus(id, status) {
    const [record] = await this.base(this.tables.projects).update([{ id, fields: { status } }], this.writeOpts);
    return normalizeRecord({ id: record.id, fields: record.fields });
  }

  async getScript(id) {
    const record = await this.base(this.tables.scripts).find(id);
    return normalizeRecord({ id: record.id, fields: record.fields });
  }

  async listScriptsForProject(projectId, { limit = 25, offset } = {}) {
    const key = projectKey(await this.getProject(projectId));
    const params = new URLSearchParams({
      filterByFormula: `{Projects} = ${escapeFormulaValue(key)}`,
      pageSize: String(Math.max(1, Math.min(Number(limit) || 25, 50))),
    });
    if (offset) params.set('offset', offset);
    const response = await this.fetch(
      `https://api.airtable.com/v0/${encodeURIComponent(this.baseId)}/${encodeURIComponent(this.tables.scripts)}?${params}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) throw Object.assign(new Error(`Script listing failed (HTTP ${response.status})`), { statusCode: response.status });
    const data = await response.json();
    return { scripts: (data.records || []).map(normalizeRecord), nextOffset: data.offset || null };
  }

  // async projectStats(projectIds) {
  //   const ids = new Set(projectIds);
  //   if (!ids.size) return {};
  //   const stats = new Map([...ids].map((id) => [id, {
  //     ideas: 0,
  //     scripts: 0,
  //     approvedScripts: 0,
  //     storyboards: 0,
  //     failedRecoveryItems: 0,
  //   }]));

  //   await this.#eachRecord(this.tables.ideas, ['Projects', 'Idea Status'], (record) => {
  //     const status = record.fields['Idea Status'];
  //     for (const id of record.fields.Projects || []) {
  //       if (!ids.has(id)) continue;
  //       const item = stats.get(id);
  //       item.ideas += 1;
  //       if (!status || status === 'Draft') item.failedRecoveryItems += 1;
  //     }
  //   });

  //   await this.#eachRecord(this.tables.scripts, ['Projects', 'status'], (record) => {
  //     const linked = (record.fields.Projects || []).filter((id) => ids.has(id));
  //     if (!linked.length) return;
  //     for (const id of linked) {
  //       const item = stats.get(id);
  //       item.scripts += 1;
  //       if (record.fields.status === 'Approved') item.approvedScripts += 1;
  //       // The storyboard pipeline changes this status only after its atomic
  //       // storyboard upsert succeeds, making the script lifecycle a compact,
  //       // constant-memory source for the dashboard count.
  //       if (record.fields.status === 'Story Generated') item.storyboards += 1;
  //     }
  //   });
  //   return Object.fromEntries(stats);
  // }

  async projectStats(projectIds) {
    const ids = new Set(projectIds.filter((id) => typeof id === 'string' && id.trim()));
    if (!ids.size) return {};
    const stats = new Map([...ids].map((id) => [id, {
      ideas: 0,
      scripts: 0,
      approvedScripts: 0,
      storyboards: 0,
      failedRecoveryItems: 0,
    }]));

    // Keep formulas bounded and query only requested project keys, not the base.
    const keys = [...ids];
    for (let start = 0; start < keys.length; start += 25) {
      const filterByFormula = `OR(${keys.slice(start, start + 25).map((id) => `{Projects} = ${escapeFormulaValue(id)}`).join(',')})`;
      await this.#eachRecord(
      this.tables.ideas,
      ['Projects', 'Idea Status'],
      (record) => {
        const status = record.fields['Idea Status'];
        const projectId = record.fields.Projects;

        if (!projectId || !ids.has(projectId)) return;

        const item = stats.get(projectId);
        item.ideas += 1;

        if (!status || status === 'Draft') {
          item.failedRecoveryItems += 1;
        }
      }, filterByFormula
    );

    await this.#eachRecord(
        this.tables.scripts,
        ['Projects', 'status'],
        (record) => {
          const projectId = record.fields.Projects;

          if (!projectId || !ids.has(projectId)) return;

          const item = stats.get(projectId);

          item.scripts += 1;

          if (record.fields.status === 'Approved') {
            item.approvedScripts += 1;
          }

          // The storyboard pipeline changes this status only after its atomic
          // storyboard upsert succeeds, making the script lifecycle a compact,
          // constant-memory source for the dashboard count.
          if (record.fields.status === 'Story Generated') {
            item.storyboards += 1;
          }
        }, filterByFormula
      );
    }

      return Object.fromEntries(stats);
  }

  async #eachRecord(table, fields, visit, filterByFormula) {
    await new Promise((resolve, reject) => {
      this.base(table).select({ fields, pageSize: 100, filterByFormula }).eachPage(
        (records, next) => {
          for (const record of records) visit(record);
          next();
        },
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  // Generic low-memory Airtable REST paginator.
  // Returns one page at a time and follows Airtable's offset cursor.
  // The callback should return false to stop pagination early.
  // async #eachRestPage(table, params = {}, visitPage) {
  //   let offset;

  //   do {
  //     const search = new URLSearchParams();

  //     for (const [key, value] of Object.entries(params)) {
  //       if (value === undefined || value === null || value === '') continue;

  //       if (key === 'fields' && Array.isArray(value)) {
  //         for (const field of value) {
  //           search.append('fields[]', field);
  //         }
  //       } else {
  //         search.set(key, String(value));
  //       }
  //     }

  //     if (offset) {
  //       search.set('offset', offset);
  //     }

  //     const response = await this.fetch(
  //       `https://api.airtable.com/v0/${encodeURIComponent(this.baseId)}/${encodeURIComponent(table)}?${search.toString()}`,
  //       {
  //         method: 'GET',
  //         headers: {
  //           Authorization: `Bearer ${this.apiKey}`,
  //         },
  //       }
  //     );

  //     const data = await response.json().catch(() => ({}));

  //     if (!response.ok) {
  //       const detail =
  //         data?.error?.message ||
  //         data?.error?.type ||
  //         `HTTP ${response.status}`;

  //       const error = new Error(`Airtable list failed: ${detail}`);
  //       error.statusCode = response.status;
  //       throw error;
  //     }

  //     const shouldContinue = await visitPage(data.records || []);

  //     if (shouldContinue === false) {
  //       return;
  //     }

  //     offset = data.offset;
  //   } while (offset);
  // }

  // async #eachRecord(table, fields, visit) {
  //   await this.#eachRestPage(
  //     table,
  //     { fields, pageSize: 100 },
  //     async (records) => {
  //       for (const record of records) {
  //         visit(record);
  //       }

  //       return true;
  //     }
  //   );
  // }

  // Storyboard branch: one row per script, keyed by storyboard_id (= video_id).
  async upsertStoryboard(fields, matchField = 'storyboard_id') {
    return this.#upsert(this.tables.storyboards, fields, matchField);
  }

  // Storyboard branch: find script records needing a storyboard.
  async searchScripts(filterByFormula, maxRecords = 50) {
    const page = await this.base(this.tables.scripts)
      .select({ ...(filterByFormula ? { filterByFormula } : {}), maxRecords })
      .firstPage();
    return page.map((r) => normalizeRecord({ id: r.id, createdTime: r._rawJson?.createdTime, fields: r.fields }));
  }

  async updateScript(id, fields) {
    const [rec] = await this.base(this.tables.scripts).update([{ id, fields: this.#storageFields(this.tables.scripts, fields) }], this.writeOpts);
    return normalizeRecord({ id: rec.id, fields: rec.fields });
  }
}

function escapeFormulaValue(v) {
  return `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export const airtable = () => new AirtableClient();
