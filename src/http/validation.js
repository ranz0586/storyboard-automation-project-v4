import { z } from 'zod';

const requiredText = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(5_000).default('');

export const NicheRequestSchema = z.object({
  NICHE: requiredText,
  PLATFORM: requiredText,
  'TARGET AUDIENCE': requiredText,
  'CONTENT STYLE': requiredText,
  'CHANNEL NAME (Optional)': optionalText,
  'CHANNEL DESCRIPTION (Optional)': optionalText,
  'Has Character Reference Sheet': z.enum(['Y', 'N']).default('N'),
  'Has Style Reference': z.enum(['Y', 'N']).default('N'),
});

export const ProjectCreateSchema = z.object({
  requestId: z.string().uuid(),
  name: requiredText,
  niche: requiredText,
  platform: requiredText,
  targetAudience: requiredText,
  contentStyle: requiredText,
  description: optionalText,
  hasCharacterReference: z.enum(['Y', 'N']).default('N'),
  hasStyleReference: z.enum(['Y', 'N']).default('N'),
});

export const ScriptRunRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    projectId: requiredText,
    mode: z.literal('count'),
    count: z.number().int().min(1).max(50),
  }),
  z.object({
    projectId: requiredText,
    mode: z.literal('selected'),
    ideaIds: z.array(requiredText).min(1).max(50).transform((ids) => [...new Set(ids)]),
  }),
]);

export const WeeklyScheduleSchema = z.object({
  enabled: z.boolean(),
  dayOfWeek: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must use HH:mm'),
  scriptCount: z.number().int().min(1).max(50),
});

export const IdeaRunRequestSchema = z.object({
  count: z.number().int().min(1).max(50).default(10),
});

export const ProjectStatusSchema = z.object({ status: z.enum(['Active', 'Inactive']) }).strict();

export const ScriptPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.string().min(1).max(1000).optional(),
});

export const CollectionPageSchema = ScriptPageSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        issues: result.error.issues.map(({ path, message }) => ({ path, message })),
      });
    }
    req.validatedBody = result.data;
    next();
  };
}
