import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/clients/airtable.js';

test('project pages use only owned IDs, stable cursors and bounded queries', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `recPage${String(i + 1).padStart(3, '0')}`);
  const sizes = [];
  const client = new AirtableClient({ base: () => ({ select: options => {
    const selected = ids.filter(id => options.filterByFormula.includes(`"${id}"`));
    sizes.push(selected.length);
    return { firstPage: async () => selected.toReversed().map(id => ({ id, fields: {} })) };
  } }) });
  const first = await client.listProjectsPageForUser({ projectIds: ids });
  assert.equal(first.projects.length, 50); assert.equal(first.nextOffset, ids[49]);
  const last = await client.listProjectsPageForUser({ projectIds: ids }, { offset: first.nextOffset });
  assert.deepEqual(last.projects.map(row => row.id), [ids[50]]); assert.equal(last.nextOffset, null);
  assert.deepEqual(sizes, [50, 1]);
  await assert.rejects(client.listProjectsPageForUser({ projectIds: ids }, { offset: 'recOtherUser' }), /Invalid project page cursor/);
});

test('idea pages are project scoped, Draft-only, cursor bounded and BOM normalized', async () => {
  let requested;
  const client = new AirtableClient({ apiKey: 'test-token', base: () => ({ find: async () => ({ id: 'recProject', fields: { project_id: 'Science_YouTube' } }) }),
    fetchImpl: async url => { requested = new URL(url); return { ok: true, json: async () => ({
      records: [{ id: 'recIdea', fields: { '\ufefftitle': 'Science' } }], offset: 'next-page' }) }; } });
  const page = await client.listIdeasPageForProject('recProject', { limit: 50, offset: 'cursor' });
  assert.equal(page.ideas[0].fields.title, 'Science'); assert.equal(page.nextOffset, 'next-page');
  assert.equal(requested.searchParams.get('offset'), 'cursor');
  assert.equal(requested.searchParams.get('pageSize'), '50');
  assert.match(requested.searchParams.get('filterByFormula'), /Science_YouTube.*Draft.*BLANK/);
  assert.equal(requested.searchParams.get('sort[0][field]'), '\ufefftitle');
});

test('storyboard identity lookup escapes values, normalizes fields and rejects duplicates', async () => {
  let selected, records = [];
  const client = new AirtableClient({ base: table => ({ select: options => {
    assert.equal(table, 'Storyboard'); selected = options;
    return { firstPage: async () => records };
  } }), identityFieldsHaveBom: { ideas: true, scripts: false, storyboards: true } });
  assert.equal(await client.findStoryboardById('a"b'), null);
  assert.equal(selected.filterByFormula, '{\ufeffstoryboard_id} = "a\\"b"');
  assert.equal(selected.maxRecords, 2);
  records = [{ id: 'recStory', fields: { '\ufeffstoryboard_id': 'a"b' } }];
  assert.equal((await client.findStoryboardById('a"b')).fields.storyboard_id, 'a"b');
  records.push({ id: 'recOther', fields: {} });
  await assert.rejects(client.findStoryboardById('a"b'), /Multiple storyboards/);
});

test('user lookup escapes formulas and rejects duplicate usernames', async () => {
  let selected, records = [];
  const client = new AirtableClient({ base: table => ({ select: options => {
    assert.equal(table, 'Users'); selected = options;
    return { firstPage: async () => records };
  } }) });
  assert.equal(await client.findUserByUsername('a"b'), null);
  assert.equal(selected.filterByFormula, 'LOWER({username}) = "a\\"b"');
  assert.equal(selected.maxRecords, 2);
  records = [{ id: 'recOne', fields: { username: 'tester' } }];
  assert.equal((await client.findUserByUsername('tester')).id, 'recOne');
  records.push({ id: 'recTwo', fields: { username: 'tester' } });
  await assert.rejects(client.findUserByUsername('tester'), /Duplicate username/);
});

test('account persistence uses typecast and user project reads use linked record IDs', async () => {
  const calls = [];
  const client = new AirtableClient({ base: table => ({
    create: async (records, options) => { calls.push({ table, records, options }); return [{ id: 'recUser', fields: records[0].fields }]; },
    find: async id => ({ id, fields: { username: 'tester' } }),
    select: options => { calls.push({ table, options }); return { firstPage: async () => [{ id: 'recProject', fields: { project_id: 'custom-key' } }] }; },
  }) });
  await client.createUser({ username: 'tester', password_hash: 'hashed-value', status: 'Active' });
  assert.equal(calls[0].table, 'Users'); assert.equal(calls[0].options.typecast, true);
  assert.equal((await client.getUser('recUser')).id, 'recUser');
  assert.deepEqual(await client.listProjectsForUser({ projectIds: [] }), []);
  assert.equal(calls.length, 1);
  const projects = await client.listProjectsForUser({ projectIds: ['recProject', 'recProject', 'recOther'] }, 1);
  assert.equal(projects[0].fields.project_id, 'custom-key');
  assert.equal(calls[1].options.filterByFormula, 'OR(RECORD_ID() = "recProject")');
  assert.equal(calls[1].options.maxRecords, 1);
});

