// Robustly extract a JSON object/array from an LLM text response.
// Mirrors what n8n's Structured Output Parser does before validation:
// strips markdown fences, finds the outermost JSON, parses it.
export function extractJson(text) {
  if (text == null) throw new Error('extractJson: empty response');
  if (typeof text === 'object') return text; // already parsed

  let s = String(text).trim();

  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Fast path.
  try {
    return JSON.parse(s);
  } catch {
    // Fall through to bracket-slice recovery.
  }

  // Recover the outermost {...} or [...] span.
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  let openCh = '{';
  let closeCh = '}';
  if (firstArr !== -1 && (firstArr < firstObj || firstObj === -1)) {
    start = firstArr;
    openCh = '[';
    closeCh = ']';
  } else {
    start = firstObj;
  }
  if (start === -1) throw new Error('extractJson: no JSON found in response');

  const end = s.lastIndexOf(closeCh);
  if (end <= start) throw new Error('extractJson: unbalanced JSON in response');

  const slice = s.slice(start, end + 1);
  return JSON.parse(slice);
}
