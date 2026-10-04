import { z } from 'zod';

// Mirrors the workflow's Structured Output Parsers. Kept intentionally
// lenient (.passthrough / optional) so a strong-but-imperfect LLM response
// still validates, matching n8n's forgiving parsing behavior.

// --- Idea Agent output (Structured Output Parser2) ---
export const HookStyleSchema = z
  .object({
    hook_text: z.string().default(''),
    psychological_trigger: z.string().default(''),
    curiosity_gap: z.string().default(''),
    viewer_question: z.string().default(''),
    scroll_stop_reason: z.string().default(''),
  })
  .passthrough();

export const ViralPositioningSchema = z
  .object({
    format_category: z.string().default(''),
    system_mechanic_explained: z.string().default(''),
    loop_trigger_concept: z.string().default(''),
    selected_structure: z.string().default(''),
    structure_reason: z.string().default(''),
    reward_position: z.string().default(''),
    story_arc: z.string().default(''),
  })
  .passthrough();

export const ConceptSchema = z
  .object({
    rank: z.number().int().default(0),
    // The verbatim IDEA prompt's example shows an object ({ overall, ... });
    // accept a bare number too (see CLAUDE.md TODO).
    content_score: z.union([z.number(), z.object({}).passthrough()]).default(0),
    title: z.string(),
    topic: z.string().default(''),
    emotional_angle: z.string().default(''),
    hook_style: HookStyleSchema.default({}),
    differentiation_opportunities: z.object({}).passthrough().default({}),
    viral_positioning: ViralPositioningSchema.default({}),
    production: z.object({}).passthrough().optional(),
    review: z.object({}).passthrough().optional(),
  })
  .passthrough();

export const IdeaOutputSchema = z.object({
  concepts: z.array(ConceptSchema),
});

// --- Script Agent output (Structured Output Parser1) ---
export const SceneSchema = z
  .object({
    scene_number: z.number(),
    duration_seconds: z.number(),
    narration: z.string().default(''),
    emotional_state: z.string().default(''),
    viewer_psychology_goal: z.string().default(''),
    visual: z.object({}).passthrough().default({}),
    audio: z.object({}).passthrough().default({}),
    text: z.object({}).passthrough().default({}),
    tts: z.object({}).passthrough().default({}),
  })
  .passthrough();

export const ScriptSchema = z
  .object({
    video: z
      .object({
        video_id: z.string().default(''),
        title: z.string().default(''),
        topic: z.string().default(''),
        platform: z.string().default(''),
        status: z.string().default('Draft'),
        emotional_angle: z.string().default(''),
        hook_type: z.string().default(''),
        hook: z.string().default(''),
        rehook: z.string().default(''),
        ending_loop_line: z.string().default(''),
        soft_cta: z.string().default(''),
        estimated_duration_seconds: z.number().default(0),
        thumbnail: z.object({}).passthrough().default({}),
        voiceover: z.object({}).passthrough().default({}),
        metadata: z.object({}).passthrough().default({}),
      })
      .passthrough(),
    scenes: z.array(SceneSchema).default([]),
  })
  .passthrough();

// The script agent, when run per-concept, returns a single { scripts: [one] }.
export const ScriptOutputSchema = z.object({
  scripts: z.array(ScriptSchema),
});

// Keep ScriptSchema lenient for real-world model drift, but do not allow its
// defaults to turn an unusable model response into a persistable blank row.
// Runners apply this second-stage contract after normalization.
export const UsableScriptSchema = ScriptSchema.superRefine((script, ctx) => {
  const requiredText = [
    ['video_id', script.video.video_id],
    ['title', script.video.title],
    ['voiceover.full_script', script.video.voiceover?.full_script],
  ];
  for (const [field, value] of requiredText) {
    if (typeof value !== 'string' || !value.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: field.split('.'),
        message: `${field} must be a non-empty string`,
      });
    }
  }
  if (!(script.video.estimated_duration_seconds > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['video', 'estimated_duration_seconds'],
      message: 'estimated_duration_seconds must be greater than zero',
    });
  }
  if (!script.scenes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scenes'],
      message: 'at least one scene is required',
    });
  }
});

// --- Storyboard Agent output (Structured Output Parser) ---
export const StoryboardOutputSchema = z
  .object({
    master_assets: z.object({}).passthrough().default({}),
    structure1: z.array(z.object({}).passthrough()).optional(),
    structure2: z.array(z.object({}).passthrough()).optional(),
    structure3: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();