test('storyboard reads resolve project key and normalize Airtable field names', async () => {
  const selections = [];
  const client = new AirtableClient({
    apiKey: 'test',
    base: (name) => ({
      select: (options) => {
        selections.push({ name, options });
        return { firstPage: async () => name === 'Projects'
          ? [{ id: 'recProject1', fields: { project_id: 'Parenting_Facebook' } }]
          : [{ id: 'recScript1', fields: { '\ufeffvideo_id': 'video-1', Projects: 'Parenting_Facebook' } }] };
      },
    }),
  });
  const project = await client.findProjectByKey('Parenting_Facebook');
  const [script] = await client.searchScripts("{status} = 'Approved'");
  assert.equal(project.id, 'recProject1');
  assert.match(selections[0].options.filterByFormula, /project_id.*Parenting_Facebook/);
  assert.equal(script.fields.video_id, 'video-1');
});

test('stable-key persistence uses Airtable performUpsert in one request', async () => {
  const calls = [];
  const client = new AirtableClient({
    apiKey: 'test-token',
    baseId: 'app test',
    base: () => { throw new Error('SDK base should not be used for atomic upsert'); },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          records: [{ id: 'recScript1', fields: { video_id: 'idea_recIdea1' } }],
          createdRecords: ['recScript1'],
          updatedRecords: [],
        }),
      };
    },
  });

  const result = await client.upsertScript({ video_id: 'idea_recIdea1', title: 'One' });
  assert.equal(result.id, 'recScript1');
  assert.equal(result.updated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.performUpsert, { fieldsToMergeOn: ['video_id'] });
  assert.equal(body.records[0].fields.video_id, 'idea_recIdea1');
  assert.equal(body.records[0].fields.title, 'One');
  assert.match(calls[0].url, /app%20test\/Scripts$/);
});

test('atomic upsert reports Airtable failures without exposing credentials', async () => {
  const client = new AirtableClient({
    apiKey: 'do-not-leak',
    base: () => {},
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { type: 'INVALID_REQUEST', message: 'Bad merge field' } }),
    }),
  });

  await assert.rejects(
    client.upsertScript({ video_id: 'idea_recIdea1' }),
    (error) => error.statusCode === 422 &&
      /Bad merge field/.test(error.message) &&
      !error.message.includes('do-not-leak')
  );
});

test('idea upsert atomically matches title and scalar project key', async () => {
  const rows = new Map();
  const bodies = [];
  const client = new AirtableClient({
    apiKey: 'test',
    base: () => { throw new Error('SDK base should not be used'); },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      const fields = body.records[0].fields;
      const key = `${fields['\ufefftitle']}|${fields.Projects}`;
      const existing = rows.get(key);
      const record = { id: existing?.id || `rec${rows.size + 1}`, fields };
      rows.set(key, record);
      return { ok: true, json: async () => ({ records: [record], createdRecords: existing ? [] : [record.id] }) };
    },
  });
  const first = await client.upsertIdea({ title: 'Shared', Projects: 'Parenting_Facebook' });
  const retry = await client.upsertIdea({ title: 'Shared', Projects: 'Parenting_Facebook' });
  const other = await client.upsertIdea({ title: 'Shared', Projects: 'Science_Facebook' });
  assert.equal(first.id, retry.id);
  assert.equal(retry.updated, true);
  assert.notEqual(first.id, other.id);
  assert.equal(rows.size, 2);
  assert.deepEqual(bodies[0].performUpsert.fieldsToMergeOn, ['\ufefftitle', 'Projects']);
  assert.equal(bodies[0].typecast, true);
  assert.equal(first.fields.title, 'Shared');
});

test('storyboard upsert uses the current plain identity field name', async () => {
  let body;
  const client = new AirtableClient({
    apiKey: 'test',
    base: () => { throw new Error('SDK should not be used'); },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ records: [{ id: 'recStoryboard1', fields: body.records[0].fields }] }) };
    },
  });
  const result = await client.upsertStoryboard({ storyboard_id: 'video-1', script_id: 'recScript1' });
  assert.deepEqual(body.performUpsert.fieldsToMergeOn, ['storyboard_id']);
  assert.equal(body.records[0].fields.storyboard_id, 'video-1');
  assert.equal(result.fields.storyboard_id, 'video-1');
});

