import { useCallback, useEffect, useRef, useState } from 'react';
import { request, write } from './api.js';

const projectName = p => p.fields.channel_page_name || p.fields.niche || 'Untitled project';
const defaults = { enabled: false, dayOfWeek: 1, time: '09:00', scriptCount: 10 };
const formValues = event => Object.fromEntries(new FormData(event.currentTarget));
const firstPage = () => ({ offset: null, next: null, previous: [] });

function Pager({ page, load, disabled, kind }) {
  return <div className="actions"><button className="secondary" disabled={disabled || !page.previous.length}
    onClick={() => load({ offset: page.previous.at(-1), previous: page.previous.slice(0, -1) })}>Previous {kind}</button>
    <button className="secondary" disabled={disabled || !page.next}
      onClick={() => load({ offset: page.next, previous: [...page.previous, page.offset] })}>Next {kind}</button></div>;
}

function Field({ label, ...props }) {
  const id = props.id || props.name;
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} {...props} /></div>;
}

function Login({ enter, api }) {
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const body = formValues(event);
    setBusy(true); setError('');
    try {
      const data = await api(`/api/auth/${registering ? 'register' : 'login'}`, body);
      form.current.reset();
      await enter(data.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section id="loginPage" className="login-page"><div className="card login-card">
    <div className="brand"><span className="brand-mark">CP</span><div><h1>Content Production</h1><small>Your projects, ideas, and storyboards</small></div></div>
    <h2>{registering ? 'Create your account' : 'Welcome back'}</h2>
    <p className="muted">{registering ? 'Choose a password of at least 12 characters.' : 'Log in to manage your content projects.'}</p>
    <form id="loginForm" ref={form} onSubmit={submit}>
      {registering && <><Field label="Full name" name="fullName" autoComplete="name" required maxLength={120} /><Field label="Email" name="email" type="email" autoComplete="email" required maxLength={254} /></>}
      <Field label="Username" name="username" autoComplete="username" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9_.-]+" />
      <Field label="Password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 12 : 1} maxLength={256} />
      <p id="authError" role="alert">{error}</p><button className="primary wide" disabled={busy}>{registering ? 'Create account' : 'Log in'}</button>
    </form>
    <button className="secondary wide" style={{ marginTop: 16 }} disabled={busy} onClick={() => { setRegistering(!registering); setError(''); form.current.reset(); }}>{registering ? 'Already have an account? Log in' : 'Create an account'}</button>
  </div></section>;
}

function NewProject({ api, created, cancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const body = formValues(event);
    let requestId = sessionStorage.getItem('projectRequestId');
    if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem('projectRequestId', requestId); }
    setBusy(true); setError('');
    try {
      const { project } = await api('/api/projects', { ...body, requestId });
      sessionStorage.setItem('projectRequestId', crypto.randomUUID());
      await created(project);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="card"><h3>New content project</h3><form id="projectForm" className="grid two" onSubmit={submit}>
    <Field label="Project name" name="name" required /><Field label="Niche" name="niche" required />
    <Field label="Platform" name="platform" required placeholder="YouTube, TikTok…" /><Field label="Target audience" name="targetAudience" required />
    <Field label="Content style" name="contentStyle" required /><Field label="Description" name="description" />
    {['Character', 'Style'].map(label => <div className="field" key={label}><label htmlFor={`has${label}Reference`}>{label} reference</label><select id={`has${label}Reference`} name={`has${label}Reference`}><option value="N">No</option><option value="Y">Yes</option></select></div>)}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="actions"><button className="primary" disabled={busy}>Create project</button><button className="secondary" type="button" onClick={cancel}>Cancel</button></div>
  </form></section>;
}

function Runs({ runs, retry, busy }) {
  return <div id="runs">{runs.length ? runs.map(run => {
    const failed = (run.items || []).filter(item => item.status === 'FAILED' || item.status === 'INTERRUPTED');
    const interrupted = run.status === 'INTERRUPTED' && (run.type || 'SCRIPTS') === 'SCRIPTS';
    const retryable = (run.type || 'SCRIPTS') === 'SCRIPTS' && !run.recoveredByRunId && (interrupted
      ? run.successfulCount < run.requestedCount
      : !['QUEUED', 'RUNNING'].includes(run.status) && failed.length > 0);
    const percent = Math.min(100, Math.round(run.processedCount / Math.max(1, run.requestedCount) * 100));
    return <div className="run" key={run.id}><div className="run-head"><b>{run.type || 'SCRIPTS'} · {run.source}</b><span className={`badge ${run.status}`}>{run.status}</span></div>
      <div className="progress" role="progressbar" aria-label="Run progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div>
      <div className="muted">{run.processedCount}/{run.requestedCount} processed · {run.successfulCount} successful · {run.failedCount} failed</div>
      {run.error && <div className="error">{run.error}</div>}
      {!!failed.length && <ul className="error">{failed.map((item, i) => <li key={item.ideaId || i}>{item.ideaId || 'Unknown item'}: {item.error || 'Generation interrupted'}</li>)}</ul>}
      {interrupted && run.interruptedItem && <div className="muted">Interrupted idea: {run.interruptedItem}</div>}
      {run.recoveredByRunId && <div className="muted">Resumed in run {run.recoveredByRunId.slice(0, 8)}</div>}
      {!!retryable && <button className="danger" disabled={busy} onClick={() => retry(run.id)}>{interrupted ? 'Resume interrupted run' : 'Retry failures'}</button>}
    </div>;
  }) : <span className="muted">No activity for this project.</span>}</div>;
}

function ProjectDetail({ id, api, notice, projectsChanged }) {
  const [project, setProject] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const [selected, setSelected] = useState([]);
  const [ideaPage, setIdeaPage] = useState(firstPage);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const ideaPageState = useRef(firstPage());
  const ideaRows = useRef([]);
  const ideaVersion = useRef(0);
  const ideaLoading = useRef(false);
  const [runs, setRuns] = useState([]);
  const [schedule, setSchedule] = useState(defaults);
  const [status, setStatus] = useState('Active');
  const [ideaCount, setIdeaCount] = useState(10);
  const [scriptCount, setScriptCount] = useState(10);
  const [scripts, setScripts] = useState([]);
  const [page, setPage] = useState({ offset: null, next: null, previous: [] });
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scriptsError, setScriptsError] = useState('');
  const controller = useRef(null);
  const scriptVersion = useRef(0);
  const pageState = useRef(page);
  const base = `/api/projects/${encodeURIComponent(id)}`;
  const active = project && (project.fields.status || 'Active') === 'Active';
  const read = useCallback(path => api(path, undefined, 'GET', controller.current.signal), [api]);

  async function loadIdeas(nextPage) {
    // Background refresh must not replace an explicit page navigation.
    if (!nextPage && ideaLoading.current) return;
    nextPage ||= ideaPageState.current;
    const version = ++ideaVersion.current;
    ideaLoading.current = true;
    setIdeasLoading(true);
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (nextPage.offset) query.set('offset', nextPage.offset);
      const data = await read(`${base}/ideas?${query}`);
      if (version !== ideaVersion.current) return;
      if (nextPage.offset === ideaPageState.current.offset) {
        const previousIds = new Set(ideaRows.current), currentIds = new Set(data.ideas.map(idea => idea.id));
        setSelected(old => old.filter(id => !previousIds.has(id) || currentIds.has(id)));
      }
      ideaRows.current = data.ideas.map(idea => idea.id);
      ideaPageState.current = { ...nextPage, next: data.nextOffset || null };
      setIdeaPage(ideaPageState.current); setIdeas(data.ideas);
    } finally { if (version === ideaVersion.current) { ideaLoading.current = false; setIdeasLoading(false); } }
  }
  async function loadRuns() {
    const data = await read(`/api/script-runs?projectId=${encodeURIComponent(id)}&limit=20`);
    setRuns(data.runs); return data.runs;
  }
  async function loadProject() {
    const data = await read(base); setProject(data.project); setStatus(data.project.fields.status || 'Active');
  }
  async function loadSchedule() {
    const data = await read(`${base}/schedule`); setSchedule(data.schedule ? { ...defaults, ...data.schedule } : defaults);
  }
  async function loadScripts(nextPage = pageState.current) {
    const version = ++scriptVersion.current;
    setScriptsLoading(true); setScriptsError('');
    try {
      const query = new URLSearchParams({ limit: '10' });
      if (nextPage.offset) query.set('offset', nextPage.offset);
      const data = await read(`${base}/scripts?${query}`);
      if (version !== scriptVersion.current) return;
      setScripts(data.scripts);
      pageState.current = { ...nextPage, next: data.nextOffset };
      setPage(pageState.current);
    } catch (err) { if (version === scriptVersion.current && err.name !== 'AbortError') setScriptsError(err.message); throw err; }
    finally { if (version === scriptVersion.current) setScriptsLoading(false); }
  }
  async function refresh() {
    await Promise.all([loadProject(), loadIdeas(), loadRuns(), loadSchedule(), loadScripts()]);
  }
  useEffect(() => {
    controller.current = new AbortController();
    let polling = false, lastRunState = '', warned = false;
    refresh().catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const latest = await loadRuns();
        const state = latest.map(run => `${run.id}:${run.status}`).join(',');
        if (state !== lastRunState) await Promise.all([loadProject(), loadIdeas(), loadScripts()]);
        lastRunState = state; warned = false;
      } catch (err) { if (err.name !== 'AbortError' && !warned) { notice(`Activity refresh failed: ${err.message}`, 'error'); warned = true; } }
      finally { polling = false; }
    }, 3000);
    return () => { clearInterval(timer); controller.current.abort(); ++scriptVersion.current; };
  }, [id]);

  async function action(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (err) { if (err.name !== 'AbortError') notice(err.message, 'error'); }
    finally { setBusy(false); }
  }
  async function createRun(body) {
    const { run } = await api('/api/script-runs', { projectId: id, ...body });
    if (body.mode === 'selected') setSelected(old => old.filter(id => !body.ideaIds.includes(id)));
    notice(`Run ${run.id.slice(0, 8)} queued`, 'success'); await loadRuns();
  }
  const generationDisabled = busy || !active;
  if (!project) return <div className="card" role="status">{error || 'Loading project…'}{error && <button className="secondary" onClick={() => action(refresh)}>Retry</button>}</div>;
  const stats = project.stats || {};
  return <section id="projectDetail">
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card"><div className="actions" style={{ justifyContent: 'space-between' }}><div><h3>{projectName(project)}</h3><div className="muted">{['niche', 'platform', 'target_audience', 'content_style'].map(key => project.fields[key]).filter(Boolean).join(' · ')}</div></div><button className="secondary" disabled={busy} onClick={() => action(async () => { await refresh(); setError(''); await projectsChanged(); })}>Refresh project</button></div>
      <div className="stats">{[['Ideas', 'ideas'], ['Scripts', 'scripts'], ['Approved', 'approvedScripts'], ['Storyboards', 'storyboards'], ['Draft / recovery', 'failedRecoveryItems']].map(([label, key]) => <div className="stat" key={key}><b>{Number(stats[key] || 0)}</b><span>{label}</span></div>)}</div>
      <form className="actions" onSubmit={event => { event.preventDefault(); action(async () => { await api(`${base}/status`, { status }, 'PATCH'); await refresh(); await projectsChanged(); notice('Project status saved', 'success'); }); }}>
        <label htmlFor="projectStatus">Project status</label><select id="projectStatus" value={status} onChange={e => setStatus(e.target.value)}><option>Active</option><option>Inactive</option></select><button className="secondary" disabled={busy}>Save status</button>
      </form><p className="muted">Setting a project inactive blocks new runs and disables the weekly schedule. Work already running may finish. After reactivating, enable the schedule when ready.</p>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><h3>1. Generate ideas</h3><p>Research this project and save ranked ideas without generating scripts yet.</p><form className="actions" onSubmit={event => { event.preventDefault(); action(async () => { const { run } = await api(`${base}/idea-runs`, { count: Number(ideaCount) }); notice(`Idea run ${run.id.slice(0, 8)} queued`, 'success'); await loadRuns(); }); }}><input aria-label="Idea count" type="number" min="1" max="50" required value={ideaCount} onChange={e => setIdeaCount(e.target.value)} /><button className="primary" disabled={generationDisabled}>Generate ideas</button></form></div>
      <div className="card"><h3>2. Generate scripts</h3><p>Eligible ideas are processed one at a time.</p><form className="actions" onSubmit={event => { event.preventDefault(); action(() => createRun({ mode: 'count', count: Number(scriptCount) })); }}><input aria-label="Script count" type="number" min="1" max="50" required value={scriptCount} onChange={e => setScriptCount(e.target.value)} /><button className="primary" disabled={generationDisabled}>Generate by count</button><button className="secondary" type="button" disabled={generationDisabled} onClick={() => selected.length ? action(() => createRun({ mode: 'selected', ideaIds: selected })) : notice('Select at least one idea', 'error')}>Generate selected</button></form></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="actions" style={{ justifyContent: 'space-between' }}><h3>Eligible ideas</h3><button className="secondary" disabled={busy} onClick={() => action(() => loadIdeas(firstPage()))}>Reload ideas</button></div><div className="ideas" id="ideas">{ideas.length ? ideas.map(idea => <label className="idea" key={idea.id}><input type="checkbox" checked={selected.includes(idea.id)} disabled={ideasLoading || (!selected.includes(idea.id) && selected.length >= 50)} onChange={e => setSelected(old => e.target.checked ? (old.length < 50 && !old.includes(idea.id) ? [...old, idea.id] : old) : old.filter(id => id !== idea.id))} /><span><b>{idea.fields.title || 'Untitled idea'}</b><br /><small>{idea.fields.topic || idea.fields.emotional_angle || ''}</small></span><span className="score">{idea.fields.content_score || ''}</span></label>) : <p className="muted">No eligible Draft ideas. Generate ideas or refresh the project.</p>}</div><p className="muted">{selected.length} selected across pages (maximum 50)</p><button className="secondary" disabled={!selected.length || busy} onClick={() => setSelected([])}>Clear selection</button><Pager page={ideaPage} load={next => action(() => loadIdeas(next))} disabled={busy || ideasLoading} kind="ideas" /></div>
      <div className="card"><h3>Weekly schedule</h3><form id="scheduleForm" onSubmit={event => { event.preventDefault(); action(async () => { await api(`${base}/schedule`, { enabled: schedule.enabled, dayOfWeek: Number(schedule.dayOfWeek), time: schedule.time, scriptCount: Number(schedule.scriptCount) }, 'PUT'); notice('Schedule saved', 'success'); }); }}><div className="grid two">
        <div className="field"><label htmlFor="scheduleEnabled">Status</label><select id="scheduleEnabled" value={String(schedule.enabled)} onChange={e => setSchedule({ ...schedule, enabled: e.target.value === 'true' })}><option value="false">Disabled</option><option value="true" disabled={!active}>Enabled</option></select></div>
        <div className="field"><label htmlFor="scheduleDay">Day</label><select id="scheduleDay" value={schedule.dayOfWeek} onChange={e => setSchedule({ ...schedule, dayOfWeek: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></div>
        <Field label="Time" id="scheduleTime" type="time" required value={schedule.time} onChange={e => setSchedule({ ...schedule, time: e.target.value })} />
        <Field label="Scripts per run" id="scheduleCount" type="number" min="1" max="50" required value={schedule.scriptCount} onChange={e => setSchedule({ ...schedule, scriptCount: e.target.value })} />
      </div><button className="primary" disabled={busy}>Save schedule</button></form></div>
    </div>
    <div className="card" style={{ marginTop: 16 }}><div className="actions" style={{ justifyContent: 'space-between' }}><h3>3. Review and approve scripts</h3><button className="secondary" disabled={busy || scriptsLoading} onClick={() => action(() => loadScripts())}>Refresh scripts</button></div><p>Review the narration and scenes before approving a Draft. Approved scripts are picked up by storyboard polling when it is enabled, or by the storyboard command.</p>
      <div id="scripts" aria-live="polite">{scriptsError && <p className="error" role="alert">{scriptsError}</p>}{scriptsLoading && <p className="muted">Loading scripts…</p>}{scripts.map(script => <details className="run" key={script.id}><summary><b>{script.fields.title || 'Untitled script'}</b> · {script.fields.status || 'Unknown'}</summary><h4>Narration</h4><pre>{script.fields.voiceover_script || 'No narration'}</pre><h4>Scenes</h4><pre>{script.fields.scenes_json || 'No scenes'}</pre>{script.fields.status === 'Draft' && active && <button className="primary" disabled={busy} onClick={() => action(async () => { await api(`${base}/scripts/${encodeURIComponent(script.id)}/approve`); await Promise.all([loadProject(), loadScripts()]); notice('Script approved for storyboard generation', 'success'); })}>Approve for storyboard</button>}</details>)}{!scripts.length && !scriptsLoading && !scriptsError && <p className="muted">No scripts for this project yet.</p>}</div>
      <div className="actions"><button className="secondary" disabled={scriptsLoading || !page.previous.length} onClick={() => action(() => loadScripts({ offset: page.previous.at(-1), previous: page.previous.slice(0, -1) }))}>Previous</button><button className="secondary" disabled={scriptsLoading || !page.next} onClick={() => action(() => loadScripts({ offset: page.next, previous: [...page.previous, page.offset] }))}>Next</button></div>
    </div>
    <div className="card" style={{ marginTop: 16 }}><div className="actions" style={{ justifyContent: 'space-between' }}><h3>Recent activity</h3><button className="secondary" disabled={busy} onClick={() => action(loadRuns)}>Refresh activity</button></div><Runs runs={runs} busy={generationDisabled} retry={runId => action(async () => { const { run } = await api(`/api/script-runs/${encodeURIComponent(runId)}/retry`); notice(`Retry ${run.id.slice(0, 8)} queued`, 'success'); await loadRuns(); })} /></div>
  </section>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [projects, setProjects] = useState([]);
  const [projectsPage, setProjectsPage] = useState(firstPage);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const projectsPageState = useRef(firstPage());
  const projectsVersion = useRef(0);
  const [view, setView] = useState('welcome');
  const [projectId, setProjectId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [initialError, setInitialError] = useState('');
  const epoch = useRef(0);
  const notice = useCallback((message, type = '') => setNotification({ message, type }), []);
  useEffect(() => { if (!notification) return; const timer = setTimeout(() => setNotification(null), 4200); return () => clearTimeout(timer); }, [notification]);
  const clearSession = useCallback(() => { ++epoch.current; ++projectsVersion.current; projectsPageState.current = firstPage(); setProjectsPage(firstPage()); setProjectsLoading(false); setUser(null); setProjects([]); setProjectId(null); setView('welcome'); }, []);
  const api = useCallback(async (path, body, method = 'POST', signal) => {
    const version = epoch.current;
    try {
      const data = method === 'GET' ? await request(path, { signal }) : await write(path, body, method);
      if (version !== epoch.current) throw new DOMException('Session changed', 'AbortError');
      return data;
    } catch (err) { if (err.status === 401 && !path.startsWith('/api/auth/') && version === epoch.current) clearSession(); throw err; }
  }, [clearSession]);
  const loadProjects = useCallback(async (nextPage = projectsPageState.current) => {
    const version = ++projectsVersion.current;
    setProjectsLoading(true);
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (nextPage.offset) query.set('offset', nextPage.offset);
      const data = await api(`/api/projects?${query}`, undefined, 'GET');
      if (version !== projectsVersion.current) return;
      projectsPageState.current = { ...nextPage, next: data.nextOffset || null };
      setProjectsPage(projectsPageState.current); setProjects(data.projects);
    } finally { if (version === projectsVersion.current) setProjectsLoading(false); }
  }, [api]);
  const enter = useCallback(async account => { ++epoch.current; setUser(account); setView('welcome'); await loadProjects(firstPage()); }, [loadProjects]);
  useEffect(() => {
    sessionStorage.removeItem('apiToken');
    const controller = new AbortController();
    api('/api/auth/me', undefined, 'GET', controller.signal).then(data => enter(data.user)).catch(err => { if (err.name !== 'AbortError' && err.status !== 401) setInitialError(err.message); }).finally(() => setInitializing(false));
    return () => controller.abort();
  }, [api, enter]);
  const open = id => { setProjectId(id); setView('detail'); };
  const selectedProject = projects.find(project => project.id === projectId);
  if (initializing) return <section className="login-page" role="status">Loading dashboard…</section>;
  return <>
    {!user ? <><Login api={api} enter={enter} />{initialError && <p className="error" role="alert">{initialError}</p>}</> : <div className="shell" id="dashboard"><aside><div className="brand"><button className="brand-mark" aria-label="Dashboard home" onClick={() => setView('welcome')}>CP</button><div><h1>Content Production</h1><small>Agent control plane</small></div></div><button className="primary wide" onClick={() => setView('new')}>+ New project</button><div className="side-title">Projects</div><nav aria-label="Projects">{projects.length ? projects.map(project => <button className={`project-link ${view === 'detail' && project.id === projectId ? 'active' : ''}`} key={project.id} onClick={() => open(project.id)}>{projectName(project)}</button>) : <span className="muted">No projects yet</span>}</nav><Pager page={projectsPage} load={next => loadProjects(next).catch(err => notice(err.message, "error"))} disabled={projectsLoading} kind="projects" /></aside>
      <main><div className="topbar"><div><h2>{view === 'new' ? 'New project' : view === 'detail' ? selectedProject ? projectName(selectedProject) : 'Project' : 'Dashboard'}</h2><div className="muted">{view === 'detail' ? 'Project control center' : 'Manage the content lifecycle from one place.'}</div></div><div className="auth"><span>{user.fullName || user.username}</span><button className="secondary" onClick={async () => { try { await api('/api/auth/logout'); clearSession(); } catch (err) { notice(err.message, 'error'); } }}>Log out</button></div></div>
        {view === 'welcome' && <section className="card hero"><h2>Ideas to storyboards, under your control.</h2><p>Create explicit content projects, generate ideas, process scripts sequentially, track every run, retry failures safely, and configure weekly production.</p><button className="primary" onClick={() => setView('new')}>Create a project</button><div className="grid two" style={{ marginTop: 28 }}>{projects.map(project => <div className="project-card" key={project.id}><h3>{projectName(project)}</h3><div className="muted">{[project.fields.niche, project.fields.platform].filter(Boolean).join(' · ')}</div><div className="mini">{['ideas', 'scripts', 'approvedScripts', 'storyboards'].map(key => <span key={key}>{Number(project.stats?.[key] || 0)} {key === 'approvedScripts' ? 'approved' : key}</span>)}</div><button className="secondary" onClick={() => open(project.id)}>Open project</button></div>)}</div></section>}
        {view === 'new' && <NewProject api={api} cancel={() => setView(projectId ? 'detail' : 'welcome')} created={async project => { await loadProjects(); open(project.id); notice('Project created', 'success'); }} />}
        {view === 'detail' && <ProjectDetail key={projectId} id={projectId} api={api} notice={notice} projectsChanged={loadProjects} />}
      </main></div>}
    {notification && <div id="notice" className={notification.type} role="status">{notification.message}</div>}
  </>;
}
