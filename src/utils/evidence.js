export const UNKNOWN_METRICS = ['retention', 'comment_sentiment', 'growth', 'facebook_performance'];

export function researchEvidence(data, platform) {
  return {
    observations: (data?.videos || []).map(video => ({
      url: video.url || null, title: video.title || null,
      provider: video.provider || data.provider || 'unknown',
      retrieved_at: video.retrieved_at || data.retrieved_at || 'unknown',
      view_count: video.view_count ?? null, upload_date: video.upload_date || null,
      duration: video.duration ?? null,
    })),
    factual_sources: (data?.factual_sources || []).filter(source => typeof source?.url === 'string' && /^https?:\/\//.test(source.url) && typeof source.excerpt === 'string' && source.excerpt.trim()).slice(0, 10).map(({url, excerpt}) => ({url, excerpt})),
    unknowns: [...UNKNOWN_METRICS],
    cross_platform_hypothesis: /facebook/i.test(platform || ''),
  };
}

export function conceptEvidence(raw, context = {}) {
  const observations = context.observations || [];
  const urls = new Set([...observations, ...(context.factual_sources || [])].map(row => row.url).filter(Boolean));
  const claims = (Array.isArray(raw?.claims) ? raw.claims : []).slice(0, 10)
    .filter(claim => typeof claim?.text === 'string' && claim.text.trim())
    .map(claim => ({ text: claim.text,
      classification: claim.classification === 'unknown' ? 'unknown' : 'hypothesis',
      confidence: 'unverified',
      source_urls: (Array.isArray(claim.source_urls) ? claim.source_urls : []).filter(url => urls.has(url)),
    }));
  const cited = new Set(claims.flatMap(claim => claim.source_urls));
  return { observations: cited.size ? observations.filter(row => cited.has(row.url)) : observations.slice(0, 3), claims,
    factual_sources: context.factual_sources || [],
    unknowns: [...UNKNOWN_METRICS], cross_platform_hypothesis: Boolean(context.cross_platform_hypothesis) };
}

export function encodeIdeaNotes(notes, evidence) {
  return evidence ? JSON.stringify({ idea_evidence_version: 1, notes: notes || '', evidence }) : notes || '';
}

export function decodeIdeaNotes(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.idea_evidence_version === 1 && typeof parsed.notes === 'string' && parsed.evidence && typeof parsed.evidence === 'object')
      return { notes: parsed.notes, evidence: parsed.evidence };
  } catch { /* Legacy notes remain plain text. */ }
  return { notes: value || '' };
}