test('bases with plain identity names can disable BOM translation', async () => {
  let body;
  const client = new AirtableClient({
    apiKey: 'test', identityFieldsHaveBom: false,
    base: () => { throw new Error('SDK should not be used'); },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ records: [{ id: 'recScript1', fields: body.records[0].fields }] }) };
    },
  });
  await client.upsertScript({ video_id: 'idea_recIdea1' });
  assert.deepEqual(body.performUpsert.fieldsToMergeOn, ['video_id']);
  assert.equal(body.records[0].fields.video_id, 'idea_recIdea1');
});

test('script lookup uses the current plain identity field name and normalizes legacy rows', async () => {
  let formula;
  const client = new AirtableClient({ apiKey: 'test', base: () => ({
    select: (options) => {
      formula = options.filterByFormula;
      return { firstPage: async () => [{ id: 'recScript1', fields: { '\ufeffvideo_id': 'idea_recIdea1' } }] };
    },
  }) });
  const script = await client.findScriptByVideoId('idea_recIdea1');
  assert.equal(formula, '{video_id} = "idea_recIdea1"');
  assert.equal(script.fields.video_id, 'idea_recIdea1');
});

test('project statistics count scalar project keys across pages and isolate projects', async () => {
  // Statistics use the scalar custom project key confirmed in the live base.
  const selectedTables = [];
  const records = {
    Ideas: [
      { fields: { Projects: 'Parenting_Facebook', 'Idea Status': 'Draft' } },
      { fields: { Projects: 'Science_YouTube', 'Idea Status': 'Script Generated' } },
      { fields: { Projects: 'Parenting_Facebook' } },
      { fields: { Projects: 'Parenting_Facebook', 'Idea Status': 'Script Generated' } },
      { fields: { Projects: 'Unrequested', 'Idea Status': 'Draft' } },
      { fields: { 'Idea Status': 'Draft' } },
    ],
    Scripts: [
      { fields: { Projects: 'Parenting_Facebook', status: 'Approved' } },
      { fields: { Projects: 'Parenting_Facebook', status: 'Story Generated' } },
      { fields: { Projects: 'Science_YouTube', status: 'Draft' } },
      { fields: { Projects: 'Unrequested', status: 'Approved' } },
      { fields: { status: 'Story Generated' } },
    ],
  };
  const base = (tableName) => ({
    select: (options) => ({
      eachPage: (visit, done) => {
        assert.ok(options.pageSize > 0 && options.pageSize <= 100);
        assert.equal(options.filterByFormula, 'OR({Projects} = "Parenting_Facebook",{Projects} = "Science_YouTube",{Projects} = "Empty_Project")');
        selectedTables.push(tableName);
        const rows = records[tableName];
        let offset = 0;
        const next = () => {
          if (offset >= rows.length) return done();
          const page = rows.slice(offset, offset + 2);
          offset += 2;
          setImmediate(() => visit(page, next));
        };
        next();
      },
    }),
  });
  const client = new AirtableClient({ apiKey: 'test', base });

  const stats = await client.projectStats(['Parenting_Facebook', 'Science_YouTube', 'Empty_Project']);
  assert.deepEqual(stats.Parenting_Facebook, {
    ideas: 3,
    scripts: 2,
    approvedScripts: 1,
    storyboards: 1,
    failedRecoveryItems: 2,
  });
  assert.deepEqual(stats.Science_YouTube, {
    ideas: 1, scripts: 1, approvedScripts: 0, storyboards: 0, failedRecoveryItems: 0,
  });
  assert.deepEqual(stats.Empty_Project, {
    ideas: 0, scripts: 0, approvedScripts: 0, storyboards: 0, failedRecoveryItems: 0,
  });
  assert.deepEqual(Object.keys(stats).sort(), ['Empty_Project', 'Parenting_Facebook', 'Science_YouTube']);
  assert.deepEqual(selectedTables, ['Ideas', 'Scripts']);
});

test('project statistics skip Airtable when no projects are requested', async () => {
  const client = new AirtableClient({
    apiKey: 'test',
    base: () => { throw new Error('No Airtable call expected'); },
  });
  assert.deepEqual(await client.projectStats([]), {});
});

