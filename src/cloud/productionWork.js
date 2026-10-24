import { processIdeaScript } from '../scriptWorker.js';
import { referenceAnalysisAgent } from '../agents/referenceAnalysis/index.js';
import { storyboardAuditAgent } from '../agents/storyboardAudit/index.js';
import { buildAuditInput } from '../audits/contract.js';
import { belongsToProject, assertProjectActive, projectKey } from '../utils/project.js';
import { auditFingerprint } from './auditStore.js';
import { hash } from '../creation/contract.js';
import { logger } from '../utils/logger.js';
export function assertAuditOwnership(project,script,storyboard){
  const f=storyboard?.fields,link=f?.Scripts??f?.script_id;
  if(!belongsToProject(script,project)||!storyboard?.id||f.storyboard_id!==script.fields.video_id||
    (Array.isArray(link)?!link.includes(script.id):link!==script.id)||
    (f.project_id&&f.project_id!==projectKey(project))||
    (f.Projects&&(Array.isArray(f.Projects)?!f.Projects.includes(project.id):![project.id,projectKey(project)].includes(f.Projects))))
    throw Object.assign(Error('Storyboard not found in this project'),{statusCode:404});
}
export async function auditInput({projectRecord,scriptRecord,storyboardRecord,briefStore}){
  assertAuditOwnership(projectRecord,scriptRecord,storyboardRecord);
  return buildAuditInput({projectRecord,scriptRecord,storyboardRecord,brief:await briefStore.get(projectKey(projectRecord),scriptRecord.fields.video_id)});
}
export async function auditState(store,context,input){
  let audit=await store.latest(context.projectRecord.id,context.scriptRecord.id);
  if(audit){
    const {workflowId,fingerprint,...value}=audit;
    audit={...value,stale:audit.fingerprint!==auditFingerprint(input)};
  }else if(await store.enrollment(context.projectRecord.id,context.scriptRecord.id))audit={id:null,status:'PENDING',stale:false};
  const checks=input.deterministic_checks.every(x=>x.passed);
  const ready=checks&&audit?.status==='COMPLETE'&&!audit.stale&&audit.verdict==='PASS';
  return {audit:audit||null,readiness:{ready:!!ready,status:!checks?'BLOCKED':!audit?'UNAUDITED':audit.stale?'STALE':ready?'READY':audit.status==='COMPLETE'?audit.verdict:audit.status}};
}
export async function pendingAuditIntent({auditStore,...context}){
  const input=await auditInput(context),p=context.projectRecord,s=context.scriptRecord;
  const enrollment=await auditStore.enroll({projectId:p.id,projectKey:projectKey(p),scriptId:s.id,videoId:s.fields.video_id,source:'GENERATION'});
  return auditStore.pending({enrollment,input});
}
async function activity(context,job,type,result,error){
  const payload={id:job.id,projectId:job.projectId,type,source:'PRODUCTION',status:error?'FAILED':'COMPLETED',requestedCount:1,processedCount:1,successfulCount:error?0:1,failedCount:error?1:0,createdAt:job.createdAt,completedAt:new Date().toISOString(),items:[{...result,status:error?'FAILED':'SUCCEEDED',...(error?{error:'Production step failed; retry the saved input.'}:{})}]};
  try{await context.db.query('INSERT INTO app_runs(id,project_id,source,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET payload=$4',[job.id,job.projectId,'PRODUCTION',payload]);}
  catch{logger.warn('Production result saved; activity metadata could not be recorded');}
}
export async function executeCreation(context,id,actor){
  const {productionStore:store,withSlot,withLock,clients}=context;
  try{return await withSlot(()=>withLock('creation:'+id,async()=>{
    const job=await store.claim('app_creation_jobs',id,actor);if(!job)return {};
    try{
      const c=clients('creation:'+id+':attempt:'+(job.providerAttempt??job.attempt)),project=await c.airtable.getProject(job.projectId);
      assertProjectActive(project);
      if(projectKey(project)!==job.payload.projectKey)throw Error('Owning project identity changed');
      logger.mem('creation:start');let result;
      if(job.type==='ANALYZE'){
        const analysis=await referenceAnalysisAgent(c.gemini,job.payload.source);
        const {data,text,...metadata}=job.payload.source;
        let b;
        try{b=await store.saveBlueprint(job.projectId,analysis.blueprint,{analysis:analysis.observations,source:{...metadata,hash:hash(job.payload.source),jobId:id}});}
        catch(error){if(error.code==='DEFERRED')throw error;throw Object.assign(Error('Reference persistence failed'),{code:'REFERENCE_PERSIST_FAILED',cause:error});}
        result={blueprintId:b.id};
      }else{
        const input=job.payload.entry;
        const saved=await processIdeaScript({idea:{id:'entry_'+id},concept:{title:input.title,topic:input.content,evidence:{factual_sources:input.factual_sources||[]}},form:job.payload.form,projectKey:job.payload.projectKey,...c,withLock,creation:job.payload.snapshot});
        result={scriptId:saved.script.id,videoId:saved.script.fields.video_id};
      }
      await store.finish('app_creation_jobs',id,actor,{result});await activity(context,job,job.type==='ANALYZE'?'REFERENCE_ANALYSIS':'DIRECT_SCRIPT',result);
      logger.mem('creation:end');return {};
    }catch(error){
      if(error.code==='DEFERRED')throw error;
      await store.finish('app_creation_jobs',id,actor,{error});await activity(context,job,job.type==='ANALYZE'?'REFERENCE_ANALYSIS':'DIRECT_SCRIPT',{},error);return {};
    }
  }));}catch(error){if(error.code==='DEFERRED')return {deferredUntil:error.retryAt};throw error;}
}
export async function executeAudit(context,id,actor){
  const {auditStore:store,clients,withSlot,withLock}=context;
  try{return await withSlot(()=>withLock('audit:'+id,async()=>{
    const job=await store.claim('app_audits',id,actor);if(!job)return {};
    try{
      const c=clients('audit:'+id),projectRecord=await c.airtable.getProject(job.projectId),scriptRecord=await c.airtable.getScript(job.scriptId);
      assertProjectActive(projectRecord);
      if(projectKey(projectRecord)!==job.projectKey||scriptRecord.fields.video_id!==job.videoId)throw Error('Audit source identity changed');
      const storyboardRecord=await c.airtable.findStoryboardById(job.videoId);
      const input=await auditInput({projectRecord,scriptRecord,storyboardRecord,briefStore:c.briefStore});
      if(auditFingerprint(input)!==job.fingerprint){
        await pendingAuditIntent({auditStore:store,projectRecord,scriptRecord,storyboardRecord,briefStore:c.briefStore});
        await store.change('app_audits',id,value=>{if(value.workflowId!==actor)throw Error('Audit claim lost');value.status='STALE';});return {};
      }
      if(input.deterministic_checks.some(x=>!x.passed))throw Object.assign(Error('Source fidelity failed'),{code:'AUDIT_SOURCE_INVALID'});
      logger.mem('audit:start');const report=await storyboardAuditAgent(c.gemini,input);
      await store.finish('app_audits',id,actor,{report});await activity(context,job,'STORYBOARD_AUDIT',{scriptId:job.scriptId,auditId:id,verdict:report.verdict});
      logger.mem('audit:end');return {};
    }catch(error){if(error.code==='DEFERRED')throw error;await store.finish('app_audits',id,actor,{error});await activity(context,job,'STORYBOARD_AUDIT',{scriptId:job.scriptId,auditId:id},error);return {};}
  }));}catch(error){if(error.code==='DEFERRED')return {deferredUntil:error.retryAt};throw error;}
}
export async function recoverAuditLifecycles(context){
  for(const enrollment of await context.auditStore.enrollments()){
    try{await context.withLock('storyboard:'+enrollment.videoId,async()=>{
      const c=context.clients('audit-recovery:'+enrollment.id),projectRecord=await c.airtable.getProject(enrollment.projectId),scriptRecord=await c.airtable.getScript(enrollment.scriptId);
      if(scriptRecord.fields.video_id!==enrollment.videoId||projectKey(projectRecord)!==enrollment.projectKey)return;
      assertProjectActive(projectRecord);
      const storyboardRecord=await c.airtable.findStoryboardById(enrollment.videoId);
      if(!storyboardRecord)return;
      const input=await auditInput({projectRecord,scriptRecord,storyboardRecord,briefStore:c.briefStore});
      if(input.deterministic_checks.some(x=>!x.passed))return;
      await pendingAuditIntent({auditStore:context.auditStore,projectRecord,scriptRecord,storyboardRecord,briefStore:c.briefStore});
      if(scriptRecord.fields.status==='Approved')await c.airtable.updateScript(scriptRecord.id,{status:'Story Generated'});
      await context.auditStore.completeGeneration(projectRecord.id,scriptRecord.id);
    });}catch(error){logger.warn('Audit lifecycle recovery deferred',error.code||'SOURCE_UNAVAILABLE');}
  }
}


export async function reconcileProduction(context,dispatch,inspect){
  await recoverAuditLifecycles(context);
  for(const [kind,store,table] of [['CREATION',context.productionStore,'app_creation_jobs'],['AUDIT',context.auditStore,'app_audits']]){
    for(const job of await store.queued(table)){
      if(job.workflowId){
        const execution=inspect(job.workflowId);
        if(await execution.exists&&!['failed','cancelled','completed'].includes(await execution.status))continue;
        await store.resetOwner(table,job.id,job.workflowId);
      }
      try{await dispatch(kind,job.id);}catch{logger.warn('Production dispatch retained for reconciliation');}
    }
  }
}
