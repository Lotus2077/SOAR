import { z } from "zod";
import type { ArtifactCheck } from "./runner";
import { canonical, digest } from "./contracts";

const path = z.string().max(240).refine(value => /^output\//u.test(value) && !/[\\\x00-\x1f\x7f]/u.test(value) && value.split("/").every(part => part && part !== "." && part !== ".."));
export const EvidenceContractSchema = z.object({
  version: z.literal(1), claimsPath: path, scriptPath: path.refine(value => value.endsWith(".py")), resultsPath: path,
  requirements: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u), statement: z.string().min(1).max(1000), kind: z.enum(["numeric", "factual"]) }).strict()).min(1).max(40),
}).strict().superRefine((value, context) => {
  if (new Set([value.claimsPath, value.scriptPath, value.resultsPath]).size !== 3 || new Set(value.requirements.map(row => row.id)).size !== value.requirements.length) {
    context.addIssue({ code: "custom", message: "Evidence paths and requirement IDs must be distinct." });
  }
});
export type EvidenceContract = z.infer<typeof EvidenceContractSchema>;
export const EVIDENCE_HELPER_PATH = "support/verify-evidence.py";

export function evidenceInstructions(contract: EvidenceContract): string {
  return `Additional evidence contract: ${canonical(contract)}
Derive material numerical claims from original input facts using a small calculation program. Produce the report and decision values from the executed results, including conditional scenarios. Do not copy a proposed answer into an assertion and call that verification.
Write ${contract.scriptPath} as a read-only program that emits one JSON object to stdout; run it to save ${contract.resultsPath}. Its schema is {"version":1,"comparisons":[{"id":"unique_id","expected":NUMBER_COMPUTED_FROM_SOURCES,"actual":NUMBER_IN_SUBMITTED_ARTIFACT,"unit":"unit","artifact":{"path":"output/your-data.json","pointer":"/path/to/number"},"operands":[{"value":SOURCE_NUMBER,"unit":"source unit","source":{"path":"input/source-file","quote":"exact source excerpt"}}]}]}. Use at least one comparison for each numeric requirement. Every declared comparison is checked, including those omitted from a summary. Expected and actual must be finite JSON numbers; equality is exact. Units and derivation choices still require independent review.
Write ${contract.claimsPath} as {"version":1,"claims":[{"id":"unique_id","requirementIds":["task requirement ID"],"status":"supported|contradicted|unverified","artifact":{"path":"output/artifact","quote":"exact claim excerpt"},"sources":[{"path":"input/source-file","quote":"exact supporting excerpt"}],"calculationIds":["comparison ID for numeric claims"]}]}. Cover every listed requirement, reference every comparison, and include relevant material claims beyond the main recommendation. A required contradiction or unknown is not a pass, even if the recommendation is unchanged. Exact excerpts prove presence only; do not treat them as semantic proof.
Keep these three evidence artifacts out of source citations and submitted-value pointers. The host resolves actual values from the frozen JSON artifacts, replays the program without its prior results file, requires identical fresh results and unchanged files, and ignores any model overall verdict or severity. The program must not read its prior results, write files, create subprocesses/threads, or start background work. Run python3 -I ${EVIDENCE_HELPER_PATH} to diagnose this necessary evidence check before finish. A passing check still awaits independent correctness/completeness acceptance.`;
}

