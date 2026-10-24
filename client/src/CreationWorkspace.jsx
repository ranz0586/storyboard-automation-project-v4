import { STRUCTURE_OPTIONS } from '../../shared/storyboardStructures.js';
import { useCallback, useEffect, useRef, useState } from 'react';
const emptyBlueprint={name:'',promise:'',opening:'',progression:[''],payoff:'',visualRules:'',avoid:''};
function BlueprintEditor({blueprint,save,disabled}) {
 const [content,setContent]=useState(blueprint?.content||emptyBlueprint);
 return <form className="creation-editor" onSubmit={e=>{e.preventDefault();save(content,blueprint?.id||null);}}>
  {Object.keys(emptyBlueprint).map(key=><label key={key}>{({name:'Blueprint name',promise:'Audience promise',opening:'Opening pattern',progression:'Progression (one beat per line)',payoff:'Payoff',visualRules:'Visual rules',avoid:'Avoid'})[key]}
   <textarea required maxLength={key==='progression'?16000:3000} rows={key==='progression'?4:2} value={key==='progression'?content[key].join('\n'):content[key]} onChange={e=>setContent({...content,[key]:key==='progression'?e.target.value.split('\n'):e.target.value})}/></label>)}
  <button className="secondary" disabled={disabled}>Save new blueprint version</button>
 </form>;
}
export default function CreationWorkspace({base,api,disabled}) {
 const [state,setState]=useState({blueprints:[],jobs:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState('topic'),[title,setTitle]=useState(''),[content,setContent]=useState(''),[profile,setProfile]=useState('standard'),[blueprintId,setBlueprintId]=useState(''),[parentId,setParentId]=useState(null);
 const [structures,setStructures]=useState(['structure1']);
 const [otherSources,setOtherSources]=useState([]);
 const [sourceUrl,setSourceUrl]=useState(''),[sourceExcerpt,setSourceExcerpt]=useState('');
 const [page,setPage]=useState(0);
 const lastPayload=useRef('');
 const [sourceKind,setSourceKind]=useState('transcript'),[image,setImage]=useState(null),[sourceName,setSourceName]=useState(''),[provenance,setProvenance]=useState('');
 const requestId=useRef(crypto.randomUUID()),reading=useRef(false);
 const refresh=useCallback(async signal=>{const next=await api(base+'/creation?offset='+page,undefined,'GET',signal);if(!signal?.aborted)setState(next);},[api,base,page]);
 useEffect(()=>{const c=new AbortController();refresh(c.signal).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[refresh]);
 useEffect(()=>{if(blueprintId&&!state.blueprints.some(b=>b.id===blueprintId&&b.status==='APPROVED'))setBlueprintId('');},[state.blueprints,blueprintId]);
 const pending=state.jobs.some(j=>['QUEUED','RUNNING'].includes(j.status));
 useEffect(()=>{if(!pending)return;const c=new AbortController();const timer=setInterval(async()=>{if(reading.current)return;reading.current=true;try{await refresh(c.signal);}catch(e){if(e.name!=='AbortError')setError(e.message);}finally{reading.current=false;}},2000);return()=>{clearInterval(timer);c.abort();};},[pending,refresh]);
 async function act(fn){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function submit(e){e.preventDefault();await act(async()=>{
  const input=mode==='reference'?{type:'ANALYZE',source:{kind:sourceKind,name:sourceName||title||'Reference',provenance,text:content,...(sourceKind==='image'?image:{})}}:
    {type:'SCRIPT',entry:{mode,title,content,factual_sources:[...(sourceUrl&&sourceExcerpt?[{url:sourceUrl,excerpt:sourceExcerpt}]:[]),...otherSources],profile,blueprintId:blueprintId||null,parentId,...(profile==='what-if'?{structures}:{})}};
  const fingerprint=JSON.stringify(input);if(lastPayload.current!==fingerprint){requestId.current=crypto.randomUUID();lastPayload.current=fingerprint;}
  await api(base+'/creation-jobs',{requestId:requestId.current,...input});requestId.current=crypto.randomUUID();
 });}
 async function upload(file){setError('');setImage(null);if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)||file.size>512000){setError('Choose a PNG/JPEG up to 500 KB.');return;}
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('Could not read image'));r.readAsDataURL(file);});setImage({mimeType:file.type,data});setSourceName(file.name);
 }
 return <details className="creation-workspace"><summary>Start from a topic, your script or a reference</summary>
  <p>Research runs stay unchanged. Use an approved blueprint only when you want its recipe; every generated script still needs your approval.</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <form className="creation-form" onSubmit={submit}>
   <label>Start with<select value={mode} onChange={e=>{setMode(e.target.value);setParentId(null);requestId.current=crypto.randomUUID();}}><option value="topic">My topic</option><option value="script">My script</option><option value="reference">Analyze a reference</option></select></label>
   {parentId&&<p>New variant of saved input. The original stays unchanged. <button type="button" className="secondary" onClick={()=>setParentId(null)}>Clear variant</button></p>}
   {mode!=='reference'?<>
    <label>Working title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <div className="grid two"><label>Optional blueprint<select value={blueprintId} onChange={e=>setBlueprintId(e.target.value)}><option value="">No blueprint</option>{state.blueprints.filter(b=>b.status==='APPROVED').map(b=><option key={b.id} value={b.id}>{b.content.name} · v{b.version}</option>)}</select></label>
    <label>Content profile<select value={profile} onChange={e=>{setProfile(e.target.value);setStructures(['structure1']);}}><option value="standard">Standard narrated video</option><option value="what-if">What If — hypothetical consequence</option></select></label></div>
    {profile==='what-if'&&<fieldset><legend>Output structures for this new item</legend>{STRUCTURE_OPTIONS.map(o=><label key={o.key}><input type="checkbox" checked={structures.includes(o.key)} onChange={e=>setStructures(e.target.checked?[...structures,o.key]:structures.filter(k=>k!==o.key))}/>{o.label}</label>)}</fieldset>}
    {profile==='what-if'&&<p>Plan one consequence through opening state, motion and result. Defaults to Structure 1. Changing output formats creates a new production variant.</p>}
   </>:<><label>Reference type<select value={sourceKind} onChange={e=>setSourceKind(e.target.value)}><option value="transcript">Transcript or source text</option><option value="image">Still image (PNG/JPEG)</option></select></label>
    <label>Source name<input maxLength={120} value={sourceName} onChange={e=>setSourceName(e.target.value)}/></label><label>Source attribution or URL (not fetched)<input maxLength={500} value={provenance} onChange={e=>setProvenance(e.target.value)}/></label>
    {sourceKind==='image'&&<label>Reference image, up to 500 KB<input type="file" accept="image/png,image/jpeg" onChange={e=>upload(e.target.files[0]).catch(err=>setError(err.message))}/></label>}
    <p>Analysis proposes a draft recipe. Review its evidence and limitations before approving it. A transcript cannot show visuals; a still cannot show motion or sound.</p>
   </>}
   <label>{mode==='script'?'Supplied script':mode==='reference'?'Reference text or image context':'Topic and instructions for this item'}<textarea required={mode!=='reference'||sourceKind==='transcript'} maxLength={20000} rows={6} value={content} onChange={e=>setContent(e.target.value)}/></label>
   {mode!=='reference'&&<fieldset className="creation-sources"><legend>Optional factual support</legend><label>Source URL<input type="url" maxLength={2048} value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} required={!!sourceExcerpt}/></label><label>Supporting excerpt<textarea maxLength={3000} rows={3} value={sourceExcerpt} onChange={e=>setSourceExcerpt(e.target.value)} required={!!sourceUrl}/></label>{otherSources.length>0&&<p>{otherSources.length} additional sources from the saved input will be retained. <button type="button" className="secondary" onClick={()=>setOtherSources([])}>Clear additional sources</button></p>}<p>Supply an excerpt for factual claims. A blueprint is creative guidance, not evidence.</p></fieldset>}
   <button className="primary" disabled={disabled||busy||(mode!=='reference'&&profile==='what-if'&&!structures.length)||(mode==='reference'&&sourceKind==='image'&&!image)}>{mode==='reference'?'Analyze into draft blueprint':'Create one draft script'}</button>
  </form>
  <section className="creation-history" aria-label="Saved creation jobs"><div className="actions"><h4>Saved inputs and results</h4><button className="secondary" disabled={busy} onClick={()=>act(()=>refresh())}>Refresh saved inputs</button></div>
   {!state.jobs.length&&<p className="muted">No saved inputs yet.</p>}{state.jobs.map(j=><div className="run" key={j.id}><strong>{j.entry?.title||'Reference analysis'}</strong> · <span role="status">{j.status}</span>{j.error&&<p className="error">{j.error}</p>}{j.result?.scriptId&&<p>Draft saved. Open Scripts to review and approve it.</p>}
    <div className="actions">{['FAILED','INTERRUPTED'].includes(j.status)&&<button className="secondary" disabled={disabled||busy} onClick={()=>act(()=>api(base+'/creation-jobs/'+j.id+'/retry',{}))}>Retry saved input</button>}
    {j.entry&&<button className="secondary" disabled={disabled||busy} onClick={()=>act(async()=>{const {entry}=await api(base+'/creation-jobs/'+j.id,undefined,'GET');setMode(entry.mode);setTitle(j.entry.title+' — variant');setContent(entry.content);setOtherSources(entry.factual_sources?.slice(1)||[]);setSourceUrl(entry.factual_sources?.[0]?.url||'');setSourceExcerpt(entry.factual_sources?.[0]?.excerpt||'');setProfile(j.entry.profile);setBlueprintId(state.blueprints.some(b=>b.id===entry.blueprintId&&b.status==='APPROVED')?entry.blueprintId:'');setStructures(entry.structures||['structure1']);setParentId(j.id);requestId.current=crypto.randomUUID();})}>Make a variant</button>}</div>
   </div>)}
   <div className="actions"><button className="secondary" disabled={busy||page===0} onClick={()=>setPage(Math.max(0,page-20))}>Previous saved inputs</button><button className="secondary" disabled={busy||state.nextOffset==null} onClick={()=>setPage(state.nextOffset)}>Next saved inputs</button></div>
  </section>
  <section aria-label="Reusable blueprints"><h4>Reusable blueprints</h4><p>Approved versions stay available for future scripts. Editing creates a new draft version. Existing items keep their frozen version.</p>
   <details><summary>Create a blueprint manually</summary><BlueprintEditor disabled={disabled||busy} save={(value,parentId)=>act(()=>api(base+'/blueprints',{content:value,parentId}))}/></details>
   {state.blueprints.map(b=><details className="run" key={b.id}><summary>{b.content.name} · v{b.version} · {b.status}</summary>
    <dl className="production-values">{Object.entries(b.content).filter(([k])=>k!=='name').map(([k,v])=><div key={k}><dt>{({promise:'Audience promise',opening:'Opening pattern',progression:'Progression',payoff:'Payoff',visualRules:'Visual rules',avoid:'Avoid'})[k]}</dt><dd>{Array.isArray(v)?v.join(' → '):v}</dd></div>)}</dl>
    {b.source&&<p>Source: {b.source.name} · {b.source.kind}. Saved analysis stays available without the original connection.</p>}
    {b.analysis&&<ul>{b.analysis.map((o,i)=><li key={i}><b>{o.kind}:</b> {o.statement}{o.evidence&&<blockquote>{o.evidence}</blockquote>}</li>)}</ul>}
    {b.approval&&<p>Approved: {b.approval.reason}</p>}
    {b.status==='DRAFT'&&<form onSubmit={e=>{e.preventDefault();const reason=new FormData(e.currentTarget).get('reason');act(()=>api(base+'/blueprints/'+b.id+'/approve',{reason}));}}><label>Reason for blueprint approval<textarea name="reason" required minLength={10} maxLength={2000} rows={2}/></label><button className="secondary" disabled={disabled||busy}>Approve blueprint version</button></form>}
    <details><summary>Edit as a new version</summary><BlueprintEditor blueprint={b} disabled={disabled||busy} save={(value,parentId)=>act(()=>api(base+'/blueprints',{content:value,parentId}))}/></details>
    {b.status!=='ARCHIVED'&&<button className="secondary" disabled={disabled||busy} onClick={()=>act(()=>api(base+'/blueprints/'+b.id+'/archive',{}))}>Archive blueprint version</button>}
   </details>)}
  </section>
 </details>;
}
