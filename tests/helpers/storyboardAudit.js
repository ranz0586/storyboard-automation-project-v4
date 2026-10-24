import { DIMENSION_WEIGHTS } from '../../src/audits/contract.js';
export function validAuditReport(input, { issues = [], ...overrides } = {}) {
  const metadata = Object.fromEntries(['audit_version', 'rubric_version', 'evidence_scope', 'package_hash', 'brief_hash', 'workflow_type', 'structure_types'].map(key => [key, input[key]]));
  const findText = (value, path) => {
    if (typeof value === 'string' && value.trim()) return { pointer: path, quote: value.slice(0, 100) };
    for (const [key, child] of Object.entries(value || {})) { const found = findText(child, path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')); if (found) return found; }
    return null;
  };
  const evidence = findText(input.storyboard, '/storyboard') || findText(input.script, '/script');
  const brand = findText(input.brief?.identity?.channel || input.brief?.identity?.description || input.brief?.styleReferences || input.brief?.characterReferences, '/brief');
  const brandEvidence = input.brief?.identity?.channel ? { pointer: '/brief/identity/channel', quote: input.brief.identity.channel }
    : input.brief?.identity?.description ? { pointer: '/brief/identity/description', quote: input.brief.identity.description }
    : input.brief?.styleReferences ? { pointer: '/brief/styleReferences', quote: input.brief.styleReferences }
    : input.brief?.characterReferences ? { pointer: '/brief/characterReferences', quote: input.brief.characterReferences } : null;
  return { ...metadata, dimensions: Object.keys(DIMENSION_WEIGHTS).map(id => ({ id,
    score: id === 'media' || (id === 'brand' && !brand) ? null : 8,
    rationale: id === 'media' ? 'Actual media is unavailable.' : 'Evidence supports this editorial planning judgment.',
    rule_ids: [id], evidence: id === 'media' || (id === 'brand' && !brand) ? [] : [id === 'brand' ? brandEvidence : evidence] })),
    issues, evidence_limits: [], prioritized_actions: [], ...overrides };
}
export const auditReply = validAuditReport;
