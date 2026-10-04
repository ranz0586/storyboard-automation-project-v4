// The n8n Idea Agent's Structured Output Parser2 schema, verbatim. In n8n the
// parser appends this to the agent's instructions — that is what forced the
// model to emit production/review (and content_score as a number). We replicate
// that by embedding it in the user prompt (see prompt.js).
export const IDEA_OUTPUT_JSON_SCHEMA = `{
  "type": "object",
  "properties": {
    "concepts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "rank": { "type": "integer" },
          "content_score": { "type": "number" },
          "title": { "type": "string" },
          "topic": { "type": "string" },
          "emotional_angle": { "type": "string" },
          "hook_style": {
            "type": "object",
            "properties": {
              "hook_text": { "type": "string" },
              "psychological_trigger": { "type": "string" },
              "curiosity_gap": { "type": "string" },
              "viewer_question": { "type": "string" },
              "scroll_stop_reason": { "type": "string" }
            },
            "required": ["hook_text", "psychological_trigger", "curiosity_gap", "viewer_question", "scroll_stop_reason"]
          },
          "differentiation_opportunities": {
            "type": "object",
            "properties": {
              "anti_analogy_approach": { "type": "string" },
              "visual_execution_style": { "type": "string" },
              "underserved_angle": { "type": "string" }
            },
            "required": ["anti_analogy_approach", "visual_execution_style", "underserved_angle"]
          },
          "viral_positioning": {
            "type": "object",
            "properties": {
              "format_category": { "type": "string" },
              "system_mechanic_explained": { "type": "string" },
              "loop_trigger_concept": { "type": "string" },
              "selected_structure": { "type": "string" },
              "structure_reason": { "type": "string" },
              "reward_position": { "type": "string" },
              "story_arc": { "type": "string" }
            },
            "required": ["format_category", "system_mechanic_explained", "loop_trigger_concept", "selected_structure", "structure_reason", "reward_position", "story_arc"]
          },
          "production": {
            "type": "object",
            "properties": {
              "visual_potential_score": { "type": "number" },
              "storyboard_ready": { "type": "string" }
            },
            "required": ["visual_potential_score", "storyboard_ready"]
          },
          "review": {
            "type": "object",
            "properties": {
              "shareability": { "type": "number" },
              "value_delivered": { "type": "number" },
              "series_potential": { "type": "number" },
              "strategy_notes": { "type": "string" }
            },
            "required": ["shareability", "value_delivered", "series_potential", "strategy_notes"]
          }
        },
        "required": ["rank", "content_score", "title", "topic", "emotional_angle", "hook_style", "differentiation_opportunities", "viral_positioning", "production", "review"]
      }
    }
  },
  "required": ["concepts"]
}`;
