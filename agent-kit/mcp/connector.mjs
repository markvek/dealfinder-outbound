import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
const base=new URL(process.env.DEALFINDER_URL??'http://127.0.0.1:55210');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('DEALFINDER_URL must be a local HTTP(S) URL.');
const token=process.env.DEALFINDER_TOKEN;if(!token)throw new Error('Set DEALFINDER_TOKEN.');
async function request(command,input,key,version){const r=await fetch(new URL('/api/automation',base),{method:command?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(command?{'Content-Type':'application/json'}:{})},body:command?JSON.stringify({command,input,key,version}):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw new Error(data.error??`HTTP ${r.status}`);return command?data.result:data;}
const server=new McpServer({name:'dealfinder',version:'1.0.0'});
const respond=value=>({content:[{type:'text',text:JSON.stringify(value,null,2)}]});
function tool(name,description,inputSchema,callback){server.registerTool(name,{description,inputSchema},async input=>{try{return respond(await callback(input));}catch(e){return {content:[{type:'text',text:e.message}],isError:true};}});}
tool('workflow_guide','Read the workflow and agent execution contract.',{},async()=>({workflow:'Search → Companies → human Review Queue decision → Outreach → human email approval. No tool can approve, change decisions, or send email.',orchestration:'Read workspace and configured agents, save searches, queue dated searches or generation batches, inspect jobs. Use a stable idempotency key per submission. Version is workspace.version.',execution:'Executor keys are bound to specific external agent IDs. Register capabilities, claim a job, use ONLY its snapshot instructions, heartbeat every 30 seconds with its leaseToken, then complete or fail. Leases expire after 120 seconds. Never approve or send. Retry side effects safely using job.idempotencyKey.',results:{research:'{companies:[{name,domain,category,geography,employees,revenue:number|null,description,customers,criticality,concern,evidence:[{title,url,detail,publishedAt?}],qualificationNotes}],costUsd}',writer:'{subject,body,costUsd}',judge:'{recommendation:talking|reach-out|priority|pass|insufficient-evidence,rationale,concerns:string[],evidenceRefs:string[],uncertainty,costUsd}','draft-judge':'Same as judge; review the exact draft revision and approved memo. No new browsing.'},budgets:'Enforce snapshot.budgetUsd before incurring cost. Report actual costUsd. Stop or fail when the limit cannot be honored.'}));
tool('workspace_read','Read searches, companies, drafts, defaults, agents, jobs, and advisory findings.',{},()=>request());
const json=z.record(z.string(),z.unknown());
for(const [name,command,description] of [
 ['search_save','search.save','Create/update search. input={search:{id?,name,description,employees,revenue,metric,geography,categories,exclusions,sources,domains,ownership,companyType,dealSize,basePrompt?,researchAgentId?,judgeAgentId?,writerAgentId?}}. Workspace version required.'],
 ['search_archive','search.archive','Archive or restore a search. input={id}, workspace version required.'],
 ['search_run','run.start','Queue research. input={searchId,researchAgentId?,judgeAgentId?,writerAgentId?,instructions?,runAt?:ISO,window:{mode:all|range|rolling|since-success,from?:YYYY-MM-DD,to?:YYYY-MM-DD,days?},companyLimit?,budgetUsd?}.'],
 ['schedule_save','schedule.save','Save schedule. input={searchId,version?:scheduleVersion,enabled,frequency:once|daily|weekly|monthly|cron,cron,timezone,startAt:ISO,endAt?:ISO,config:run fields excluding searchId/runAt,nextOverride?:{instructions,...}|null}.'],
 ['schedule_preview','schedule.preview','Preview dates for the same input as schedule_save.'],
 ['outreach_generate','batch.start','Queue outreach. input={companyIds,role:writer,agentId?,judgeAgentId?,instructions?,budgetUsd?,regenerate?}. Human-approved companies only.'],
 ['company_review','batch.start','Queue advisory reviews. input={companyIds,role:judge,agentId?,instructions?,budgetUsd?}.'],
 ['draft_review','draft.judge','Queue advisory review. input={draftId,agentId?,instructions?}.'],
 ['job_cancel','job.cancel','Cancel queued/running job. input={id}.'],
 ['job_retry','job.retry','Retry failed job with unchanged inputs. input={id}.'],
 ['agent_register','worker.register','Register executor capabilities. input={agentId,capabilities:{roles:[research|judge|writer|draft-judge],webSearch:boolean,dateFiltering:boolean}}.'],
 ['agent_claim','worker.claim','Claim next due job. input={agentId}. Returns immutable snapshot and leaseToken or null.'],
 ['agent_heartbeat','worker.heartbeat','Renew lease. input={id,leaseToken,progress?}.'],
 ['agent_complete','worker.complete','Submit job result. input={id,leaseToken,result}. See workflow_guide result schemas.'],
 ['agent_fail','worker.fail','Report failure. input={id,leaseToken,error}.']
])tool(name,description,{input:json,key:z.string().default(''),version:z.number().int().optional()},({input,key,version})=>request(command,input,key,version));
await server.connect(new StdioServerTransport());
