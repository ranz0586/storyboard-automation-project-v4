import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('two processes send the same composite Idea key to one atomic upsert endpoint', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-upsert-process-'));
  const records = new Map();
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    const fields = body.records[0].fields;
    const key = `${fields['\ufefftitle']}|${fields.Projects}`;
    const existing = records.get(key);
    const record = existing || { id: `rec${records.size + 1}`, fields };
    records.set(key, record);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ records: [record], createdRecords: existing ? [] : [record.id] }));
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const worker = path.join(directory, 'worker.mjs');
    const moduleUrl = new URL('../src/clients/airtable.js', import.meta.url).href;
    const endpoint = `http://127.0.0.1:${server.address().port}/Ideas`;
    fs.writeFileSync(worker, `import { AirtableClient } from ${JSON.stringify(moduleUrl)};
const client = new AirtableClient({
  apiKey: 'test',
  base: () => { throw new Error('SDK should not be used'); },
  fetchImpl: (_url, options) => fetch(${JSON.stringify(endpoint)}, options),
});
const result = await client.upsertIdea({ title: 'Shared', Projects: 'Test_Project' });
console.log(result.id);`);
    const outputs = await Promise.all([
      run(process.execPath, [worker]), run(process.execPath, [worker]),
    ]);
    assert.deepEqual(outputs.map(({ stdout }) => stdout.trim()), ['rec1', 'rec1']);
    assert.equal(records.size, 1);
    assert.equal(requests.length, 2);
    for (const body of requests) {
      assert.deepEqual(body.performUpsert.fieldsToMergeOn, ['\ufefftitle', 'Projects']);
      assert.equal(body.typecast, true);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
