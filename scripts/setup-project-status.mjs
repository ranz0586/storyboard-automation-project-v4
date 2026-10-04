// Inspect first; pass --apply to add only the missing project-status field.
// Existing records remain unchanged. A blank status is treated as Active.
import { config } from '../src/config.js';

const baseUrl = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(config.airtable.baseId)}/tables`;
const headers = { Authorization: `Bearer ${config.airtable.apiKey}`, 'Content-Type': 'application/json' };
try {
  const response = await fetch(baseUrl, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Schema read failed (HTTP ${response.status})`);
  const { tables } = await response.json();
  const table = tables.find(t => t.name === config.airtable.tables.projects);
  if (!table) throw new Error('Configured Projects table was not found');
  const definition = { name: 'status', type: 'singleSelect', options: { choices: [
    { name: 'Active', color: 'greenLight2' }, { name: 'Inactive', color: 'grayLight2' },
  ] } };
  const existing = table.fields.find(f => f.name === 'status');
  if (existing) {
    if (existing.type !== 'singleSelect' || definition.options.choices.some(choice => !existing.options.choices.some(c => c.name === choice.name))) {
      throw new Error('Existing status field differs from the required choices; review it before changing the schema');
    }
    console.log('Project status field already configured');
  } else if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ table: table.name, proposedField: definition, applyCommand: 'node scripts/setup-project-status.mjs --apply' }, null, 2));
  } else {
    const created = await fetch(`${baseUrl}/${encodeURIComponent(table.id)}/fields`, {
      method: 'POST', headers, body: JSON.stringify(definition), signal: AbortSignal.timeout(30_000),
    });
    if (!created.ok) throw new Error(`Status field creation failed (HTTP ${created.status})`);
    console.log('Created Projects.status with Active and Inactive choices. Existing records were not changed.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
