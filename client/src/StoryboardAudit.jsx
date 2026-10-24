import { useCallback, useEffect, useState } from 'react';
import { downloadFile, printableStoryboard } from './storyboard.js';
import './StoryboardAudit.css';

const pending = audit => ['PENDING', 'RUNNING'].includes(audit?.status);
export default function StoryboardAudit({ base, api, onChange, onNavigate, disabled = false }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [reason, setReason] = useState('');
  const endpoint = base + '/storyboard-audit';
  const apply = useCallback(next => { setData(next); onChange?.(next); }, [onChange]);
  const load = useCallback(async signal => {
    const next = await api(endpoint, undefined, 'GET', signal);
    if (!signal?.aborted) { apply(next); setError(''); }
  }, [api, endpoint, apply]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setReason('');
    load(controller.signal).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!pending(data?.audit)) return;
    const controller = new AbortController(); let reading = false;
    const timer = setInterval(async () => {
      if (reading) return; reading = true;
      try { await load(controller.signal); }
      catch (err) { if (err.name !== 'AbortError') setError(err.message); }
      finally { reading = false; }
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [data?.audit?.status, load]);
  async function act(work) {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const audit = data?.audit, report = audit?.report, readiness = data?.readiness;
  const waiting = pending(audit), stale = audit?.stale || readiness?.status === 'STALE';
  const canAudit = !audit || stale || ['FAILED', 'INTERRUPTED'].includes(audit.status);
  const editorial = readiness?.reviewable && audit?.status === 'COMPLETE' && !stale && audit.verdict === 'NEEDS_REVIEW' && !report?.issues?.some(issue => issue.severity === 'blocking');
  const status = stale ? 'Out of date' : audit ? audit.status === 'COMPLETE' ? audit.verdict?.replaceAll('_', ' ') : audit.status : 'Unaudited';
  return <section className="storyboard-audit" aria-label="Storyboard quality review">
    <header className="audit-heading"><div><h4>Production-plan review</h4><p>Reviews the production plan, not rendered media or measured viewer retention.</p></div><span className={'audit-state ' + (readiness?.ready ? 'success' : '')} role="status">{data ? status : 'Loading review'}</span></header>
    {error && <p className="error" role="alert">{error}</p>}
    {audit?.error && <p className="error">{audit.error}</p>}
    {readiness?.reason && <p className="audit-readiness">{readiness.ready ? 'Ready for production. ' : ''}{readiness.reason}</p>}
    <div className="actions">
      {data && canAudit && <button className="secondary" disabled={disabled || busy || waiting} onClick={() => act(async () => apply(await api(endpoint, {})))}>{stale ? 'Audit updated storyboard' : audit ? 'Retry audit' : 'Audit saved storyboard'}</button>}
      <button className="secondary" disabled={busy} onClick={() => act(() => load())}>Refresh audit status</button>
      {report && <button className="secondary" onClick={() => downloadFile('storyboard-audit.json', JSON.stringify(data, null, 2), 'application/json')}>Export audit report</button>}
      <button className="primary" disabled={busy || !readiness?.ready} onClick={() => act(async () => {
        const result = await api(base + '/production-export', undefined, 'GET');
        if (!result.readiness?.ready || !result.storyboard?.fields) throw new Error('The current storyboard is not ready for production export.');
        const title = result.script?.fields?.title || 'Storyboard';
        downloadFile(title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) + '-production.html', printableStoryboard(title, result.storyboard.fields, { production: true, auditStatus: result.audit?.acknowledgement ? 'Editorial findings accepted' : result.audit?.verdict || 'Reviewed' }), 'text/html');
        apply({ audit: result.audit, readiness: result.readiness });
      })}>Export production sheets</button>
    </div>
    {waiting && <p className="muted">The saved storyboard is safe. This review does not generate another storyboard.</p>}
    {report && <>
      {!!report.issues?.length && <div className="audit-findings"><h5>Findings</h5>{report.issues.map((issue, index) => <article className="audit-finding" key={issue.id || index}>
        <div className="audit-issue-heading"><strong>{issue.severity === 'blocking' ? 'Blocking' : 'Editorial'} / {String(issue.category || 'Review').replaceAll('_', ' ')}</strong>{issue.scene_id != null && <span>Scene {issue.scene_id}</span>}{issue.panel_id != null && <span>Panel {issue.panel_id}</span>}</div>
        <p>{issue.explanation}</p>{issue.evidence && <blockquote>{issue.evidence}</blockquote>}
        {issue.related_evidence?.map((evidence, i) => <blockquote key={i}>{evidence.quote}</blockquote>)}
        {issue.suggested_fix && <p><b>Suggested correction:</b> {issue.suggested_fix}</p>}
        {issue.fix_owner && <p className="muted">Correction belongs to: {issue.fix_owner}</p>}
        {issue.pointer && onNavigate && (/^\/storyboard\/structure[123]\//.test(issue.pointer) || issue.scene_id != null || issue.panel_id != null) && <button className="secondary" disabled={stale} onClick={() => onNavigate(issue.pointer, issue)}>Go to referenced scene or panel</button>}
      </article>)}</div>}
      {!!report.prioritized_actions?.length && <><h5>Next actions</h5><ol>{report.prioritized_actions.map((item, i) => <li key={i}>{item}</li>)}</ol></>}
      {!!report.dimensions?.length && <details className="audit-score-details"><summary>Editorial scorecard and evidence limits</summary><dl className="audit-dimensions">{report.dimensions.map(item => <div key={item.id}><dt>{String(item.id).replaceAll('_', ' ')}</dt><dd><b>{item.applicable && item.score != null ? item.score + ' / 10' : 'Not assessed'}</b><p>{item.rationale}</p></dd></div>)}</dl>
        <p>Scores are editorial assessments of these prompts, not predicted retention percentages.</p>
        <ul>{(report.evidence_limits || []).map((item, i) => <li key={i}>{item}</li>)}</ul>
      </details>}
    </>}
    {editorial && !audit.acknowledgement && <form className="audit-acknowledgement" onSubmit={event => { event.preventDefault(); act(async () => { apply(await api(endpoint + '/review', { auditId: audit.id, reason: reason.trim() })); setReason(''); }); }}>
      <label>Reason for accepting editorial findings<textarea value={reason} onChange={event => setReason(event.target.value)} required minLength={10} maxLength={2000} rows={3} /></label>
      <p className="muted">Accepting editorial tradeoffs does not clear structural blockers or change the report into a Pass.</p>
      <button className="secondary" disabled={disabled || busy || reason.trim().length < 10}>Accept editorial findings</button>
    </form>}
    {audit?.acknowledgement && <p className="audit-acknowledged"><b>Editorial findings accepted:</b> {audit.acknowledgement.reason}</p>}
  </section>;
}
