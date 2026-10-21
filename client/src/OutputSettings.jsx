import { useEffect, useRef, useState } from 'react';
import { STRUCTURE_OPTIONS } from '../../shared/storyboardStructures.js';

export function FrozenOutputs({ brief }) {
  if (!brief) return null;
  const selected = Array.isArray(brief.structures) ? brief.structures : STRUCTURE_OPTIONS.map(option => option.key);
  return <details className="frozen-outputs"><summary>Frozen production settings</summary>
    <p>Outputs: {STRUCTURE_OPTIONS.filter(option => selected.includes(option.key)).map(option => option.label).join(', ')}</p>
    <p>Narration language: {brief.language === undefined ? 'Not recorded' : brief.language || 'Project context'}</p>
    <p>Target duration: {brief.durationSeconds === undefined ? 'Not recorded' : brief.durationSeconds === null ? 'Script-led' : brief.durationSeconds + ' seconds (planning target)'}</p>
    {!!brief.characterReferences && <p>Character description: {brief.characterReferences}</p>}
    {!!brief.styleReferences && <p>Style description: {brief.styleReferences}</p>}
    <p>Guidance: {Array.isArray(brief.guidancePacks) ? brief.guidancePacks.join(', ') : 'Not recorded'}</p>
    {brief.origin === 'legacy-storyboard' && <p>Frozen for storyboard conversion; the original Script predates these settings.</p>}
  </details>;
}

export default function OutputSettings({ base, api, disabled, notice }) {
  const [brief, setBrief] = useState(null), [saved, setSaved] = useState('');
  const [packs, setPacks] = useState([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const selectAll = useRef(null);
  const selected = brief?.structures;
  const change = (key, value) => setBrief(current => ({ ...current, [key]: value }));
  useEffect(() => {
    const controller = new AbortController();
    setBrief(null); setError('');
    api(base + '/brief', undefined, 'GET', controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setBrief(data.brief); setSaved(JSON.stringify(data.brief)); setPacks(data.guidancePacks);
    }).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [base, api, reload]);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = !!selected?.length && selected.length < 3; }, [selected]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await api(base + '/brief', brief, 'PUT');
      setBrief(data.brief); setSaved(JSON.stringify(data.brief)); setPacks(data.guidancePacks);
      notice('Production brief saved for new scripts', 'success');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const all = selected?.length === 3;
  return <section className="card output-settings" aria-label="Production brief settings"><h3>Production brief</h3>
    <p>Set how your next scripts and storyboards are made. Settings freeze when a Script first starts; retries and its storyboard keep that snapshot.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!selected ? error ? <button className="secondary" onClick={() => setReload(value => value + 1)}>Retry loading brief</button> : <p role="status">Loading production brief…</p> : <form onSubmit={save}>
      <dl className="brief-context"><div><dt>Workflow</dt><dd>Narrated video</dd></div><div><dt>Start from</dt><dd>Project research and ideas</dd></div><div><dt>Audio</dt><dd>Narration</dd></div></dl>
      <fieldset disabled={disabled || busy} className="output-fields"><legend>Script settings</legend><div className="grid two">
        <div className="field"><label htmlFor="brief-language">Narration language</label><input id="brief-language" maxLength={100} placeholder="Use project context" value={brief.language} onChange={event => change('language', event.target.value)} /></div>
        <div className="field"><label htmlFor="brief-duration">Target duration (seconds)</label><input id="brief-duration" type="number" min={5} max={300} step={1} placeholder="Let the script set the length" value={brief.durationSeconds ?? ''} onChange={event => change('durationSeconds', event.target.value === '' ? null : Number(event.target.value))} aria-describedby="brief-duration-help" /></div>
      </div><p className="muted" id="brief-duration-help">Duration guides scene planning. The approved script determines the final storyboard timing.</p></fieldset>
      <fieldset disabled={disabled || busy} className="output-fields"><legend>Storyboard outputs</legend>
        <label className="output-select-all"><input ref={selectAll} type="checkbox" checked={all} onChange={event => change('structures', event.target.checked ? STRUCTURE_OPTIONS.map(option => option.key) : [])} />Select all structures</label>
        <div className="output-options">{STRUCTURE_OPTIONS.map(option => <label className={'output-option' + (selected.includes(option.key) ? ' selected' : '')} key={option.key}>
          <input type="checkbox" aria-label={option.label} checked={selected.includes(option.key)} onChange={event => change('structures', STRUCTURE_OPTIONS.filter(item => item.key === option.key ? event.target.checked : selected.includes(item.key)).map(item => item.key))} />
          <span><strong>{option.label}<span>{option.title}</span></strong><small>{option.description}</small></span>
        </label>)}</div>
      </fieldset>
      {!selected.length && <p className="error" role="alert">Choose at least one storyboard structure.</p>}
      <fieldset disabled={disabled || busy} className="output-fields"><legend>Visual references</legend><div className="grid two">
        <div className="field"><label htmlFor="brief-character">Character reference description</label><textarea id="brief-character" rows={4} maxLength={3000} placeholder="Identity, clothing and recurring details to keep consistent" value={brief.characterReferences} onChange={event => change('characterReferences', event.target.value)} /></div>
        <div className="field"><label htmlFor="brief-style">Style reference description</label><textarea id="brief-style" rows={4} maxLength={3000} placeholder="Illustration style, palette, lighting and mood" value={brief.styleReferences} onChange={event => change('styleReferences', event.target.value)} /></div>
      </div><p className="muted">Descriptions guide prompts. They do not attach or approve images.</p></fieldset>
      <p className="muted">Applies to scripts that have not started generation. Existing and failed items keep their frozen brief.</p>
      <div className="actions output-save"><button className="primary" disabled={disabled || busy || !selected.length}>{busy ? 'Saving brief…' : 'Save production brief'}</button><span className="muted" role="status">{JSON.stringify(brief) === saved ? 'Saved' : 'Unsaved changes'}</span></div>
    </form>}
    <div className="creative-guidance"><h4>Creative guidance</h4><p>Built-in guidance supports truthful openings, useful narration, consistent visuals and feasible motion. The Script writer, validator and storyboard agent share the same frozen versions. Factual support and timing checks still decide acceptance.</p>
      <p className="muted">No extra model stage is added. Scores and writing rules do not measure audience retention.</p>
      {!!packs.length && <details><summary>Guidance versions</summary><ul>{packs.map(pack => <li key={pack}>{pack}</li>)}</ul></details>}
    </div>
  </section>;
}
