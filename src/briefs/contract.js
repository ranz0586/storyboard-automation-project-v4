import { z } from 'zod';
import { STRUCTURE_KEYS, selectedStructures } from '../../shared/storyboardStructures.js';
import { DEFAULT_PACKS } from '../creativeGuidance/index.js';

export const BriefSettingsSchema = z.object({
  language: z.string().trim().max(100).default(''),
  durationSeconds: z.number().int().min(5).max(300).nullable().default(null),
  audio: z.literal('narration').default('narration'),
  workflow: z.literal('narrated-video').default('narrated-video'),
  entry: z.literal('ideas').default('ideas'),
  characterReferences: z.string().trim().max(3000).default(''),
  styleReferences: z.string().trim().max(3000).default(''),
  structures: z.union([z.literal('all'), z.array(z.enum(STRUCTURE_KEYS)).min(1).max(3)
    .refine(keys => new Set(keys).size === keys.length, 'Duplicate structures are not allowed')])
    .default('all').transform(selectedStructures),
}).strict();
// Omitted fields preserve defaults saved by newer clients.
export const BriefUpdateSchema = BriefSettingsSchema.partial();

export const briefIdentity = form => ({
  niche: form.NICHE || '', platform: form.PLATFORM || '', audience: form['TARGET AUDIENCE'] || '',
  style: form['CONTENT STYLE'] || '', channel: form['CHANNEL NAME (Optional)'] || '',
  description: form['CHANNEL DESCRIPTION (Optional)'] || '',
  characterAssets: form['CHARACTER REFERENCES'] ?? null, styleAssets: form['STYLE REFERENCES'] ?? null,
  characterReferenceFlag: form['Has Character Reference Sheet'] || 'N', styleReferenceFlag: form['Has Style Reference'] || 'N',
});
export function draftBrief(form) {
  return { version: 1, ...BriefSettingsSchema.parse({}), identity: briefIdentity(form), guidancePacks: [...DEFAULT_PACKS], origin: 'unpersisted' };
}
export function snapshotBrief(projectKey, itemId, form, settings, origin) {
  if (typeof projectKey !== 'string' || !projectKey || typeof itemId !== 'string' || !itemId) throw new Error('Brief needs owning project and item identity');
  return { ...draftBrief(form), ...BriefSettingsSchema.parse(settings), projectKey, itemId, origin, createdAt: new Date().toISOString() };
}
export function formWithBrief(form, brief) {
  const identity = brief.identity;
  return { ...form, NICHE: identity.niche, PLATFORM: identity.platform,
    'TARGET AUDIENCE': identity.audience, 'CONTENT STYLE': identity.style,
    'CHANNEL NAME (Optional)': identity.channel, 'CHANNEL DESCRIPTION (Optional)': identity.description,
    'CHARACTER REFERENCES': identity.characterAssets, 'STYLE REFERENCES': identity.styleAssets,
    'Has Character Reference Sheet': identity.characterReferenceFlag, 'Has Style Reference': identity.styleReferenceFlag,
    'PRODUCTION BRIEF': brief };
}
