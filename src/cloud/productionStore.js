import { randomUUID } from 'node:crypto';
import { BlueprintSchema, hash } from '../creation/contract.js';
import { config } from '../config.js';
const now=()=>new Date().toISOString();
const failureMessage=error=>({SCRIPT_VALIDATION_FAILED:'Script validation failed. Check narration timing, factual support and scene visuals before creating a revised input.',CREATION_VISUALS_INVALID:'What If scenes are missing opening state, motion or final state. Retry the saved input.',AUDIT_SOURCE_INVALID:'The saved package failed source fidelity checks. Correct the source before requesting another audit.',AUDIT_INPUT_TOO_LARGE:'The full package exceeds the audit input limit; it was not truncated.',AUDIT_INVALID_REPORT:'The audit response failed evidence validation. Retry the audit; saved content is unchanged.'}[error?.code]||'Production step failed; retry the saved input.');
const fail=message=>Object.assign(new Error(message),{statusCode:409});
export const publicJob=job=>{
  if(!job)return null;
  const {payload,workflowId,inputHash,...value}=job;
  return {...value,...(payload?.entry?{entry:{title:payload.entry.title,mode:payload.entry.mode,profile:payload.entry.profile}}:{})};
};
export class CloudProductionStore {
  constructor(db,guard=()=>{}){this.db=db;this.guard=guard;}
  async query(sql,args=[]){this.guard();const result=await this.db.query(sql,args);this.guard();return result;}
  async transaction(work){this.guard();const result=await this.db.transaction(async tx=>{
    const query=async(sql,args=[])=>{this.guard();const r=await tx.query(sql,args);this.guard();return r;};
    return work({query});
  });this.guard();return result;}
  async getJob(id){if(!/^[\da-f-]{36}$/i.test(id||''))return null;return (await this.query('SELECT payload FROM app_creation_jobs WHERE id=$1',[id])).rows[0]?.payload||null;}
  async findRequest(projectId,requestId){return (await this.query('SELECT payload FROM app_creation_jobs WHERE project_id=$1 AND request_id=$2',[projectId,requestId])).rows[0]?.payload||null;}
  async list(projectId,{limit=20,offset=0}={}){
    const jobs=await this.query("SELECT payload-'payload'-'workflowId'-'inputHash' || jsonb_build_object('entry',jsonb_build_object('title',payload#>>'{payload,entry,title}','mode',payload#>>'{payload,entry,mode}','profile',payload#>>'{payload,entry,profile}')) AS payload FROM app_creation_jobs WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",[projectId,limit+1,offset]);
    // shortcut: show the newest 10 blueprint versions; add paging when projects exceed this; keep responses below Function limits.
    const blueprints=await this.query('SELECT payload FROM app_blueprints WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT 10',[projectId]);
    return {jobs:jobs.rows.slice(0,limit).map(({payload})=>{if(!payload.entry?.mode)delete payload.entry;return payload;}),blueprints:blueprints.rows.map(r=>r.payload),nextOffset:jobs.rows.length>limit?offset+limit:null};
  }
  async blueprint(projectId,id){if(!/^[\da-f-]{36}$/i.test(id||''))return null;return (await this.query('SELECT payload FROM app_blueprints WHERE id=$1 AND project_id=$2',[id,projectId])).rows[0]?.payload||null;}
  async saveBlueprint(projectId,content,{parentId=null,analysis=null,source=null}={}){
    content=BlueprintSchema.parse(content);
    return this.transaction(async tx=>{
      // A per-project advisory lock serializes version allocation and deduplicates analysis replay.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[projectId]);

      if(source?.jobId){const prior=(await tx.query("SELECT payload FROM app_blueprints WHERE project_id=$1 AND payload#>>'{source,jobId}'=$2",[projectId,source.jobId])).rows[0]?.payload;if(prior)return prior;}
      const parent=parentId?(await tx.query('SELECT payload FROM app_blueprints WHERE id=$1 AND project_id=$2',[parentId,projectId])).rows[0]?.payload:null;
      if(parentId&&!parent)throw fail('Blueprint version not found');
      const familyId=parent?.familyId||randomUUID();
      const version=Number((await tx.query("SELECT COALESCE(max((payload->>'version')::int),0)+1 AS version FROM app_blueprints WHERE project_id=$1 AND family_id=$2",[projectId,familyId])).rows[0].version);
      const b={id:randomUUID(),projectId,familyId,parentId,version,content,analysis:analysis??parent?.analysis??null,source:source??(parent?.source?{...parent.source,derivedFromJobId:parent.source.jobId||parent.source.derivedFromJobId,jobId:null}:null),status:'DRAFT',approval:null,createdAt:now()};
      await tx.query('INSERT INTO app_blueprints(id,project_id,family_id,version,payload) VALUES($1,$2,$3,$4,$5)',[b.id,projectId,familyId,version,b]);return b;
    });
  }
  async change(table,id,work){
    if(table!=='app_audit_enrollments'&&!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id||''))return null;
    if(!['app_creation_jobs','app_blueprints','app_audits','app_audit_enrollments'].includes(table))throw Error('Unknown production table');
    return this.transaction(async tx=>{
      const value=(await tx.query('SELECT payload FROM '+table+' WHERE id=$1 FOR UPDATE',[id])).rows[0]?.payload;
      if(!value)return null;const result=await work(value,tx);
      if(result===false)return null;
      await tx.query('UPDATE '+table+' SET payload=$2 WHERE id=$1',[id,value]);return value;
    });
  }
  async approve(projectId,id,reviewerId,reason){return this.change('app_blueprints',id,b=>{
    if(b.projectId!==projectId||b.status==='ARCHIVED')throw fail('Blueprint unavailable');
    if(!b.approval)b.approval={reviewerId,reason,at:now()};b.status='APPROVED';
  });}
  async archive(projectId,id){return this.change('app_blueprints',id,b=>{if(b.projectId!==projectId)throw fail('Blueprint unavailable');b.status='ARCHIVED';});}
  async ensureCapacity(tx){
    await tx.query('SELECT pg_advisory_xact_lock(948372)');
    const capacity=await tx.query("SELECT (SELECT count(*) FROM app_runs WHERE payload->>'status' IN ('QUEUED','RUNNING'))+(SELECT count(*) FROM app_creation_jobs WHERE payload->>'status' IN ('QUEUED','RUNNING'))+(SELECT count(*) FROM app_audits WHERE payload->>'status' IN ('PENDING','RUNNING')) AS count");
    if(Number(capacity.rows[0].count)>=config.server.maxQueuedPipelines+config.server.maxConcurrentPipelines)throw Object.assign(Error('Queue is full; retry later'),{statusCode:503});
  }
  async create(projectId,requestId,type,payload,original){
    return this.transaction(async tx=>{
      await tx.query('SELECT pg_advisory_xact_lock(948372)');
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[projectId]);

      const prior=(await tx.query('SELECT payload FROM app_creation_jobs WHERE project_id=$1 AND request_id=$2',[projectId,requestId])).rows[0]?.payload;
      const inputHash=hash(original);
      if(prior){if(prior.inputHash!==inputHash||prior.type!==type)throw fail('Request ID already used for different input');return prior;}
      await this.ensureCapacity(tx);
      if(payload.entry?.blueprintId){const b=(await tx.query('SELECT payload FROM app_blueprints WHERE id=$1 AND project_id=$2 FOR SHARE',[payload.entry.blueprintId,projectId])).rows[0]?.payload;if(b?.status!=='APPROVED')throw fail('Select an approved blueprint version');}
      const job={id:randomUUID(),projectId,requestId,type,payload,inputHash,status:'QUEUED',attempt:0,providerAttempt:0,workflowId:null,createdAt:now(),result:null,error:null};
      await tx.query('INSERT INTO app_creation_jobs(id,project_id,request_id,payload) VALUES($1,$2,$3,$4)',[job.id,projectId,requestId,job]);return job;
    });
  }
  async retry(projectId,id){return this.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(948372)');
    const j=(await tx.query('SELECT payload FROM app_creation_jobs WHERE id=$1 AND project_id=$2 FOR UPDATE',[id,projectId])).rows[0]?.payload;
    if(!j)return null;
    if(['FAILED','INTERRUPTED'].includes(j.status)){await this.ensureCapacity(tx);Object.assign(j,{status:'QUEUED',workflowId:null,providerAttempt:(j.providerAttempt??j.attempt)+(['SCRIPT_PERSIST_FAILED','REFERENCE_PERSIST_FAILED'].includes(j.errorCode)?0:1),attempt:j.attempt+1,error:null});await tx.query('UPDATE app_creation_jobs SET payload=$2 WHERE id=$1',[id,j]);}
    return j;
  });}
  async claim(table,id,actor){return this.change(table,id,j=>{if(!['QUEUED','PENDING','RUNNING'].includes(j.status)||(j.workflowId&&j.workflowId!==actor))return false;Object.assign(j,{status:'RUNNING',workflowId:actor,startedAt:j.startedAt||now()});});}
  async finish(table,id,actor,{result,report,error}){return this.change(table,id,j=>{
    if(j.status!=='RUNNING'||j.workflowId!==actor)throw fail('Production claim lost');
    Object.assign(j,{status:error?'FAILED':'COMPLETE',completedAt:now(),error:error?failureMessage(error):null,errorCode:error?.code||null,...(report?{report,verdict:report.verdict}:{}),...(result?{result}:{})});
  });}
  async queued(table){return (await this.query("SELECT payload FROM "+table+" WHERE payload->>'status' IN ('QUEUED','PENDING','RUNNING') ORDER BY created_at LIMIT 50")).rows.map(r=>r.payload);}
  async resetOwner(table,id,actor){return this.change(table,id,j=>{if(j.workflowId!==actor||j.status!=='RUNNING')return false;Object.assign(j,{status:table==='app_audits'?'PENDING':'QUEUED',workflowId:null});});}
}