/** Necessary evidence consistency/replay check, never an independent semantic judge. */
export function sourceEvidenceCheck(files: { path: string; bytes: Buffer }[], raw: EvidenceContract): ArtifactCheck {
  const contract = EvidenceContractSchema.parse(raw);
  const sources = files.filter(file => file.path.startsWith("input/")).map(file => ({ path: file.path, sha256: digest(file.bytes) }));
  const data = Buffer.from(canonical({ contract, sources })).toString("base64");
  return { id: "source_evidence_replayed_and_consistent", python: `import base64, hashlib, json, math, os, pathlib, re, resource, selectors, signal, subprocess, sys, time
from decimal import Decimal
p=json.loads(base64.b64decode('${data}')); c=p['contract']; root=pathlib.Path('/workspace')
class InvalidEvidence(Exception): pass
def need(value, code):
 if not value: raise InvalidEvidence(code)
def parse(raw):
 def pairs(rows):
  out={}
  for key,value in rows:
   need(key not in out,'duplicate_json_key');out[key]=value
  return out
 def bad(value): raise InvalidEvidence('nonfinite_number')
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad,parse_float=Decimal)
def file(name):
 need(isinstance(name,str) and 0<len(name)<=240 and not any(ord(ch)<32 or ord(ch) in (92,127) for ch in name),'invalid_path')
 parts=name.split('/');need(all(part and part not in ('.','..') for part in parts),'invalid_path')
 current=root
 for part in parts:
  current=current/part;need(not current.is_symlink(),'invalid_path')
 need(current.resolve().is_relative_to(root) and current.is_file() and current.stat().st_nlink==1,'invalid_file')
 need(current.stat().st_size<=67108864,'file_limit');return current
def inventory():
 rows={};total=0
 for item in root.rglob('*'):
  need(not item.is_symlink(),'workspace_mutation')
  if item.is_dir(): continue
  name=str(item.relative_to(root));blob=file(name).read_bytes();total+=len(blob)
  need(len(rows)<4096 and total<=134217728,'workspace_limit');rows[name]=hashlib.sha256(blob).hexdigest()
 return rows
def norm(value):
 need(isinstance(value,str) and 0<len(value)<=4096,'invalid_excerpt');value=' '.join(value.split());need(bool(value),'invalid_excerpt');return value
def numeric(value):
 need(type(value) in (int,Decimal),'invalid_number');value=Decimal(value);need(value.is_finite(),'invalid_number');return value
def identifier(value): need(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}',value),'invalid_id');return value
def excerpt(row, allowed):
 need(isinstance(row,dict) and row.get('path') in allowed,'invalid_reference')
 need(norm(row.get('quote')) in ' '.join(file(row['path']).read_text(encoding='utf-8').split()),'excerpt_not_found')
def pointer(value, location):
 need(isinstance(location,str) and (location=='' or location.startswith('/')) and len(location)<=1024,'invalid_pointer')
 if location=='': return value
 for part in location[1:].split('/'):
  need(not re.search(r'~(?![01])',part),'invalid_pointer');key=part.replace('~1','/').replace('~0','~')
  if isinstance(value,list):
   need(re.fullmatch(r'0|[1-9][0-9]*',key) is not None and int(key)<len(value),'invalid_pointer');value=value[int(key)]
  else: need(isinstance(value,dict) and key in value,'invalid_pointer');value=value[key]
 return value
def identity(value):
 if isinstance(value,dict): return ('object',tuple((key,identity(item)) for key,item in sorted(value.items())))
 if isinstance(value,list): return ('array',tuple(identity(item) for item in value))
 if type(value) in (int,Decimal): return ('number',numeric(value))
 return (type(value).__name__,value)
def replay_limits():
 # A read-only calculator has no subprocess/thread capability, including detached descendants.
 resource.setrlimit(resource.RLIMIT_NPROC,(0,0))
def replay(script):
 process=subprocess.Popen([sys.executable,'-I','-B',str(script)],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True,preexec_fn=replay_limits)
 selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ);blob=bytearray();deadline=time.monotonic()+20
 try:
  while True:
   need(time.monotonic()<deadline,'replay_timeout')
   if not selector.select(min(0.1,max(0,deadline-time.monotonic()))): continue
   chunk=os.read(process.stdout.fileno(),8192)
   if not chunk: break
   blob.extend(chunk);need(len(blob)<=524288,'replay_output_limit')
  need(process.wait(timeout=max(0.01,deadline-time.monotonic()))==0,'replay_failed');return bytes(blob)
 finally:
  selector.close()
  try: os.killpg(process.pid,signal.SIGKILL)
  except ProcessLookupError: pass
  process.wait(timeout=5);process.stdout.close()
def check():
 for row in p['sources']: need(hashlib.sha256(file(row['path']).read_bytes()).hexdigest()==row['sha256'],'source_changed')
 before=inventory();claim_bytes=file(c['claimsPath']).read_bytes();need(len(claim_bytes)<=524288,'claims_size_limit');claims=parse(claim_bytes);saved=file(c['resultsPath']).read_bytes()
 need(len(saved)<=524288,'replay_output_limit');results=parse(saved)
 allowed_sources={row['path'] for row in p['sources']};evidence_paths={c['claimsPath'],c['scriptPath'],c['resultsPath']}
 artifacts={name for name in before if name.startswith('output/') and name not in evidence_paths}
 need(isinstance(claims,dict) and type(claims.get('version')) is int and claims['version']==1 and isinstance(claims.get('claims'),list) and 0<len(claims['claims'])<=100,'claims_schema')
 need(isinstance(results,dict) and type(results.get('version')) is int and results['version']==1 and isinstance(results.get('comparisons'),list) and len(results['comparisons'])<=100,'results_schema')
 comparisons={}
 for row in results['comparisons']:
  ident=identifier(row['id']);need(ident not in comparisons,'duplicate_comparison');comparisons[ident]=row
  need(isinstance(row.get('unit'),str) and 0<len(row['unit'])<=100,'invalid_unit')
  target=row['artifact'];need(target['path'] in artifacts and target['path'].endswith('.json'),'invalid_artifact_pointer')
  actual=pointer(parse(file(target['path']).read_bytes()),target['pointer'])
  need(numeric(row['actual'])==numeric(actual),'reported_actual_mismatch')
  need(numeric(row['expected'])==numeric(actual),'comparison_mismatch')
  need(isinstance(row.get('operands'),list) and 0<len(row['operands'])<=100,'missing_source_operands')
  for operand in row['operands']:
   numeric(operand['value']);need(isinstance(operand.get('unit'),str) and 0<len(operand['unit'])<=100,'invalid_unit');excerpt(operand['source'],allowed_sources)
 requirements={row['id']:row['kind'] for row in c['requirements']};covered=set();referenced=set();claim_ids=set()
 for row in claims['claims']:
  ident=identifier(row['id']);need(ident not in claim_ids,'duplicate_claim');claim_ids.add(ident)
  ids=row['requirementIds'];need(isinstance(ids,list) and 0<len(ids)<=40 and all(item in requirements for item in ids) and len(set(ids))==len(ids),'requirement_reference')
  need(row.get('status')=='supported','required_claim_not_supported');covered.update(ids)
  excerpt(row['artifact'],artifacts);need(isinstance(row.get('sources'),list) and 0<len(row['sources'])<=100,'missing_sources')
  for source in row['sources']: excerpt(source,allowed_sources)
  refs=row['calculationIds'];need(isinstance(refs,list) and len(refs)<=100 and all(item in comparisons for item in refs) and len(set(refs))==len(refs),'calculation_reference')
  need(not any(requirements[item]=='numeric' for item in ids) or bool(refs),'numeric_evidence_missing');referenced.update(refs)
 need(covered==set(requirements),'critical_coverage_missing');need(referenced==set(comparisons),'unreferenced_comparison')
 result_path=file(c['resultsPath']);script=file(c['scriptPath']);result_path.unlink()
 try:
  fresh=replay(script);need(identity(parse(fresh))==identity(results),'replay_result_mismatch')
  need(inventory()=={key:value for key,value in before.items() if key!=c['resultsPath']},'workspace_mutation')
 finally:
  # Do not overwrite a path created or redirected by the untrusted program.
  need(not result_path.exists() and not result_path.is_symlink(),'workspace_mutation')
  parent=result_path.parent;need(parent.resolve().is_relative_to(root) and all(not part.is_symlink() for part in [parent,*parent.parents] if part.is_relative_to(root)),'workspace_mutation')
  with result_path.open('xb') as stream: stream.write(saved)
 need(inventory()==before,'workspace_mutation')
try:
 check();print(json.dumps({'passed':True,'semanticAcceptance':'independent_review_required'}))
except Exception as error:
 print(json.dumps({'passed':False,'code':str(error) if isinstance(error,InvalidEvidence) else 'evidence_invalid'}));sys.exit(1)
` };
}
