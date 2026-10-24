import { REFERENCE_ANALYSIS_SYSTEM } from './system.js';
import { referenceAnalysisPrompt } from './prompt.js';
import { ReferenceSchema, acceptAnalysis } from '../../creation/contract.js';
export async function referenceAnalysisAgent(gemini,source) {
  source=ReferenceSchema.parse(source);
  const raw=await gemini.generate({system:REFERENCE_ANALYSIS_SYSTEM,prompt:referenceAnalysisPrompt(source),json:true,
    ...(source.kind==='image'?{media:[{inlineData:{mimeType:source.mimeType,data:source.data}}]}:{})});
  return acceptAnalysis(raw,source);
}
