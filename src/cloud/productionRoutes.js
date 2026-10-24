import express from 'express';
import { z } from 'zod';
import { validateBody } from '../http/validation.js';
import { EntrySchema, ReferenceSchema, BlueprintSchema, hash } from '../creation/contract.js';
import { assertProjectActive, projectKey, belongsToProject } from '../utils/project.js';
import { formFromProject } from '../ideaGeneration.js';
import { publicJob } from './productionStore.js';
import { auditInput, auditState } from './productionWork.js';
const request=z.discriminatedUnion('type',[
  z.object({requestId:z.string().uuid(),type:z.literal('SCRIPT'),entry:EntrySchema}).strict(),
  z.object({requestId:z.string().uuid(),type:z.literal('ANALYZE'),source:ReferenceSchema}).strict(),
]);
const empty=z.object({}).strict();
const validId=id=>/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id||'');
export function mountProductionRoutes(app,{store,auditStore,briefStore,makeAirtable,dispatchCreation,dispatchAudit}){
  const protect=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const status=error.statusCode||error.status;res.status([400,404,409,413,503].includes(status)?status:503).json({error:status===404?'Record not found':error.statusCode?error.message:'Production request could not be completed'});}};
  const project=async(req,active=false)=>{const value=await makeAirtable().getProject(req.params.id);if(active)assertProjectActive(value);return value;};
  const ownedJob=async(req)=>{const job=validId(req.params.jobId)?await store.getJob(req.params.jobId):null;if(!job||job.projectId!==req.params.id)throw Object.assign(Error('Saved input not found'),{statusCode:404});return job;};
  app.get('/api/projects/:id/creation',protect(async(req,res)=>{
    const page=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().safeParse(req.query);
    if(!page.success)return res.status(400).json({error:'Invalid creation page'});
    res.json(await store.list(req.params.id,page.data));
  }));
  app.get('/api/projects/:id/creation-jobs/:jobId',protect(async(req,res)=>{const job=await ownedJob(req);res.json({job:publicJob(job),...(job.type==='SCRIPT'?{entry:job.payload.entry}:{})});}));
  app.post('/api/projects/:id/creation-jobs',express.json({limit:800000}),validateBody(request),protect(async(req,res)=>{
    const p=await project(req,true),input=req.validatedBody;
    const prior=await store.findRequest(req.params.id,input.requestId);
    const original=input.type==='SCRIPT'?{entry:input.entry}:{source:input.source};
    if(prior){if(prior.type!==input.type||prior.inputHash!==hash(original))return res.status(409).json({error:'Request ID already used for different input'});await dispatchCreation(prior);return res.status(202).json({job:publicJob(prior)});}
    let payload;
    if(input.type==='ANALYZE')payload={source:input.source,projectKey:projectKey(p)};
    else{
      const entry=input.entry,blueprint=entry.blueprintId?await store.blueprint(req.params.id,entry.blueprintId):null;
      if(entry.blueprintId&&blueprint?.status!=='APPROVED')return res.status(409).json({error:'Select an approved blueprint version'});
      if(entry.parentId){const parent=await store.getJob(entry.parentId);if(!parent||parent.projectId!==req.params.id)return res.status(404).json({error:'Original item not found'});}
      const settings=await briefStore.defaults(projectKey(p));
      payload={entry,projectKey:projectKey(p),form:formFromProject(p),snapshot:{entry,blueprint:blueprint?{id:blueprint.id,version:blueprint.version,content:blueprint.content,approval:blueprint.approval}:null,settings:{...settings,...(entry.structures?{structures:entry.structures}:entry.profile==='what-if'?{structures:['structure1']}:{})}}};
    }
    const job=await store.create(req.params.id,input.requestId,input.type,payload,original);
    await dispatchCreation(job);res.status(202).json({job:publicJob(job)});
  }));
  app.post('/api/projects/:id/creation-jobs/:jobId/retry',validateBody(empty),protect(async(req,res)=>{await project(req,true);const previous=await ownedJob(req);const job=await store.retry(req.params.id,previous.id);await dispatchCreation(job);res.status(202).json({job:publicJob(job)});}));
  app.post('/api/projects/:id/blueprints',validateBody(z.object({content:BlueprintSchema,parentId:z.string().uuid().nullable().default(null)}).strict()),protect(async(req,res)=>{await project(req,true);res.status(201).json({blueprint:await store.saveBlueprint(req.params.id,req.validatedBody.content,{parentId:req.validatedBody.parentId})});}));
  for(const action of ['approve','archive'])app.post('/api/projects/:id/blueprints/:blueprintId/'+action,validateBody(action==='approve'?z.object({reason:z.string().trim().min(10).max(2000)}).strict():empty),protect(async(req,res)=>{
    await project(req,true);
    if(!validId(req.params.blueprintId)||!await store.blueprint(req.params.id,req.params.blueprintId))return res.status(404).json({error:'Blueprint unavailable'});
    const blueprint=action==='approve'?await store.approve(req.params.id,req.params.blueprintId,req.user.id,req.validatedBody.reason):await store.archive(req.params.id,req.params.blueprintId);
    res.json({blueprint});
  }));
  const loadAudit=async(req)=>{
    const client=makeAirtable(),projectRecord=await project(req),scriptRecord=await client.getScript(req.params.scriptId);
    if(!belongsToProject(scriptRecord,projectRecord))throw Object.assign(Error('Script not found'),{statusCode:404});
    const storyboardRecord=await client.findStoryboardById(scriptRecord.fields.video_id);
    const context={projectRecord,scriptRecord,storyboardRecord,briefStore};
    return {context,input:await auditInput(context)};
  };
  app.get('/api/projects/:id/scripts/:scriptId/storyboard-audit',protect(async(req,res)=>{const {context,input}=await loadAudit(req);res.json(await auditState(auditStore,context,input));}));
  app.post('/api/projects/:id/scripts/:scriptId/storyboard-audit',validateBody(empty),protect(async(req,res)=>{
    const {context,input}=await loadAudit(req);assertProjectActive(context.projectRecord);
    const enrollment=await auditStore.enroll({projectId:req.params.id,projectKey:projectKey(context.projectRecord),scriptId:context.scriptRecord.id,videoId:context.scriptRecord.fields.video_id,source:'EXPLICIT'});
    const job=await auditStore.pending({enrollment,input,retry:true,manual:true});await dispatchAudit(job);
    res.status(202).json(await auditState(auditStore,context,input));
  }));
}
