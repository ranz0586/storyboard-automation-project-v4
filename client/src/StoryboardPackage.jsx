import { useRef, useState } from 'react';
import { readStoryboard, text, displayValue, timeRange, printableStoryboard, downloadFile } from './storyboard.js';

import StoryboardAudit from './StoryboardAudit.jsx';

function Values({ value }) {
  if (!value || typeof value !== 'object') return <p>{text(value)}</p>;
  return <dl className="production-values">{Object.entries(value).filter(([, v]) => v != null && v !== '').map(([key, v]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{displayValue(v)}</dd></div>)}</dl>;
}
function Prompt({ label, value }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(text(value)); setMessage('Copied'); }
    catch { setMessage('Copy unavailable. Expand the prompt and select its text.'); }
  }
  return <div className="production-prompt"><div className="actions"><b>{label}</b>{value && <button className="secondary" onClick={copy}>Copy {label}</button>}<span role="status">{message}</span></div>
    {value ? <details><summary>Read full {label}</summary><div className="prompt-text">{text(value)}</div></details> : <p className="muted">Prompt not saved in this package.</p>}</div>;
}
function Frame({ frame, index, paired = false, path }) {
  if (!frame || typeof frame !== 'object') return <p className="error">Invalid scene data.</p>;
  return <article className="scene-card" data-storyboard-path={path} data-scene-id={frame.scene_number ?? frame.frame ?? index + 1} tabIndex={-1}><header><h5>{paired ? 'Scene' : 'Keyframe'} {text(frame.scene_number ?? frame.frame ?? index + 1)}</h5><span>{timeRange(frame)}</span></header>
    <div className="scene-content"><div className="preview-placeholder">No preview attached</div><div>
      <Values value={{ shot: frame.shot_type, camera: frame.camera ?? frame.camera_angle, visual: frame.visual ?? frame.visual_description,
        action: frame.character_action, expression: frame.facial_expression, narration: frame.narration ?? frame.caption_narration }} />
    </div></div><Prompt label="Prompt A / image" value={frame.image_prompt || frame.first_frame_prompt || (paired ? frame.panel_prompt : undefined)} />
    {paired && <Prompt label="Prompt B / animation" value={frame.video_prompt} />}</article>;
}
export default function StoryboardPackage({ fields, title, base, api, disabled }) {
  const root=useRef(null);
  const [auditData,setAuditData]=useState(null);
  const auditStatus=auditData?.readiness?.status||'Unaudited';
  function navigate(pointer,issue){
    const relative=pointer.replace(/^\/storyboard/,'');
    const cards=[...(root.current?.querySelectorAll('[data-storyboard-path]')||[])];
    const target=cards.filter(el=>relative===el.dataset.storyboardPath||relative.startsWith(el.dataset.storyboardPath+'/')).sort((a,b)=>b.dataset.storyboardPath.length-a.dataset.storyboardPath.length)[0]||cards.find(el=>issue?.scene_id!=null&&el.dataset.sceneId===String(issue.scene_id));
    if(target){target.scrollIntoView({block:'start',behavior:'auto'});target.focus({preventScroll:true});}
  }
  const { output, warning, legacySummary } = readStoryboard(fields);
  const safeName = (title || 'storyboard').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  return <div className="production-package" ref={root}>
    <div className="actions production-toolbar"><button className="secondary" onClick={() => downloadFile(safeName + '-sheets.html', printableStoryboard(title, fields, {auditStatus}), 'text/html')}>Export printable sheets</button><button className="secondary" onClick={() => downloadFile(safeName + '.json', JSON.stringify(fields, null, 2), 'application/json')}>Export saved JSON</button></div>
    {base && api && <StoryboardAudit base={base} api={api} disabled={disabled} onChange={setAuditData} onNavigate={navigate} />}
    <p className="muted">Draft exports remain available. Production exports require a current review.</p>
    <p className="muted">All saved panels are shown. Timings are planned; prompts are not rendered media. Printable sheets keep full text and paginate long content.</p>
    {warning && <p className="error" role="alert">{warning}</p>}{legacySummary && <><p className="muted" role="note">Legacy storyboard: the summary is stored as text. Showing the saved structure fields.</p><p>{legacySummary}</p></>}{output.production_brief && <><h4>Saved production brief</h4><Values value={output.production_brief} /></>}
    <h4>Master assets and references</h4><Values value={output.master_assets} />
    {['character_sheet_prompt', 'location_sheet_prompt', 'thumbnail_prompt'].filter(key => fields[key]).map(key => <Prompt key={key} label={key.replaceAll('_', ' ')} value={fields[key]} />)}
    {[1, 2, 3].map(kind => { const items = output['structure' + kind] || []; return !!items.length && <section className="storyboard-structure" aria-label={'Structure ' + kind} key={kind}><h4>Structure {kind}{kind === 1 ? ' / individual clips' : kind === 2 ? ' / video panels' : ' / multi-keyframe panels'}</h4>
      {items.map((item, index) => kind === 1 ? <Frame key={index} frame={item} index={index} paired path={'/structure1/' + index} /> : <section className="storyboard-panel" key={index} data-storyboard-path={'/structure' + kind + '/' + index} tabIndex={-1}><header><h5>Panel {text(item?.panel ?? item?.panel_number ?? index + 1)}{item?.theme ? ' / ' + text(item.theme) : ''}</h5><span>{timeRange(item || {})}</span></header>
        <Values value={{ summary: item?.panel_summary, assets: item?.master_assets, composition: item?.composition_notes }} />
        <Prompt label="Panel description" value={item?.panel_prompt} /><Prompt label="Prompt B / panel animation" value={item?.video_prompt} />
        {kind === 2 && Array.isArray(item?.keyframes) && <p className="muted">Scene references: {item.keyframes.map(ref => ref && typeof ref === 'object' ? ref.scene_number ?? ref.frame ?? ref.scene ?? '?' : text(ref)).join(', ')}</p>}
        {kind === 3 && <div className="keyframes">{Array.isArray(item?.keyframes) && item.keyframes.length ? item.keyframes.map((frame, i) => <Frame key={i} frame={frame} index={i} path={'/structure3/' + index + '/keyframes/' + i} />) : <p className="muted">No keyframes saved for this panel.</p>}</div>}
      </section>)}
    </section>; })}
    <details className="raw-storyboard"><summary>Raw saved storyboard data</summary><pre>{JSON.stringify(fields, null, 2)}</pre></details>
  </div>;
}
