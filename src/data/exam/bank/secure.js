// Original scenarios; helpers expand closed metadata without generating stems.
const topics = { vault:['vault','secret-lifecycle'], config:['appconfig','configuration-refresh'], otel:['otel','trace-context'], kql:['kql','failure-query'] }
function item(n,topic,kind,stem,candidates,parts,{groupId=null,artifacts=[],refs=[],count=null,presentation=null,family=null}={}) {
  const id = 'ai200-s'+String(n).padStart(3,'0'), [objective,concept] = topics[topic]
  const catalog = candidates.map(([id,label])=>({id,label})), set = ['multiple-response','hot-area'].includes(kind)
  const components = parts.map(([id,,expected,,,subset])=>({id,conceptId:'secure.'+concept,points:1,input:set?'set':'one',requiredCount:set?count:null,candidateIds:subset||catalog.map(c=>c.id),expected}))
  const bindings = parts.map(([componentId,label])=>({componentId,label}))
  if (!presentation) {
    if (['single-choice','multiple-response'].includes(kind)) presentation={choices:catalog}
    else if (kind==='build-list') presentation={candidates:catalog,slots:bindings}
    else if (kind==='matching') presentation={candidates:catalog,targets:bindings,allowReuse:false}
    else if (kind==='dropdown') presentation={candidates:catalog,segments:bindings.map(b=>({type:'slot',...b}))}
    else if (kind==='statement-grid') presentation={choices:catalog,rows:bindings}
    else if (kind==='active-screen') presentation={title:'Python configuration worksheet',candidates:catalog,fields:bindings}
  }
  return {id,revision:1,familyId:family||id,kind,domain:'secure',objectiveId:'secure.'+objective,difficulty:'medium',stem,artifacts,presentation,components,groupId,
    explanation:{components:parts.map(([componentId,,,text,checks],i)=>({componentId,text,candidates:components[i].candidateIds.map(candidateId=>({candidateId,text:checks?checks[candidateId]:candidates.find(c=>c[0]===candidateId)[2]}))}))},
    referenceIds:['ref-secure.'+objective,...refs],csharp:null}
}
const yn=[['yes','Yes'],['no','No']]
const code=(text,language='python')=>[{id:'sample',kind:'code',language,text}]
const region=(id,label,x)=>({id,label,x,y:0.15,width:0.22,height:0.3})

