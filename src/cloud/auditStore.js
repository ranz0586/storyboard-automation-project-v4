import { randomUUID } from 'node:crypto';
import { CloudProductionStore } from './productionStore.js';
const identity=(projectId,scriptId)=>JSON.stringify([projectId,scriptId]);
export const auditFingerprint=input=>JSON.stringify([input.package_hash,input.brief_hash,input.audit_version,input.rubric_version,input.evidence_scope]);
export const reviewableAudit=audit=>audit?.status==='COMPLETE'&&audit.verdict==='NEEDS_REVIEW'&&!!audit.report&&!audit.report.issues?.some(issue=>issue.severity==='blocking');
export class CloudAuditStore extends CloudProductionStore {
  async enrollment(projectId,scriptId){return (await this.query('SELECT payload FROM app_audit_enrollments WHERE id=$1',[identity(projectId,scriptId)])).rows[0]?.payload||null;}
  async enroll({projectId,projectKey,scriptId,videoId,source='EXPLICIT',beginGeneration=false}){
    if(![projectId,projectKey,scriptId,videoId].every(x=>typeof x==='string'&&x))throw Error('Audit needs owning project and video identities');
    const id=identity(projectId,scriptId);
    return this.transaction(async tx=>{
      const value={id,projectId,projectKey,scriptId,videoId,source,lifecycleCompleted:false,createdAt:new Date().toISOString()};
      await tx.query('INSERT INTO app_audit_enrollments(id,project_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,projectId,value]);
      const prior=(await tx.query('SELECT payload FROM app_audit_enrollments WHERE id=$1 FOR UPDATE',[id])).rows[0].payload;
      if(prior.videoId!==videoId||prior.projectKey!==projectKey)throw Error('Audit enrollment identity changed');
      if(beginGeneration){prior.source='GENERATION';prior.lifecycleCompleted=false;await tx.query('UPDATE app_audit_enrollments SET payload=$2 WHERE id=$1',[id,prior]);}
      return prior;
    });
  }
  completeGeneration(projectId,scriptId){return this.change('app_audit_enrollments',identity(projectId,scriptId),value=>{value.lifecycleCompleted=true;});}
  async enrollments(){return (await this.query("SELECT payload FROM app_audit_enrollments WHERE payload->>'source'='GENERATION' AND payload->>'lifecycleCompleted'='false' ORDER BY created_at LIMIT 50")).rows.map(r=>r.payload);}
  async get(id){if(!/^[\da-f-]{36}$/i.test(id||''))return null;return (await this.query('SELECT payload FROM app_audits WHERE id=$1',[id])).rows[0]?.payload||null;}
  async latest(projectId,scriptId){return (await this.query('SELECT payload FROM app_audits WHERE project_id=$1 AND script_id=$2 ORDER BY sequence DESC LIMIT 1',[projectId,scriptId])).rows[0]?.payload||null;}
  async acknowledge({projectId,scriptId,auditId,input,reviewerId,reason}){
    if(typeof reviewerId!=='string'||!reviewerId||typeof reason!=='string'||reason.trim().length<10||reason.trim().length>2000)throw Object.assign(Error('A reviewer and reason are required'),{statusCode:400});
    return this.transaction(async tx=>{
      await tx.query('SELECT id FROM app_audit_enrollments WHERE id=$1 FOR UPDATE',[identity(projectId,scriptId)]);
      const audit=(await tx.query('SELECT payload FROM app_audits WHERE project_id=$1 AND script_id=$2 ORDER BY sequence DESC LIMIT 1 FOR UPDATE',[projectId,scriptId])).rows[0]?.payload;
      if(audit?.id!==auditId||audit.fingerprint!==auditFingerprint(input)||!input.deterministic_checks.every(check=>check.passed)||!reviewableAudit(audit))throw Object.assign(Error('Refresh the current review; blocking or stale audits cannot be acknowledged'),{statusCode:409});
      if(audit.acknowledgement){
        if(audit.acknowledgement.reviewerId!==reviewerId||audit.acknowledgement.reason!==reason.trim())throw Object.assign(Error('The saved acknowledgement is immutable'),{statusCode:409});
        return audit;
      }
      audit.acknowledgement={reviewerId,reason:reason.trim(),auditId:audit.id,fingerprint:audit.fingerprint,createdAt:new Date().toISOString()};
      await tx.query('UPDATE app_audits SET payload=$2 WHERE id=$1',[audit.id,audit]);return audit;
    });
  }
  async pending({enrollment,input,retry=false,manual=false}){
    return this.transaction(async tx=>{
      await tx.query('SELECT id FROM app_audit_enrollments WHERE id=$1 FOR UPDATE',[enrollment.id]);
      const prior=(await tx.query('SELECT payload FROM app_audits WHERE project_id=$1 AND script_id=$2 ORDER BY sequence DESC LIMIT 1',[enrollment.projectId,enrollment.scriptId])).rows[0]?.payload;
      const fingerprint=auditFingerprint(input);
      if(prior?.fingerprint===fingerprint&&(!retry||['PENDING','RUNNING','COMPLETE'].includes(prior.status)))return prior;
      if(manual)await this.ensureCapacity(tx);
      const item={...enrollment,enrollmentId:enrollment.id,attempt:(prior?.attempt||0)+1,id:randomUUID(),fingerprint,packageHash:input.package_hash,briefHash:input.brief_hash,auditVersion:input.audit_version,rubricVersion:input.rubric_version,evidenceScope:input.evidence_scope,status:'PENDING',workflowId:null,report:null,verdict:null,acknowledgement:null,error:null,createdAt:new Date().toISOString()};
      await tx.query('INSERT INTO app_audits(id,project_id,script_id,payload) VALUES($1,$2,$3,$4)',[item.id,item.projectId,item.scriptId,item]);return item;
    });
  }
}
