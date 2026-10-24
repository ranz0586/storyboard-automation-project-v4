import { STORYBOARD_AUDIT_SYSTEM } from './system.js';
import { buildStoryboardAuditPrompt } from './prompt.js';
import { acceptAuditReport, assertAuditInputSize } from '../../audits/contract.js';
export async function storyboardAuditAgent(gemini, input) {
  assertAuditInputSize(input);
  const raw = await gemini.generate({ system: STORYBOARD_AUDIT_SYSTEM, prompt: buildStoryboardAuditPrompt(input), json: true });
  return acceptAuditReport(raw, input);
}
