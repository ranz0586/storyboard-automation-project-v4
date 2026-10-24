import { z } from 'zod';

export const EditorialReviewSchema = z.object({
  hook_fulfilled: z.boolean(), hook_scene_number: z.number().int().positive(), hook_quote: z.string().trim().min(1),
  payoff_scene_number: z.number().int().positive(), payoff_quote: z.string().trim().min(1),
  distinct_treatment: z.boolean(), originality_reason: z.string().trim().min(1), compared_record_ids: z.array(z.string()),
});
export const SceneReviewSchema = z.object({
  scene_number: z.number().int().positive(), source_scene_number: z.number().int().positive(), visuals_match_narration: z.boolean(), single_visual_moment: z.boolean(), reason: z.string().trim().min(1),
  narration: z.string(), useful_narration: z.boolean(),
  claim_type: z.enum(['factual','metadata','hypothesis','fiction','opinion','instruction','unsupported','silent']),
  sensitive_claim: z.boolean(), support_matches_claim: z.boolean(),
  uncertainty_explicit: z.boolean(), uncertainty_quote: z.string(),
  supports: z.array(z.object({ source_url: z.string().url(), quote: z.string().trim().min(1), field: z.string().optional() })),
});
const normalize = text => String(text ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const contains = (text, quote) => Boolean(normalize(quote)) && normalize(text).includes(normalize(quote));

export function inspectEditorialReview(script, reviews, editorial, concept, recentContent) {
  const issues = [];
  const hook = script.scenes.find(scene => scene.scene_number === editorial.hook_scene_number);
  if (!editorial.hook_fulfilled || editorial.hook_scene_number !== 1 || !hook ||
    ![hook.narration, hook.visual?.description, script.video.hook].some(text => contains(text, editorial.hook_quote))) issues.push('Hook review must quote and fulfill the final opening promise');
  const payoff = script.scenes.find(scene => scene.scene_number === editorial.payoff_scene_number);
  if (!payoff || ![payoff.narration, payoff.visual?.description].some(text => contains(text, editorial.payoff_quote))) issues.push('Payoff review must quote a final scene fulfilling the hook');
  if (!editorial.distinct_treatment) issues.push('Treatment repeats sampled project content');
  const ids = new Set(recentContent.map(row => row.id));
  const compared = new Set(editorial.compared_record_ids);
  const missing = [...ids].filter(id => !compared.has(id));
  const unexpected = [...compared].filter(id => !ids.has(id));
  const duplicates = editorial.compared_record_ids.length - compared.size;
  if (missing.length || unexpected.length || duplicates) issues.push('Originality review must compare all supplied record IDs without invented IDs. Missing IDs: ' + JSON.stringify(missing) + '; Unexpected ID count: ' + unexpected.length + '; Duplicate ID count: ' + duplicates);
  for (const scene of script.scenes) {
    const review = reviews.find(row => row.scene_number === scene.scene_number);
    if (!review) continue; // The visual gate reports missing reviews.
    const label = 'Scene ' + scene.scene_number + ': ';
    if (normalize(review.narration) !== normalize(scene.narration)) issues.push(label + 'editorial review must cover final narration');
    if (scene.narration.trim() && !review.useful_narration) issues.push(label + 'remove filler, repeated premises or padding');
    if (review.claim_type === 'unsupported') issues.push(label + 'unsupported factual claim');
    if (review.sensitive_claim && review.claim_type !== 'factual') issues.push(label + 'sensitive claims require factual source support');
    if (review.claim_type === 'silent' && scene.narration.trim()) issues.push(label + 'spoken narration cannot be classified silent');
    if (review.claim_type === 'hypothesis' && (!review.uncertainty_explicit || !contains(scene.narration, review.uncertainty_quote))) issues.push(label + 'speculation must be explicit in the narration language and quoted from final narration');
    if (['factual','metadata'].includes(review.claim_type)) {
      if (!review.support_matches_claim || !review.supports.length) issues.push(label + 'claims need relevant supplied evidence');
      for (const support of review.supports) {
        if (review.claim_type === 'factual') {
          const source = concept?.evidence?.factual_sources?.find(row => row.url === support.source_url);
          if (!source || !contains(source.excerpt, support.quote)) issues.push(label + 'factual citation needs matching supplied excerpt; metadata is not factual support');
        } else {
          const source = concept?.evidence?.observations?.find(row => row.url === support.source_url);
          if (!source || !['title','view_count','upload_date','duration'].includes(support.field) || source[support.field] == null || String(source[support.field]) !== support.quote.trim()) issues.push(label + 'metadata citation must match an observed field');
        }
      }
    }
  }
  return issues;
}

// The compact Gemini response uses the same strict review contract as a full review.
const baseEditorialResponseProperties = {
  editorial_review: { type: 'object', properties: {
    hook_fulfilled:{type:'boolean'},hook_scene_number:{type:'integer'},hook_quote:{type:'string'},payoff_scene_number:{type:'integer'},payoff_quote:{type:'string'},
    distinct_treatment:{type:'boolean'},originality_reason:{type:'string'},compared_record_ids:{type:'array',items:{type:'string'}},
  }, required: Object.keys(EditorialReviewSchema.shape) },
  scene_reviews: { type:'array',items:{ type:'object',properties:{
    scene_number:{type:'integer'},source_scene_number:{type:'integer'},visuals_match_narration:{type:'boolean'},single_visual_moment:{type:'boolean'},reason:{type:'string'},narration:{type:'string'},useful_narration:{type:'boolean'},
    claim_type:{type:'string',enum:['factual','metadata','hypothesis','fiction','opinion','instruction','unsupported','silent']},sensitive_claim:{type:'boolean'},support_matches_claim:{type:'boolean'},uncertainty_explicit:{type:'boolean'},uncertainty_quote:{type:'string'},
    supports:{type:'array',items:{type:'object',properties:{source_url:{type:'string'},quote:{type:'string'},field:{type:'string'}},required:['source_url','quote']}},
  },required:Object.keys(SceneReviewSchema.shape)} },
};


export function editorialResponseProperties(recentContent = []) {
  const properties = structuredClone(baseEditorialResponseProperties);
  const ids = [...new Set(recentContent.map(row => row.id))];
  // Per-call schema copies prevent one project's comparison IDs leaking into another call.
  if (ids.length) Object.assign(properties.editorial_review.properties.compared_record_ids, {
    minItems: ids.length, maxItems: ids.length, items: { type: 'string', enum: ids },
  });
  return properties;
}
