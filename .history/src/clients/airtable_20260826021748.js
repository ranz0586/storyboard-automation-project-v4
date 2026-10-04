import Airtable from 'airtable';
import { config } from '../config.js';

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
  } = {}) {
    if (!apiKey && !base) throw new Error('AIRTABLE_API_KEY is not set');
    this.apiKey = apiKey;
    this.baseId = baseId;
    this.fetch = fetchImpl;
    this.base = base || new Airtable({ apiKey }).base(baseId);
    this.tables = config.airtable.tables;
    // Coerce near-miss values server-side (see config.airtable.typecast).
    this.writeOpts = { typecast: config.airtable.typecast };
  }

  // Airtable's performUpsert executes matching and persistence in one server
  // request. Unlike select-then-create, concurrent server/CLI processes cannot
  // both observe a missing row and create duplicates for the same stable key.
  async #upsert(table, fields, matchField) {
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
          records: [{ fields }],
          performUpsert: { fieldsToMergeOn: [matchField] },
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
      fields: record.fields,
      updated: !(data.createdRecords || []).includes(record.id),
    };
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

  async listProjects(maxRecords = 50) {
    const page = await this.base(this.tables.projects)
      .select({ maxRecords: Math.max(1, Math.min(Number(maxRecords) || 50, 100)) })
      .firstPage();
    return page.map((r) => ({ id: r.id, createdTime: r._rawJson?.createdTime, fields: r.fields }));
  }

  async createScript(fields) {
    const [rec] = await this.base(this.tables.scripts).create([{ fields }], this.writeOpts);
    return { id: rec.id, createdTime: rec._rawJson?.createdTime, fields: rec.fields };
  }

  // Idea-backed scripts use a deterministic video_id, allowing retries to
  // update an incomplete row instead of creating a duplicate.
  async upsertScript(fields, matchField = 'video_id') {
    return this.#upsert(this.tables.scripts, fields, matchField);
  }

  async findScriptByVideoId(videoId) {
    if (!videoId) return null;
    const page = await this.base(this.tables.scripts)
      .select({ filterByFormula: `{video_id} = ${escapeFormulaValue(videoId)}`, maxRecords: 1 })
      .firstPage();
    if (!page.length) return null;
    const rec = page[0];
    return { id: rec.id, createdTime: rec._rawJson?.createdTime, fields: rec.fields };
  }

  // The original workflow matched Ideas globally on title. Explicit projects
  // make that unsafe: two projects may legitimately generate the same title.
  // Narrow the candidate set by title, then only update a row with the same
  // linked Project set. A dedicated idea_id column would permit performUpsert,
  // but this preserves the live schema while preventing cross-project writes.
  async upsertIdea(fields, matchField = 'title') {
    const candidates = await this.base(this.tables.ideas)
      .select({
        filterByFormula: `{${matchField}} = ${escapeFormulaValue(fields[matchField])}`,
        maxRecords: 100,
      })
      .firstPage();
    const links = normalizedLinks(fields.Projects);
    const existing = candidates.find((record) => sameLinks(record.fields.Projects, links));
    if (existing) {
      const [record] = await this.base(this.tables.ideas)
        .update([{ id: existing.id, fields }], this.writeOpts);
      return { id: record.id, fields: record.fields, updated: true };
    }
    const [record] = await this.base(this.tables.ideas).create([{ fields }], this.writeOpts);
    return { id: record.id, fields: record.fields, updated: false };
  }

  // Recovery flow: find idea records whose script generation never completed.
  async searchIdeas(filterByFormula, maxRecords = 50) {
    const page = await this.base(this.tables.ideas)
      .select({ ...(filterByFormula ? { filterByFormula } : {}), maxRecords })
      .firstPage();
    return page.map((r) => ({ id: r.id, fields: r.fields }));
  }

  // Recovery counterpart to forEachEligibleIdea: keep at most one Airtable
  // page in memory and await each item before requesting the next page.
  // async forEachStuckIdea(filterByFormula, { limit = 50 } = {}, visit) {
  //   const max = Math.max(1, Math.min(Number(limit) || 50, 50));
  //   let visited = 0;
  //   await new Promise((resolve, reject) => {
  //     let settled = false;
  //     const finish = (error) => {
  //       if (settled) return;
  //       settled = true;
  //       error ? reject(error) : resolve();
  //     };
  //     this.base(this.tables.ideas).select({
  //       ...(filterByFormula ? { filterByFormula } : {}),
  //       pageSize: Math.min(100, max),
  //     }).eachPage(
  //       (records, next) => {
  //         Promise.resolve().then(async () => {
  //           for (const record of records) {
  //             await visit({ id: record.id, fields: record.fields });
  //             visited += 1;
  //             if (visited >= max) return finish();
  //           }
  //           next();
  //         }).catch(finish);
  //       },
  //       finish
  //     );
  //   });
  //   return visited;
  // }

  // Recovery counterpart to forEachEligibleIdea: keep at most one Airtable
  // page in memory and await each item before requesting the next page.
  // Uses Airtable REST pagination directly instead of the legacy SDK's
  // eachPage() implementation.
  async forEachStuckIdea(filterByFormula, { limit = 50 } = {}, visit) {
    const max = Math.max(1, Math.min(Number(limit) || 50, 50));
    let visited = 0;

    await this.#eachRestPage(
      this.tables.ideas,
      {
        ...(filterByFormula ? { filterByFormula } : {}),
        pageSize: Math.min(100, max),
      },
      async (records) => {
        for (const record of records) {
          await visit({ id: record.id, fields: record.fields });
          visited += 1;
          if (visited >= max) return false;
        }
        return true;
      }
    );

    return visited;
  }

  async updateIdea(id, fields) {
    const [rec] = await this.base(this.tables.ideas).update([{ id, fields }], this.writeOpts);
    return { id: rec.id, fields: rec.fields };
  }

  async getIdea(id) {
    const rec = await this.base(this.tables.ideas).find(id);
    return { id: rec.id, fields: rec.fields };
  }

  // Stream eligible ideas page-by-page and await each visitor before moving
  // on. This is the low-memory primitive used by count-based script runs.
  // async forEachEligibleIdea(projectId, { limit = 50 } = {}, visit) {
  //   const max = Math.max(1, Math.min(Number(limit) || 50, 50));
  //   let visited = 0;
  //   await new Promise((resolve, reject) => {
  //     let settled = false;
  //     const finish = (err) => {
  //       if (settled) return;
  //       settled = true;
  //       err ? reject(err) : resolve();
  //     };
  //     this.base(this.tables.ideas).select({
  //       filterByFormula: "OR({Idea Status} = 'Draft', {Idea Status} = BLANK())",
  //       pageSize: 100,
  //     }).eachPage(
  //       (records, next) => {
  //         Promise.resolve().then(async () => {
  //           for (const record of records) {
  //             const f = record.fields;
  //             const eligible = !f['Idea Status'] || f['Idea Status'] === 'Draft';
  //             if (!eligible || !(f.Projects || []).includes(projectId)) continue;
  //             await visit({ id: record.id, fields: f });
  //             visited += 1;
  //             if (visited >= max) return finish();
  //           }
  //           next();
  //         }).catch(finish);
  //       },
  //       finish
  //     );
  //   });
  //   return visited;
  // }

  // Stream eligible ideas page-by-page and await each visitor before moving
  // on. This is the low-memory primitive used by count-based script runs.
  // Uses Airtable REST pagination directly instead of the legacy SDK's
  // eachPage() implementation.
  async forEachEligibleIdea(projectId, { limit = 50 } = {}, visit) {
    const max = Math.max(1, Math.min(Number(limit) || 50, 50));
    let visited = 0;

    await this.#eachRestPage(
      this.tables.ideas,
      {
        filterByFormula: "OR({Idea Status} = 'Draft', {Idea Status} = BLANK())",
        pageSize: 100,
      },
      async (records) => {
        for (const record of records) {
          const f = record.fields;
          const eligible = !f['Idea Status'] || f['Idea Status'] === 'Draft';
          if (!eligible || !(f.Projects || []).includes(projectId)) continue;

          await visit({ id: record.id, fields: f });
          visited += 1;
          if (visited >= max) return false;
        }
        return true;
      }
    );

    return visited;
  }

  async listIdeasForProject(projectId, limit = 50) {
    const ideas = [];
    await this.forEachEligibleIdea(projectId, { limit }, async (idea) => ideas.push(idea));
    return ideas;
  }

  // Storyboard branch: resolve the project a script links to.
  async getProject(id) {
    const rec = await this.base(this.tables.projects).find(id);
    return { id: rec.id, fields: rec.fields };
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
    const ids = new Set(projectIds);
    if (!ids.size) return {};

    const stats = new Map([...ids].map((id) => [id, {
      ideas: 0,
      scripts: 0,
      approvedScripts: 0,
      storyboards: 0,
      failedRecoveryItems: 0,
    }]));

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
      }
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
        }
      );

      return Object.fromEntries(stats);
  }

  // async #eachRecord(table, fields, visit) {
  //   await new Promise((resolve, reject) => {
  //     this.base(table).select({ fields, pageSize: 100 }).eachPage(
  //       (records, next) => {
  //         for (const record of records) visit(record);
  //         next();
  //       },
  //       (err) => err ? reject(err) : resolve()
  //     );
  //   });
  // }

  // Generic low-memory Airtable REST paginator.
  // Returns one page at a time and follows Airtable's offset cursor.
  // The callback should return false to stop pagination early.
  async #eachRestPage(table, params = {}, visitPage) {
    let offset;

    do {
      const search = new URLSearchParams();

      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;

        if (key === 'fields' && Array.isArray(value)) {
          for (const field of value) {
            search.append('fields[]', field);
          }
        } else {
          search.set(key, String(value));
        }
      }

      if (offset) {
        search.set('offset', offset);
      }

      const response = await this.fetch(
        `https://api.airtable.com/v0/${encodeURIComponent(this.baseId)}/${encodeURIComponent(table)}?${search.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          data?.error?.message ||
          data?.error?.type ||
          `HTTP ${response.status}`;

        const error = new Error(`Airtable list failed: ${detail}`);
        error.statusCode = response.status;
        throw error;
      }

      const shouldContinue = await visitPage(data.records || []);

      if (shouldContinue === false) {
        return;
      }

      offset = data.offset;
    } while (offset);
  }

  async #eachRecord(table, fields, visit) {
    await this.#eachRestPage(
      table,
      { fields, pageSize: 100 },
      async (records) => {
        for (const record of records) {
          visit(record);
        }

        return true;
      }
    );
  }

  // Storyboard branch: one row per script, keyed by storyboard_id (= video_id).
  async upsertStoryboard(fields, matchField = 'storyboard_id') {
    return this.#upsert(this.tables.storyboards, fields, matchField);
  }

  // Storyboard branch: find script records needing a storyboard.
  async searchScripts(filterByFormula, maxRecords = 50) {
    const page = await this.base(this.tables.scripts)
      .select({ ...(filterByFormula ? { filterByFormula } : {}), maxRecords })
      .firstPage();
    return page.map((r) => ({ id: r.id, createdTime: r._rawJson?.createdTime, fields: r.fields }));
  }

  async updateScript(id, fields) {
    const [rec] = await this.base(this.tables.scripts).update([{ id, fields }], this.writeOpts);
    return { id: rec.id, fields: rec.fields };
  }
}

function escapeFormulaValue(v) {
  return `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizedLinks(value) {
  return [...new Set(Array.isArray(value) ? value.map(String) : [])].sort();
}

function sameLinks(actual, expected) {
  const links = normalizedLinks(actual);
  return links.length === expected.length && links.every((id, index) => id === expected[index]);
}

export const airtable = () => new AirtableClient();
