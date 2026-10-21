import { spokenWords } from './scriptTiming.js';
const normalized = text => spokenWords(text).join(' ');
const includes = (text, quote) => Boolean(normalized(quote)) && (' ' + normalized(text) + ' ').includes(' ' + normalized(quote) + ' ');

export function inspectEditorialReview(script, reviews, editorial, concept, recentContent) {
  const issues = [];
  if (!editorial.hook_fulfilled) issues.push('Hook promise is not fulfilled');
  const opening = script.scenes[0];
  if (![opening?.narration, opening?.visual?.description, script.video.hook].some(text => includes(text, editorial.hook_quote)))
    issues.push('Hook review must quote the final opening or hook');
  const payoff = script.scenes.find(scene => scene.scene_number === editorial.payoff_scene_number);
  if (!payoff || ![payoff.narration, payoff.visual?.description].some(text => includes(text, editorial.payoff_quote)))
    issues.push('Payoff review must identify and quote a final scene that fulfills the hook');
  if (!editorial.distinct_treatment) issues.push('Treatment repeats recent project content');
  const ids = new Set(recentContent.map(record => record.id));
  if (editorial.compared_record_ids.length !== ids.size || new Set(editorial.compared_record_ids).size !== ids.size || editorial.compared_record_ids.some(id => !ids.has(id)))
    issues.push('Originality review must compare every supplied recent record, without invented IDs');
  for (const scene of script.scenes) {
    const review = reviews.find(item => item.scene_number === scene.scene_number);
    if (!review) continue; // The visual gate reports missing scene reviews.
    if (normalized(review.narration) !== normalized(scene.narration)) issues.push('Scene ' + scene.scene_number + ': claim review must cover the final narration');
    if (!review.useful_narration) issues.push('Scene ' + scene.scene_number + ': remove filler, repeated premises or padding');
    const type = review.claim_type;
    if (review.sensitive_claim && type !== 'factual') issues.push('Scene ' + scene.scene_number + ': sensitive claims require factual source support');
    if (type === 'unsupported') issues.push('Scene ' + scene.scene_number + ': unsupported factual claim');
    if (type === 'silent' && normalized(scene.narration)) issues.push('Scene ' + scene.scene_number + ': narrated claims cannot be marked silent');
    if (type === 'hypothesis' && !/\b(may|might|could|perhaps|possibly|hypothesis|imagine|suppose|what if)\b/i.test(scene.narration))
      issues.push('Scene ' + scene.scene_number + ': speculation must be explicit in the narration; classify direct assertions and instructions honestly instead of labeling them hypotheses');
    if (type === 'hypothesis' && review.sensitive_claim)
      issues.push('Scene ' + scene.scene_number + ': speculation cannot disguise sensitive factual advice');
    if (type === 'factual' || type === 'metadata') {
      if (!review.support_matches_claim || !review.supports.length) issues.push('Scene ' + scene.scene_number + ': factual claims need relevant supplied evidence');
      for (const support of review.supports) {
        if (type === 'factual') {
          const source = concept?.evidence?.factual_sources?.find(source => source.url === support.source_url);
          if (!source || !includes(source.excerpt, support.quote)) issues.push('Scene ' + scene.scene_number + ': factual citation needs a matching supplied excerpt; metadata is not factual support');
        } else {
          const source = concept?.evidence?.observations?.find(source => source.url === support.source_url);
          const allowed = ['title', 'view_count', 'upload_date', 'duration'];
          if (!source || !allowed.includes(support.field) || source[support.field] == null || String(source[support.field]) !== support.quote.trim())
            issues.push('Scene ' + scene.scene_number + ': metadata citation must match an available observed field; retention, sentiment and growth are unknown');
        }
      }
    }
  }
  return issues;
}