export const SECURE_GROUPS=[
  {id:'series-s1',kind:'series',domain:'secure',title:'Authorize the billing secret reader',
    background:'A billing worker has an enabled managed identity and network access to an Azure Key Vault that uses Azure RBAC authorization. Authentication already succeeds. Its only required vault operation is reading the value of an existing secret with SecretClient.get_secret. It needs no write, delete, cryptographic-key or role-assignment operations. There are no other effective assignments or access policies for this identity. Evaluate each proposed vault-scoped role assignment independently; the goal is to permit that secret-value read.',
    questionIds:['ai200-s001','ai200-s002','ai200-s003']},
  {id:'case-s1',kind:'case',domain:'secure',title:'Lighthouse environment settings',
    background:'Lighthouse uses the current synchronous azure-appconfiguration-provider package. The same store contains key Lighthouse:Limit with no label and value 10, label production and value 30, and label development and value 5. No key trimming or mapper is configured. The deployed process must load only production-labelled Lighthouse:* settings. Authentication and App Configuration Data Reader authorization work. Later, an operator changes the production value to 40. The existing provider must observe that update through application activity after its configured refresh interval, without restarting or replacing the provider. No feature flags or snapshots are involved.',
    questionIds:['ai200-s004','ai200-s019','ai200-s027']},
  {id:'case-s2',kind:'case',domain:'secure',title:'Cedar request trace and log policy',
    background:'Cedar receives HTTP headers in a normalized lowercase string dictionary named headers, including a valid traceparent from its upstream service. Manual tracing is used, with a configured Python OpenTelemetry SDK tracer named tracer; automatic HTTP instrumentation is disabled. The handler must create a current child span of the incoming trace while doing its work. Its log policy permits only operation name and response status from the fields offered here. Passwords, bearer tokens and raw request bodies containing customer contact details must be excluded before telemetry leaves the process.',
    questionIds:['ai200-s009','ai200-s024','ai200-s029']},
]
export const SECURE_QUESTIONS=[
  item(1,'vault','single-choice','Proposed solution: assign Key Vault Contributor to the worker identity at the vault. Does this meet the series secret-read goal?',yn,
    [['goal','Meets the goal','no','The role manages the vault resource rather than secret values.',{yes:'Control-plane management does not grant this data-plane read.',no:'Secret-value authorization is still missing.'}]],{groupId:'series-s1'}),
  item(2,'vault','single-choice','Proposed solution: assign Key Vault Secrets User to the worker identity at the vault. Does this meet the series secret-read goal?',yn,
    [['goal','Meets the goal','yes','This role grants secret-content reading.',{yes:'The operation falls within Secrets User permissions.',no:'Authentication and networking work; this grants the missing read.'}]],{groupId:'series-s1',family:'ai200-s001'}),
  item(3,'vault','single-choice','Proposed solution: assign Key Vault Reader to the worker identity at the vault. Does this meet the series secret-read goal?',yn,
    [['goal','Meets the goal','no','Metadata access excludes secret contents.',{yes:'Reader cannot supply the needed sensitive value.',no:'Value reading exceeds this role.'}]],{groupId:'series-s1',family:'ai200-s001'}),
  item(4,'config','single-choice','Which selector should Lighthouse supply in selects to load exactly its deployed settings?',[
    ['production','SettingSelector(key_filter="Lighthouse:*", label_filter="production")','This selects the required prefix and label.'],
    ['development','SettingSelector(key_filter="Lighthouse:*", label_filter="development")','This selects the developer environment.'],
    ['all','SettingSelector(key_filter="Lighthouse:*", label_filter="*")','This admits other labels, violating only-production.']],
    [['pick','Selector','production','Select the environment explicitly.']],{groupId:'case-s1',refs:['secure-provider']}),
  item(5,'otel','single-choice','A Python tracer is configured. A synchronous function must create a span, make it current while its body executes, and end it when the with block exits. Which API fits?',[
    ['current','with tracer.start_as_current_span("quote"):','This context manager supplies the required scope.'],
    ['detached','span = tracer.start_span("quote")','This does not make the span current or give this block-scoped lifetime.'],
    ['lookup','span = trace.get_current_span()','This retrieves a span rather than creating one.']],
    [['pick','Span API','current','Use the current-span context manager.']],{refs:['secure-instrumentation','secure-otel-api']}),
  item(6,'kql','single-choice','In a Log Analytics workspace, AppRequests.Success is populated for every row. Return only unsuccessful requests from the last hour. Which KQL filter fits?',[
    ['failures','| where TimeGenerated >= ago(1h) and Success == false','Both required predicates match.'],
    ['success','| where TimeGenerated >= ago(1h) and Success == true','This keeps successes.'],
    ['old','| where TimeGenerated < ago(1h) and Success == false','This keeps older failures.']],
    [['pick','Filter','failures','Combine the time window and failure flag.']],{refs:['secure-apprequests','secure-ago']}),
  item(7,'vault','multiple-response','A synchronous Python SecretClient named client is authenticated and authorized. Select two steps that retrieve the latest stored InvoiceApiToken and obtain its string value.',[
    ['get','secret = client.get_secret("InvoiceApiToken")','Omitting the version requests latest.'],
    ['value','token = secret.value','This accesses the returned secret contents.'],
    ['list','token = client.list_properties_of_secrets()','Listing returns metadata without values.'],
    ['set','client.set_secret("InvoiceApiToken", "replacement")','This writes instead of retrieving.']],
    [['pick','Read steps',['get','value'],'Retrieve and extract the value.']],{count:2,refs:['secure-secretclient','secure-secrets-quickstart']}),
  item(8,'vault','multiple-response','InvoiceApiToken exists. A rotator has secrets/set permission and a valid replacement credential from the backing service. Select two correct Python SecretClient statements.',[
    ['set','client.set_secret("InvoiceApiToken", replacement) creates a new version','An existing name results in a new version.'],
    ['latest','A subsequent client.get_secret("InvoiceApiToken") requests the latest version','No version argument requests latest.'],
    ['properties','client.update_secret_properties("InvoiceApiToken", enabled=True) changes its secret value','Property updates cannot replace the value.'],
    ['pinned','client.get_secret("InvoiceApiToken", version=old_version) automatically selects the new version','An explicit version pins the requested read.']],
    [['pick','Version behavior',['set','latest'],'Distinguish replacement writes from pinned reads.']],{count:2,family:'ai200-s007',refs:['secure-secretclient']}),
  item(9,'otel','multiple-response','For Cedar, select the two fields permitted in outgoing telemetry logs under the stated policy.',[
    ['operation','operation name: checkout','This is an allowed field.'],
    ['status','response status: 202','This is the other allowed field.'],
    ['token','Authorization: Bearer <customer token>','This exposes credentials.'],
    ['body','raw JSON body with customer email and address','This violates the contact-data exclusion.']],
    [['pick','Allowed log fields',['operation','status'],'Apply the explicit allowlist before export.']],{count:2,groupId:'case-s2',refs:['secure-sensitive']}),
  item(10,'config','multiple-response','An application retains its synchronous App Configuration provider. Select two actions required for activity-driven ordinary key-value refresh with default monitoring and no refresh_on override.',[
    ['enabled','Pass refresh_enabled=True when loading the provider','This enables configuration refresh.'],
    ['refresh','Call config.refresh() during application activity','Activity triggers an eligible check.'],
    ['idle','Expect load() to start background polling without refresh calls','Refresh is activity-driven.'],
    ['immediate','Expect every refresh() before the interval expires to fetch remotely','Calls before the interval are no-ops.']],
    [['pick','Refresh actions',['enabled','refresh'],'Enable and trigger provider refresh.']],{count:2,family:'ai200-s004',refs:['secure-provider','secure-dynamic']}),
  item(11,'kql','multiple-response','An AppRequests query has selected the last hour. Success is never null; sampling is disabled. Select two aggregates for recorded-request totals and failure counts per AppRoleName in one summarize.',[
    ['total','Total = count()','This counts all input rows.'],
    ['failed','Failed = countif(Success == false)','This counts only failure predicates.'],
    ['always','Failed = count()','This includes successes.'],
    ['average','Total = avg(DurationMs)','This computes latency rather than count.']],
    [['pick','Aggregates',['total','failed'],'Use unconditional and conditional counts.']],{count:2,family:'ai200-s006',refs:['secure-summarize','secure-countif','secure-count','secure-avg','secure-apprequests']}),
  item(12,'vault','build-list','Order the dependent Python steps to retrieve InvoiceApiToken. vault_uri and credential exist; the identity has read permission. Choose three steps without altering the token.',[
    ['client','client = SecretClient(vault_url=vault_uri, credential=credential)'],
    ['get','secret = client.get_secret("InvoiceApiToken")'],['value','token = secret.value'],
    ['write','client.set_secret("InvoiceApiToken", "debug")']],
    [['first','First','client','Construct the required client.',{client:'This creates the object needed next.',get:'The client is not constructed yet.',value:'No secret has been retrieved.',write:'Writing changes the stored credential.'}],
      ['second','Second','get','Retrieve before accessing the value.',{client:'The client already exists.',get:'This assigns the required secret object.',value:'The secret variable is not yet assigned.',write:'A write violates the read-only requirement.'}],
      ['third','Third','value','Extract the returned contents.',{client:'Reconstruction does not extract the token.',get:'The retrieval has already completed.',value:'This supplies the credential string.',write:'Changing the token is outside this operation.'}]],
    {family:'ai200-s007',refs:['secure-secretclient','secure-secrets-quickstart'],artifacts:code('from azure.keyvault.secrets import SecretClient\n# vault_uri and credential are supplied\n# Complete the three ordered steps.')}),
  item(13,'vault','build-list','A storage consumer uses key1, stored as latest secret StorageKey. The alternate key2 is unused by all consumers. Order a dual-key rotation handoff: regenerate key2, publish it as a new secret version, then make this consumer use it. Authorization is in place. Do not revoke active key1 before handoff.',[
    ['regenerate','Regenerate unused key2 at the storage account'],
    ['store','Write regenerated key2 as the new StorageKey secret version'],
    ['consume','Make the consumer re-read latest and use key2'],
    ['revoke','Regenerate active key1 before the consumer changes']],
    [['first','First','regenerate','Generate at the credential authority.',{regenerate:'This changes the unused credential without revoking key1.',store:'The replacement value is not generated yet.',consume:'Latest still contains key1.',revoke:'This invalidates the key still in use.'}],
      ['second','Second','store','Publish the replacement.',{regenerate:'The new key2 already exists.',store:'This conveys the regenerated value to consumers.',consume:'Reading before publication cannot obtain the replacement.',revoke:'Key1 remains in use before handoff.'}],
      ['third','Third','consume','Complete consumer handoff.',{regenerate:'Regeneration alone leaves the consumer unchanged.',store:'The replacement is already published.',consume:'The running consumer must obtain and use the new value.',revoke:'Revocation before the consumer changes is premature.'}]],
    {refs:['secure-rotation','secure-secretclient']}),
  item(14,'kql','build-list','Order a KQL pipeline to count last-hour failed AppRequests per role and show the largest count first, retaining both role and count in output. Success is populated; Count exists only after aggregation. Choose three stages after AppRequests.',[
    ['filter','| where TimeGenerated >= ago(1h) and Success == false'],
    ['summarize','| summarize Count = count() by AppRoleName'],
    ['sort','| order by Count desc'],['project','| project AppRoleName']],
    [['first','First','filter','Restrict rows before counting.',{filter:'This defines the required input subset.',summarize:'Counting now includes unwanted rows.',sort:'Count does not exist.',project:'This removes TimeGenerated and Success before their required filtering.'}],
      ['second','Second','summarize','Compute the grouped count.',{filter:'The subset is already selected.',summarize:'This creates Count for each role.',sort:'The Count column is not created yet.',project:'This does not create the needed grouped count.'}],
      ['third','Third','sort','Order the aggregates.',{filter:'TimeGenerated and Success are absent from these aggregate rows.',summarize:'Re-counting groups is not counting requests.',sort:'Descending counts place the largest first.',project:'This removes Count and does not sort the required results.'}]],
    {family:'ai200-s006',refs:['secure-summarize','secure-sort','secure-project','secure-apprequests','secure-count','secure-ago']}),
  item(15,'vault','matching','Match each requirement to the narrow appropriate role among those offered for an RBAC vault. No role-assignment operations are needed.',[
    ['user','Key Vault Secrets User'],['reader','Key Vault Reader'],['officer','Key Vault Secrets Officer'],['contributor','Key Vault Contributor']],
    [['read','Read secret contents without managing secrets','user','Select content reading.',{user:'User grants content reads.',reader:'Reader excludes values.',officer:'Officer permits broader secret management.',contributor:'Control-plane management does not grant these reads.'}],
      ['metadata','Read object metadata without sensitive values','reader','Select metadata-only access.',{user:'User also reads contents.',reader:'Reader includes metadata and excludes sensitive values.',officer:'Officer also manages secrets.',contributor:'Contributor manages the vault resource instead of the required object metadata.'}],
      ['manage','Create and manage secrets without managing permissions','officer','Select secret management.',{user:'User does not manage secrets.',reader:'Reader cannot create secrets.',officer:'Officer manages secrets except permissions.',contributor:'Contributor does not grant these data operations.'}]],
    {family:'ai200-s001'}),
  item(16,'config','matching','A store holds Payments:Limit with no label, production and development. Match each desired environment to its exact label selector. Targets are independent; do not select all labels.',[
    ['unlabelled','label_filter="\\0"'],['production','label_filter="production"'],['development','label_filter="development"'],['all','label_filter="*"']],
    [['base','Only the no-label baseline','unlabelled','Select no label.',{unlabelled:'The null-label escape isolates the baseline.',production:'This selects production.',development:'This selects development.',all:'The wildcard selects every label.'}],
      ['live','Only production overrides','production','Select production.',{unlabelled:'The baseline is unlabelled.',production:'This isolates production.',development:'This is a different environment.',all:'This is not production-only.'}],
      ['dev','Only development overrides','development','Select development.',{unlabelled:'This excludes development.',production:'This selects production instead.',development:'This isolates development.',all:'This admits other environments.'}]],
    {family:'ai200-s004',refs:['secure-provider']}),
  item(17,'otel','matching','Match each manual Python OpenTelemetry action to its API. The SDK tracer and propagator exist; Context is imported. Choose an API rather than a fabricated trace identifier.',[
    ['extract','TraceContextTextMapPropagator().extract(carrier=headers)'],
    ['inject','TraceContextTextMapPropagator().inject(carrier=outgoing_headers)'],
    ['current','trace.get_current_span()'],['new','tracer.start_span("independent", context=Context())']],
    [['receive','Decode incoming W3C trace headers into context','extract','Extract on receipt.',{extract:'This decodes the incoming carrier.',inject:'This writes outgoing context.',current:'Lookup only returns the local span.',new:'An empty context does not decode headers.'}],
      ['send','Write current trace context into outgoing headers','inject','Inject before sending.',{extract:'Reading a carrier does not write it.',inject:'This serializes current context.',current:'Lookup does not write headers.',new:'A new span does not serialize a carrier.'}],
      ['lookup','Get the span current in this execution context','current','Look up the current span.',{extract:'This returns decoded context.',inject:'This writes headers.',current:'This returns the current span.',new:'This creates a different span.'}]],
    {refs:['secure-instrumentation','secure-otel-api','secure-otel-propagator']}),
  item(18,'kql','matching','Match each KQL pipeline operation to its workspace telemetry purpose.',[
    ['where','where'],['summarize','summarize'],['project','project'],['sort','sort']],
    [['filter','Keep rows whose Success is false','where','Apply a row predicate.',{where:'This filters records.',summarize:'Aggregation reduces or groups rows.',project:'Column selection does not filter failures.',sort:'Ordering does not change membership.'}],
      ['aggregate','Count records for each AppRoleName','summarize','Group and count.',{where:'A predicate does not count.',summarize:'summarize count() by AppRoleName creates counts.',project:'Column selection does not aggregate.',sort:'Ordering does not count records.'}],
      ['columns','Retain only TimeGenerated and OperationId columns','project','Select output columns.',{where:'Filtering preserves columns.',summarize:'Aggregation changes row granularity.',project:'This selects the named columns.',sort:'Ordering preserves the columns.'}]],
    {family:'ai200-s006',refs:['secure-summarize','secure-project','secure-sort','secure-apprequests']}),
  item(19,'config','dropdown','Complete Lighthouse: select the label in SettingSelector(key_filter="Lighthouse:*", label_filter=<label>), then invoke the existing config during activity. refresh_enabled=True is set and the interval has elapsed.',[
    ['production','"production"'],['development','"development"'],['refresh','config.refresh()'],['lookup','config["Lighthouse:Limit"]']],
    [['label','Label value','production','Choose the deployed environment.',{production:'This matches the required label.',development:'This chooses the wrong environment.'},['production','development']],
      ['activity','Activity call','refresh','Trigger the configured check.',{refresh:'This checks for updates after the interval.',lookup:'A cached lookup alone does not check the store.'},['refresh','lookup']]],
    {groupId:'case-s1',family:'ai200-s004',refs:['secure-provider','secure-dynamic']}),
  item(20,'vault','dropdown','Complete the synchronous Python read using a ready SecretClient named client. Request latest InvoiceApiToken, then extract its credential string.',[
    ['get','client.get_secret("InvoiceApiToken")'],['list','client.list_properties_of_secrets()'],['value','secret.value'],['name','secret.name']],
    [['read','secret =','get','Retrieve the value-bearing object.',{get:'This retrieves the latest KeyVaultSecret.',list:'This lists metadata without contents.'},['get','list']],
      ['token','token =','value','Extract contents.',{value:'This is the credential string.',name:'This identifies the secret, not its contents.'},['value','name']]],
    {family:'ai200-s007',refs:['secure-secretclient','secure-secrets-quickstart','secure-secret-value']}),
  item(21,'otel','dropdown','Complete manual Python W3C propagation. headers contains valid normalized trace headers and tracer is configured. Automatic tracing is disabled; work must run in a current child span of the received context.',[
    ['extract','TraceContextTextMapPropagator().extract(carrier=headers)'],['empty','Context()'],['context','context=parent_context'],['root','context=Context()']],
    [['receive','parent_context =','extract','Decode the upstream context.',{extract:'This reads the supplied carrier.',empty:'This discards the upstream context.'},['extract','empty']],
      ['span','Current-span argument','context','Use the decoded parent.',{context:'The current span inherits the incoming parent.',root:'An empty context creates an unrelated root.'},['context','root']]],
    {family:'ai200-s017',refs:['secure-instrumentation','secure-otel-api'],artifacts:code('from opentelemetry.context import Context\nfrom opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator\nparent_context = <receive>\nwith tracer.start_as_current_span("worker", <span>):\n    process()')}),
  item(22,'kql','dropdown','Complete a workspace query counting recorded failed requests per five-minute bucket. Every Success is populated and sampling is disabled.',[
    ['countif','countif(Success == false)'],['count','count()'],['bin','bin(TimeGenerated, 5m)'],['raw','TimeGenerated']],
    [['aggregate','Failed =','countif','Count only failures.',{countif:'Only true failure predicates count.',count:'This includes successful rows.'},['countif','count']],
      ['bucket','by','bin','Group by five-minute buckets.',{bin:'This rounds timestamps to the requested bucket.',raw:'Exact timestamps do not consolidate into these buckets.'},['bin','raw']]],
    {family:'ai200-s006',refs:['secure-countif','secure-bin','secure-summarize','secure-apprequests'],artifacts:code('AppRequests\n| summarize Failed = <aggregate> by <bucket>','kql')}),
  item(23,'vault','statement-grid','Evaluate synchronous Python SecretClient behavior for an existing secret. The caller has each operation permission.',yn,
    [['version','set_secret with the existing name and a replacement creates a new version.','yes','A value write versions the secret.',{yes:'This is existing-name behavior.',no:'The write does not overwrite a prior version in place.'}],
      ['value','update_secret_properties can change the secret value.','no','Properties and contents are distinct.',{yes:'This method cannot replace contents.',no:'Use set_secret for a new value.'}],
      ['listing','list_properties_of_secret_versions returns all version values.','no','Version listing excludes values.',{yes:'The result contains properties only.',no:'Use get_secret to obtain version contents.'}]],
    {family:'ai200-s007',refs:['secure-secretclient']}),
  item(24,'otel','statement-grid','Evaluate Cedar logging proposals against its outgoing-field policy.',yn,
    [['allow','Log only operation name and response status from the offered fields.','yes','These are permitted fields.',{yes:'This record satisfies the explicit allowlist.',no:'The policy permits this limited record.'}],
      ['raw','Export the bearer token, then hide it only in the dashboard.','no','Hiding occurs after export.',{yes:'The credential has already left the process.',no:'Exclude it before export under this policy.'}]],
    {groupId:'case-s2',family:'ai200-s009',refs:['secure-sensitive']}),
  item(25,'config','statement-grid','A current Python provider resolves an unversioned Key Vault reference. keyvault_credential is configured and authorized; secret_refresh_interval=120 is set. The reference URI has not changed, but the secret has rotated. Evaluate the statements.',yn,
    [['eligible','Calling config.refresh() after the secret interval elapses can fetch the new value even if App Configuration key-values did not change.','yes','Secret refresh has an independent interval.',{yes:'The unchanged reference does not block eligible secret refresh.',no:'Underlying secrets can refresh independently.'}],
      ['idle','secret_refresh_interval alone guarantees idle background refresh without config.refresh() calls.','no','The mechanism still needs refresh calls.',{yes:'The interval does not supply background polling.',no:'Application activity must trigger refresh.'}]],
    {refs:['secure-provider']}),
  item(26,'kql','statement-grid','Success is populated for every unsampled AppRequests row. Evaluate these KQL count queries.',yn,
    [['conditional','summarize Failed=countif(Success == false) by AppRoleName counts failed rows separately per role.','yes','The predicate applies within each group.',{yes:'Conditional counting and grouping supply the requirement.',no:'This is the required grouped count.'}],
      ['rows','summarize Total=count() without by preserves every original row and OperationId.','no','This reduces records to an aggregate.',{yes:'The original rows and identifiers are not preserved.',no:'This returns aggregate data rather than original records.'}]],
    {family:'ai200-s006',refs:['secure-countif','secure-summarize','secure-apprequests']}),
  item(27,'config','hot-area','Lighthouse has refresh_enabled=True. Select two boxes that choose its environment and trigger refresh on the existing provider during activity. The interval has elapsed.',[
    ['label','A: SettingSelector(key_filter="Lighthouse:*", label_filter="production")'],['refresh','B: config.refresh()'],
    ['dev','C: SettingSelector(key_filter="Lighthouse:*", label_filter="development")'],['read','D: config["Lighthouse:Limit"] only']],
    [['pick','Required boxes',['label','refresh'],'Choose production and trigger refresh.',{label:'This chooses the required labelled values.',refresh:'This checks eligible updates.',dev:'This selects the wrong environment.',read:'Cache lookup does not check the store.'}]],
    {groupId:'case-s1',family:'ai200-s004',count:2,refs:['secure-provider','secure-dynamic'],presentation:{label:'Lighthouse worksheet',regions:[region('label','A: production selector',0.01),region('refresh','B: refresh call',0.26),region('dev','C: development selector',0.51),region('read','D: cached lookup',0.76)]}}),
  item(28,'kql','hot-area','Select the stages responsible for filtering failures and computing counts in this workspace pipeline. Sampling is disabled.',[
    ['source','A: AppRequests'],['filter','B: | where Success == false'],['aggregate','C: | summarize Failed=count() by AppRoleName'],['sort','D: | order by Failed desc']],
    [['pick','Filter and aggregate',['filter','aggregate'],'Filter membership, then count.',{source:'This names the source table.',filter:'This retains failed rows.',aggregate:'This counts the retained rows per role.',sort:'This orders computed results.'}]],
    {family:'ai200-s006',count:2,refs:['secure-summarize','secure-sort','secure-apprequests'],presentation:{label:'KQL stages A to D',regions:[region('source','A: source',0.01),region('filter','B: filter',0.26),region('aggregate','C: aggregate',0.51),region('sort','D: sort',0.76)]}}),
  item(29,'otel','active-screen','Complete Cedar manual tracing: obtain parent_context and supply it to tracer.start_as_current_span("checkout", ...). Headers use lowercase keys with a valid upstream traceparent.',[
    ['extract','parent_context = TraceContextTextMapPropagator().extract(carrier=headers)'],['blank','parent_context = Context()'],
    ['parent','context=parent_context'],['fresh','context=Context()']],
    [['receive','Incoming context','extract','Decode the parent.',{extract:'This reads the upstream carrier.',blank:'An empty context discards the incoming trace.'},['extract','blank']],
      ['span','Current span parent','parent','Use the decoded context.',{parent:'The span becomes a child in the upstream trace.',fresh:'A fresh context breaks that parent relation.'},['parent','fresh']]],
    {groupId:'case-s2',family:'ai200-s017',refs:['secure-instrumentation','secure-otel-api'],artifacts:code('from opentelemetry.context import Context\nfrom opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator\n<receive>\nwith tracer.start_as_current_span("checkout", <span>):\n    process()')}),
  item(30,'config','active-screen','An identity-authenticated Python App Configuration load must resolve real Key Vault references using credentials, without custom clients or a resolver. Each supplied credential has its service permissions. Complete the store and vault credential arguments.',[
    ['store','credential=store_credential'],['store-wrong','key_filter=store_credential'],
    ['vault','keyvault_credential=vault_credential'],['resolver','secret_resolver=vault_credential']],
    [['store-auth','App Configuration authentication','store','Supply store authentication.',{store:'credential authenticates the store request.','store-wrong':'A key filter is not an authentication credential.'},['store','store-wrong']],
      ['vault-auth','Key Vault reference authentication','vault','Supply vault authentication.',{vault:'keyvault_credential authenticates referenced vault access.',resolver:'A resolver requires a callback rather than a credential object.'},['vault','resolver']]],
    {refs:['secure-provider'],artifacts:code('from azure.appconfiguration.provider import load\nconfig = load(endpoint=endpoint, <store-auth>, <vault-auth>)')}),
]
const learn=(id,title,path)=>({id,title,url:'https://learn.microsoft.com'+path,reviewedAt:'2026-10-06'})
const otel=(id,title,path)=>({id,title,url:'https://opentelemetry.io'+path,reviewedAt:'2026-10-06'})
export const SECURE_REFERENCES=[
  learn('ref-secure.vault','Key Vault RBAC permissions','/en-us/azure/key-vault/general/rbac-guide'),
  learn('ref-secure.appconfig','App Configuration key-value labels','/en-us/azure/azure-app-configuration/concept-key-value'),
  otel('ref-secure.otel','Python OpenTelemetry propagation','/docs/languages/python/propagation/'),
  learn('ref-secure.kql','KQL where operator','/en-us/kusto/query/where-operator?view=microsoft-fabric'),
  learn('secure-secretclient','Python SecretClient API','/en-us/python/api/azure-keyvault-secrets/azure.keyvault.secrets.secretclient?view=azure-python'),
  learn('secure-secrets-quickstart','Python Key Vault secret retrieval','/en-us/azure/key-vault/secrets/quick-create-python'),
  learn('secure-rotation','Dual-credential secret rotation','/en-us/azure/key-vault/secrets/tutorial-rotation-dual'),
  learn('secure-provider','Python App Configuration provider','/en-us/azure/azure-app-configuration/reference-python-provider'),
  learn('secure-dynamic','Dynamic configuration in Python','/en-us/azure/azure-app-configuration/enable-dynamic-configuration-python'),
  otel('secure-instrumentation','Python OpenTelemetry instrumentation','/docs/languages/python/instrumentation/'),
  otel('secure-sensitive','Handling sensitive telemetry data','/docs/security/handling-sensitive-data/'),
  learn('secure-apprequests','Workspace AppRequests columns','/en-us/azure/azure-monitor/reference/tables/apprequests'),
  learn('secure-summarize','KQL summarize operator','/en-us/kusto/query/summarize-operator?view=microsoft-fabric'),
  learn('secure-countif','KQL countif aggregation','/en-us/kusto/query/countif-aggregation-function?view=microsoft-fabric'),
  learn('secure-bin','KQL bin function','/en-us/kusto/query/bin-function?view=microsoft-fabric'),
  learn('secure-project','KQL project operator','/en-us/kusto/query/project-operator?view=microsoft-fabric'),
  learn('secure-sort','KQL sort operator','/en-us/kusto/query/sort-operator?view=microsoft-fabric'),
  learn('secure-count','KQL count aggregation','/en-us/kusto/query/count-aggregation-function?view=microsoft-fabric'),
  learn('secure-avg','KQL average aggregation','/en-us/kusto/query/avg-aggregation-function?view=microsoft-fabric'),
  learn('secure-ago','KQL ago function','/en-us/kusto/query/ago-function?view=microsoft-fabric'),
  learn('secure-secret-value','Python KeyVaultSecret attributes','/en-us/python/api/azure-keyvault-secrets/azure.keyvault.secrets.keyvaultsecret?view=azure-python'),
  {id:'secure-otel-api',title:'OpenTelemetry Python Tracer API',url:'https://github.com/open-telemetry/opentelemetry-python/blob/main/opentelemetry-api/src/opentelemetry/trace/__init__.py',reviewedAt:'2026-10-06'},
  {id:'secure-otel-propagator',title:'OpenTelemetry Python W3C propagator',url:'https://github.com/open-telemetry/opentelemetry-python/blob/main/opentelemetry-api/src/opentelemetry/trace/propagation/tracecontext.py',reviewedAt:'2026-10-06'},
]