test('statistics chunk project filters and escape formula values', async () => {
  const calls = [];
  const client = new AirtableClient({ apiKey: 'test', base: table => ({ select: options => ({
    eachPage: (_visit, done) => { calls.push({ table, ...options }); done(); },
  }) }) });
  const keys = ['A"quoted\\key', ...Array.from({ length: 25 }, (_, i) => `project-${i}`)];
  const result = await client.projectStats([...keys, keys[0], '', undefined]);
  assert.equal(Object.keys(result).length, 26);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].filterByFormula, `OR(${keys.slice(0, 25).map(key => `{Projects} = ${JSON.stringify(key)}`).join(',')})`);
  assert.equal(calls[2].filterByFormula, 'OR({Projects} = "project-24")');
  assert.deepEqual(calls[0].fields, ['Projects', 'Idea Status']);
  assert.deepEqual(calls[1].fields, ['Projects', 'status']);
});

test('script review fetches one scoped page, preserves the cursor and normalizes imported field names', async () => {
  let requested;
  const client = new AirtableClient({ apiKey: 'test', baseId: 'base',
    base: () => ({ find: async id => ({ id, fields: { project_id: 'Parenting_Facebook' } }) }),
    fetchImpl: async url => {
      requested = new URL(url);
      return { ok: true, json: async () => ({ records: [{ id: 'script1', fields: { '\uFEFFvideo_id': 'video1', title: 'Title' } }], offset: 'next' }) };
    },
  });
  const page = await client.listScriptsForProject('recProject', { limit: 10, offset: 'opaque cursor' });
  assert.equal(requested.searchParams.get('filterByFormula'), '{Projects} = "Parenting_Facebook"');
  assert.equal(requested.searchParams.get('pageSize'), '10');
  assert.equal(requested.searchParams.get('offset'), 'opaque cursor');
  assert.equal(page.scripts[0].fields.video_id, 'video1');
  assert.equal(page.nextOffset, 'next');
});

test('status updates retain Airtable typecast and change only the requested field', async () => {
  const calls = [];
  const client = new AirtableClient({ apiKey: 'test', base: table => ({ update: async (records, options) => {
    calls.push({ table, records, options }); return records;
  } }) });
  await client.updateProjectStatus('project', 'Paused');
  await client.updateScript('script', { status: 'Approved' });
  assert.deepEqual(calls.map(call => call.records), [
    [{ id: 'project', fields: { status: 'Paused' } }], [{ id: 'script', fields: { status: 'Approved' } }],
  ]);
  assert.ok(calls.every(call => call.options.typecast === client.writeOpts.typecast));
});

test('project statistics propagate a later page failure instead of returning partial counts', async () => {
  const failure = new Error('Airtable page unavailable');
  const client = new AirtableClient({
    apiKey: 'test',
    base: () => ({ select: () => ({ eachPage: (visit, done) => {
      visit([{ fields: { Projects: 'Parenting_Facebook' } }], () => done(failure));
    } }) }),
  });
  await assert.rejects(client.projectStats(['Parenting_Facebook']), failure);
});

test('eligible-idea streaming asks Airtable for Draft or blank rows only', async () => {
  let selectOptions;
  const base = () => ({
    find: async (id) => ({ id, fields: { project_id: 'Parenting_Facebook' } }),
    select: (options) => {
      selectOptions = options;
      return {
        eachPage: (visit, done) => {
          visit([
            { id: 'recIdea1', fields: { Projects: 'Parenting_Facebook', 'Idea Status': 'Draft' } },
          ], () => done());
        },
      };
    },
  });
  const client = new AirtableClient({ apiKey: 'test', base });
  const visited = [];
  const count = await client.forEachEligibleIdea(
    'recProject1',
    { limit: 1 },
    async (idea) => visited.push(idea.id)
  );

  assert.equal(count, 1);
  assert.deepEqual(visited, ['recIdea1']);
  assert.match(selectOptions.filterByFormula, /Idea Status/);
  assert.match(selectOptions.filterByFormula, /\{Projects\} = "Parenting_Facebook"/);
  assert.equal(selectOptions.maxRecords, 1);
  assert.equal(selectOptions.pageSize, 1);
});

test('recovery streams stuck ideas sequentially with a bounded page size', async () => {
  let selectOptions;
  let active = 0;
  let peak = 0;
  const base = () => ({
    select: (options) => {
      selectOptions = options;
      return {
        eachPage: (visit, done) => {
          visit([
            { id: 'recIdea1', fields: { title: 'One' } },
            { id: 'recIdea2', fields: { title: 'Two' } },
          ], () => done());
        },
      };
    },
  });
  const client = new AirtableClient({ apiKey: 'test', base });
  const order = [];
  const count = await client.forEachStuckIdea(
    "{Idea Status} = 'Draft'",
    { limit: 2 },
    async (idea) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      order.push(idea.id);
      active -= 1;
    }
  );

  assert.equal(count, 2);
  assert.equal(peak, 1);
  assert.deepEqual(order, ['recIdea1', 'recIdea2']);
  assert.equal(selectOptions.pageSize, 2);
});
