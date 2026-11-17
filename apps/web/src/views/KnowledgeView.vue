<script setup lang="ts">
import {computed,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import {NButton,NInput,NSelect,NTag,useMessage} from "naive-ui";
import {useDemoStore} from "../demo/store";
import {can} from "../demo/permissions";
import {
  evaluateKnowledge,inspectKnowledgeCitations,readKnowledgeDrafts,reviewKnowledgeDraft,saveKnowledgeDraft,
  type KnowledgeDraft,type KnowledgeDocumentHit,
} from "../demo/knowledge";

const store=useDemoStore(),route=useRoute(),router=useRouter(),message=useMessage();
const getQ=(key:string)=>typeof route.query[key]==="string"?route.query[key] as string:"";
// 仅无设备参数时默认演示P-002；显式错误ID必须原样保留并显示缺数，绝不悄悄换设备。
const requestedAssetId=()=>getQ("assetId")||"asset-p002";
const assetId=ref(requestedAssetId());
const alarmId=ref(getQ("alarmId"));
const symptom=ref(getQ("symptom")|| (alarmId.value?
  store.alarms.find(x=>x.id===alarmId.value)?.title??"异常待核实":"振动异常"));
const includePending=ref(true);
const drafts=ref<KnowledgeDraft[]>(readKnowledgeDrafts(localStorage,store.scenarioId));
const selectedDraftId=ref("");
const reviewNote=ref("");
const documentIdForReview=ref("");
const documentVersion=ref("");
const documentSection=ref("");
const documentNote=ref("");
const isBusy=ref(false);
const assetOptions=computed(()=>store.assets.filter(x=>!x.archived).map(x=>({
  value:x.id,label:`${x.code} · ${x.name}`,
})));
const selectedAlarm=computed(()=>store.alarms.find(x=>x.id===alarmId.value&&x.assetId===assetId.value)??null);
const result=computed(()=>evaluateKnowledge({
  query:{assetId:assetId.value,symptom:symptom.value,alarmId:alarmId.value||undefined},
  assets:store.assets,documents:store.documents,
  removedDocumentIds:store.userState.removedDocumentIds,
  inspections:store.inspections,maintenance:store.maintenance,
  workorders:store.workorders,alarms:store.alarms,
  seedInspectionIds:store.seed.inspections.map(x=>x.id),
  seedMaintenanceIds:store.seed.maintenance.map(x=>x.id),
  seedWorkorderIds:store.seed.workorders.map(x=>x.id),
  seedAlarmIds:store.seed.alarms.map(x=>x.id),
}));
const canSave=computed(()=>can(store.role,"knowledge:save"));
const canReview=computed(()=>can(store.role,"knowledge:review"));
const canReviewDocuments=computed(()=>can(store.role,"document:review"));
const documentForReview=computed(()=>store.documents.find(x=>x.id===documentIdForReview.value)??null);
const draftSelected=computed(()=>drafts.value.find(x=>x.id===selectedDraftId.value)??null);
const draftCitationStatus=computed(()=>draftSelected.value
  ? inspectKnowledgeCitations(draftSelected.value,store.documents,store.userState.removedDocumentIds)
  : null);
const citationStatusOf=(draft:KnowledgeDraft)=>inspectKnowledgeCitations(
  draft,store.documents,store.userState.removedDocumentIds);
const draftCategoryLabel=(draft:KnowledgeDraft)=>{
  const status=citationStatusOf(draft);
  if(status.status==="citation_stale")return "原引用失效 · 需重检";
  if(!status.hasEvidence)return "仅缺口报告";
  return draft.status==="pending_review"?"待人工审核":"DEMO已审核";
};

const unreviewedCount=computed(()=>store.documents.filter(x=>x.assetIds.includes(assetId.value)&&!x.reviewed).length);
const priorDrafts=computed(()=>drafts.value.filter(x=>x.assetId===assetId.value));
const labelCategory:Record<string,string>={vibration:"振动/机械",temperature:"轴承温度",current:"电机电流",pressure:"压力",flow:"流量",leakage:"泄漏/密封",general:"综合查询"};
const evidenceStatus=(source:string)=>source==="demo"?"DEMO演示档案":"用户导入内容";
function refreshDrafts(){drafts.value=readKnowledgeDrafts(localStorage,store.scenarioId);}
function chooseAsset(v:string|null){if(!v)return;assetId.value=v;alarmId.value="";symptom.value="";}
function choosePreset(topic:string){symptom.value=topic;}
function openDocument(hit:KnowledgeDocumentHit){void router.push(hit.path);}
function save():void {
  isBusy.value=true;
  try{
    const draft=saveKnowledgeDraft(result.value,store.scenarioId,store.role,localStorage);
    refreshDrafts();selectedDraftId.value=draft.id;
    message.success("仅保存待复核证据核验草稿，未形成故障结论或控制指令");
  }catch(e){message.error((e as Error).message);}
  finally{isBusy.value=false;}
}
function selectDocumentForReview(id:string):void {
  documentIdForReview.value=id;
  documentVersion.value="";
  documentSection.value="";
  documentNote.value="";
}
function approveDocument():void {
  const doc=documentForReview.value;
  if(!doc)return;
  try{
    store.reviewImportedDocument(doc.id,documentVersion.value,documentSection.value,documentNote.value);
    message.success("演示内已审核导入摘录；已按当前设备与检索主题重新建立候选证据");
    documentIdForReview.value="";
    documentVersion.value="";documentSection.value="";documentNote.value="";
  }catch(e){message.error((e as Error).message);}
}
function review():void {
  if(!draftSelected.value)return;
  try{
    reviewKnowledgeDraft(draftSelected.value.id,store.role,reviewNote.value,localStorage,store.documents);
    refreshDrafts();reviewNote.value="";
    message.success("已完成本地DEMO审核；真实技术审查、厂家资料验证仍需线下完成");
  }catch(e){message.error((e as Error).message);}
}
watch(()=>[route.query.assetId,route.query.alarmId,route.query.symptom],()=>{
  const a=requestedAssetId();
  assetId.value=a;
  alarmId.value=getQ("alarmId");
  symptom.value=getQ("symptom")|| (alarmId.value?store.alarms.find(x=>x.id===alarmId.value)?.title??"异常待核实":"振动异常");
});
watch(()=>store.scenarioId,()=>{alarmId.value="";refreshDrafts();selectedDraftId.value="";});
</script>

<template>
  <section class="knowledge-root">
    <header class="kb-hero">
      <div>
        <div class="kb-eyebrow">智能决策 / 证据知识与诊断</div>
        <h2>专业知识库与可追溯诊断 <small>V1</small></h2>
        <p>从设备档案、已验收工单、巡检和维修记录检索依据，保留原文、版本、章节与事件ID。对证据不足的故障不作自动根因判断。</p>
      </div>
      <div class="hero-tags"><NTag type="warning" size="small">本地规则检索 · 非大模型RAG</NTag><NTag type="info" size="small">MOCK / 用户输入</NTag></div>
    </header>

    <section class="panel kb-query">
      <div class="section-heading"><div><h3>选择对象与核查主题</h3><p>可从设备健康页、AI诊断和跨系统事件直接携带设备/告警ID；也可在此手动查询。</p></div></div>
      <div class="query-grid">
        <label><span>目标设备</span><NSelect :value="assetId" :options="assetOptions" filterable @update:value="chooseAsset"/></label>
        <label class="query-wide"><span>异常主题 / 检索问题</span><NInput v-model:value="symptom" placeholder="例如：P-002振动持续升高应核查哪些资料？"/></label>
      </div>
      <p class="search-mode">当前分类：{{ labelCategory[result.category] }} · 本设备尚未审核资料 {{ unreviewedCount }} 份 · 检索只在当前页面内进行，不修改原档案。</p>
      <div class="quick-topics">
        <span>常用核查：</span>
        <NButton size="tiny" secondary @click="choosePreset('振动异常与联轴器对中')">振动与对中</NButton>
        <NButton size="tiny" secondary @click="choosePreset('轴承温度升高')">轴承温度</NButton>
        <NButton size="tiny" secondary @click="choosePreset('电流偏高')">电流偏高</NButton>
        <NButton size="tiny" secondary @click="choosePreset('出口压力偏低')">出口压力</NButton>
        <router-link :to="'/archives?assetId='+encodeURIComponent(assetId)">进入原档案管理</router-link>
      </div>
      <div v-if="alarmId" class="alarm-context">
        <strong>关联原始告警：{{ alarmId }}</strong>
        <span v-if="selectedAlarm"> {{ selectedAlarm.title }} · {{ selectedAlarm.status }} · {{ selectedAlarm.occurredAt }} </span>
        <span v-else>当前场景找不到该告警或设备关系不匹配，不能把它作为依据。</span>
        <router-link v-if="selectedAlarm" :to="'/operations/alarms?alarmId='+encodeURIComponent(alarmId)">查看原始告警</router-link>
        <NButton text size="small" @click="alarmId=''">清除告警范围</NButton>
      </div>
    </section>

    <div class="kb-metrics">
      <div><span>有章节的已审核可用片段</span><strong>{{ result.documents.length }}</strong><small>仅演示内审核且摘录匹配</small></div>
      <div><span>排除或不满足可信条件</span><strong>{{ result.excluded.length }}</strong><small>未审、缺原文或不可用</small></div>
      <div><span>原业务可追溯记录</span><strong>{{ result.related.length }}</strong><small>巡检、维修、验收工单、告警</small></div>
      <div><span>知识证据状态</span><strong class="readiness">{{ result.confidence==="reference_only"?"仅参考":"依据不足" }}</strong><small>没有自动确认根因的权限</small></div>
    </div>

    <div class="kb-workspace">
      <section class="panel evidence-panel">
        <div class="section-heading">
          <div><h3>可引用档案片段</h3><p>必须同时满足“设备匹配 · 主题相关 · 演示内已审核 · 原文可用 · 版本和章节齐全”</p></div>
          <NTag :type="result.documents.length?'success':'warning'" size="small">{{ result.documents.length }} 条</NTag>
        </div>
        <div v-if="!result.documents.length" class="kb-empty">
          <strong>没有符合条件的可引用资料。</strong>
          <p>当前不能得出有依据的故障原因或检查措施。请补充适用设备的原始说明书/工艺规程，并完成版本、章节和人工审核。</p>
        </div>
        <div v-for="hit in result.documents" :key="hit.id" class="evidence-hit">
          <div class="hit-head">
            <div><strong>{{ hit.title }}</strong><small>{{ hit.citation }}</small></div>
            <NTag size="tiny" type="success">演示内已审核</NTag>
          </div>
          <div class="meta-row"><span>{{ evidenceStatus(hit.source) }}</span><span>章节：{{ hit.section }}</span><span>更新：{{ hit.updatedAt.slice(0,10) }}</span></div>
          <blockquote class="excerpt">{{ hit.excerpt }}</blockquote>
          <div class="hit-bottom"><span>原文匹配：{{ hit.matchedTerms.join('、')||'综合浏览' }}</span>
            <NButton size="tiny" secondary @click="openDocument(hit)">查看原档案与版本</NButton></div>
        </div>
      </section>

      <section class="panel judgment-panel">
        <div class="section-heading"><div><h3>证据约束下的核查意见</h3><p>事实、参考和待核实假设分离，不能凭历史案例自动诊断当前故障</p></div></div>
        <div class="judgment-status" :class="{insufficient:result.confidence==='insufficient'}">
          <NTag size="tiny" :type="result.confidence==='insufficient'?'warning':'info'">{{ result.confidence==='insufficient'?'禁止诊断结论':'证据仅供参考' }}</NTag>
          <span>当前没有经过现场验收的故障根因判定。</span>
        </div>
        <div class="kb-subsection">
          <h4>已知事实 / 原始业务记录</h4>
          <p v-for="(line,i) in result.findings" :key="i">{{ line }}</p>
        </div>
        <div class="kb-subsection">
          <h4>可追溯检查建议</h4>
          <div v-if="!result.checkSuggestions.length" class="sub-empty">暂无引用了有效资料的建议，先补充资料或人工核查现场。</div>
          <div v-for="(item,i) in result.checkSuggestions" :key="i" class="suggestion">
            <p>{{ item.text }}</p>
            <span>支撑文档ID：{{ item.supportingDocumentIds.join(' · ') }}</span>
          </div>
        </div>
        <div class="kb-subsection warnings">
          <h4>可信度限制</h4>
          <p v-for="(line,i) in result.warnings" :key="i">{{ line }}</p>
        </div>
        <div class="save-panel">
          <NButton type="primary" :disabled="!canSave||!result.asset||isBusy" @click="save">人工确认保存核验草稿</NButton>
          <small>{{ canSave?'只写本地待复核记录，不派工、不改变告警、不控制设备。':'当前角色仅允许检索与查看资料，无保存权限。' }}</small>
        </div>
      </section>
    </div>

    <div class="kb-bottom-grid">
      <section class="panel">
        <div class="section-heading"><div><h3>历史巡检 / 维修 / 验收工单</h3><p>这些记录提供业务背景，不自动证明与本次异常具有因果关系</p></div></div>
        <div v-if="!result.related.length" class="kb-empty">没有当前设备与主题相关的历史记录。</div>
        <div v-for="record in result.related" :key="record.kind+record.refId" class="history-row">
          <div><strong>{{ record.title }}</strong><small>{{ record.refId }} · {{ record.at.slice(0,16).replace('T',' ') }} · {{ record.source }}</small></div>
          <p>{{ record.text }}</p>
          <router-link :to="record.path">打开原业务记录</router-link>
        </div>
      </section>
      <section class="panel">
        <div class="section-heading"><div><h3>资料可信度检查</h3><p>未审核的图纸、无摘录导入文件不参与诊断依据</p></div>
          <NButton size="tiny" text @click="includePending=!includePending">{{ includePending?'收起':'查看' }}排除项（{{ result.excluded.length }}）</NButton></div>
        <div v-if="includePending">
          <div v-if="!result.excluded.length" class="kb-empty">当前设备没有因审核或原文缺失被排除的资料。</div>
          <div v-for="doc in result.excluded" :key="doc.id" class="excluded-row">
            <div><strong>{{ doc.title }}</strong><small>{{ doc.id }}</small></div>
            <NTag size="tiny" type="warning">{{ doc.reason }}</NTag>
            <router-link :to="'/archives?docId='+encodeURIComponent(doc.id)">查看</router-link>
            <NButton v-if="canReviewDocuments && store.documents.some(x=>x.id===doc.id&&x.source==='user-upload'&&!x.reviewed&&Boolean(x.contentExcerpt))"
              size="tiny" secondary @click="selectDocumentForReview(doc.id)">审核导入摘录</NButton>
          </div>
        </div>
        <div v-if="documentForReview" class="document-approval">
          <strong>导入片段审核（本地DEMO） · {{ documentForReview.id }}</strong>
          <p>请先从原档案详情核查摘录与关联设备。只批准已读取的摘录，不代表检查了未保存的完整文件，也不等于厂家技术审核。</p>
          <label>来源文件实际版号<NInput v-model:value="documentVersion" size="small" placeholder="例如：V2.1-2026"/></label>
          <label>可定位原始章节或条款<NInput v-model:value="documentSection" size="small" placeholder="例如：第3章 / 3.2 运维检查"/></label>
          <label>核查意见与适用范围<NInput v-model:value="documentNote" type="textarea" :rows="2"
            placeholder="至少8字，注明使用范围、设备型号及摘录不完整的限制"/></label>
          <div class="approval-actions">
            <NButton type="primary" size="small" :disabled="!canReviewDocuments||!documentVersion.trim()||!documentSection.trim()||documentNote.trim().length<8" @click="approveDocument">确认DEMO审核摘录</NButton>
            <NButton size="small" secondary @click="documentIdForReview=''">取消</NButton>
          </div>
        </div>
        <p class="caveat">资料导入沿用原档案模块：文本文件仅读取最多256KB，保存摘录最多2000字符；PDF/DOCX暂不具备全文索引。正式知识库需使用文件解析、全文分段索引、文档版本/适用设备与具名审核。</p>
        <router-link class="archive-link" :to="'/archives?assetId='+encodeURIComponent(assetId)">进入档案管理 / 导入资料</router-link>
        <div class="kb-divider"></div>
        <div class="section-heading"><div><h3>待复核的诊断核验草稿</h3><p>记录原文ID、版本及章节；审核时重新检查资料是否已失效</p></div></div>
        <div v-if="!priorDrafts.length" class="kb-empty">当前设备暂无核验草稿。</div>
        <button v-for="doc in priorDrafts.slice(0,10)" :key="doc.id" type="button"
          class="draft-item" :class="{selected:selectedDraftId===doc.id}" @click="selectedDraftId=doc.id">
          <span><strong>{{ doc.id }}</strong><small>{{ doc.query.symptom || '未提供主题' }} · {{ doc.createdBy }}</small></span>
          <NTag :type="citationStatusOf(doc).status==='citation_stale'?'error':doc.status==='pending_review'?'warning':'success'" size="tiny">
            {{ draftCategoryLabel(doc) }}
          </NTag>
        </button>
        <div v-if="draftSelected && draftSelected.assetId===assetId" class="draft-detail">
          <strong>草稿：{{ draftSelected.id }}</strong>
          <p>{{ draftSelected.description }}</p>
          <p>引用：{{ draftSelected.evidence.map(x=>x.citation).join('；')||'无可信文档引用（仅缺口说明）' }}</p>
          <div v-if="draftCitationStatus?.status==='citation_stale'" class="citation-stale" role="alert">
            <strong>原证据引用已失效，历史建议不可直接复用。</strong>
            <p v-for="line in draftCitationStatus.missing" :key="line">{{ line }}</p>
            <p>请重新检索并生成新的核验草稿；历史审核记录保留，不会自动改写原档案。</p>
          </div>
          <p v-else-if="draftCitationStatus?.status==='evidence_missing'" class="citation-gap">
            本草稿仅记录资料缺口，没有可用于专业检查建议的原文依据；即使完成演示审核，也不构成设备诊断结论。
          </p>
          <p v-else class="citation-valid">已重新核对当前绑定设备、版本、章节与摘录一致性（仅非加密指纹检查，不是正式原文签章）。</p>
          <p>生成：{{ draftSelected.createdAt }} · {{ draftSelected.createdBy }} · 来源{{ draftSelected.source }}</p>
          <div v-if="draftSelected.status==='pending_review'" class="draft-review">
            <NInput v-model:value="reviewNote" type="textarea" :rows="2"
              :disabled="!canReview" placeholder="至少8字：说明审核意见及资料与设备适用情况"/>
            <NButton size="small" type="primary"
              :disabled="!canReview||reviewNote.trim().length<8||draftCitationStatus?.status==='citation_stale'"
              @click="review">演示审核核验草稿</NButton>
          </div>
          <p v-else class="kb-success">审核者 {{ draftSelected.reviewedBy }} · {{ draftSelected.reviewedAt }}。{{ draftSelected.reviewNote }}</p>
          <p v-if="!canReview&&draftSelected.status==='pending_review'" class="caveat">当前角色没有审核权限，仅管理者/管理员可进行DEMO审核。</p>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* 已审核报告也必须随档案变动重新校验，避免历史引用长期误显可信 */
.citation-stale{padding:11px;border:1px solid #edcfc8;border-radius:8px;background:#fff6f4;color:#a64e47;font-size:11px;line-height:1.75}
.citation-stale p{margin:5px 0}
.citation-gap{background:#fff9ed;border:1px solid #eee2c9;color:#947a48;border-radius:7px;font-size:11px;padding:10px}
.citation-valid{background:#f0f8f5;color:#36856c;border-radius:7px;font-size:11px;padding:9px}
.knowledge-root{color:#2f5972;display:grid;gap:13px;padding-bottom:24px;min-width:0}
.kb-hero{padding:21px 24px;border:1px solid #c8e4f2;border-radius:11px;background:linear-gradient(105deg,#e0f2fb,#fafdff 62%,#e8f6f2);display:flex;justify-content:space-between;align-items:center;gap:16px}
.kb-eyebrow{font-size:11px;color:#5698b7;margin-bottom:8px}
.kb-hero h2{font-size:22px;font-weight:750;color:#215c7e;margin:0}
.kb-hero h2 small{font-size:11px;color:#88a9b8;font-weight:400}
.kb-hero p{font-size:12px;color:#7d9aa9;line-height:1.8;max-width:800px;margin:7px 0 0}
.hero-tags{display:flex;gap:7px;flex-wrap:wrap}
.panel,.kb-metrics>div{background:white;border:1px solid #dfebf3;border-radius:10px;box-shadow:0 4px 18px #2b668609;min-width:0}
.panel{padding:17px}
.section-heading{display:flex;justify-content:space-between;gap:9px;align-items:flex-start;margin-bottom:14px}
.section-heading h3{font-size:16px;margin:0;color:#306984}
.section-heading p{font-size:11px;margin:5px 0 0;color:#91a6b7;line-height:1.65}
.query-grid{display:grid;grid-template-columns:minmax(200px,.7fr) minmax(280px,1.5fr);gap:12px}
.query-grid label{display:grid;gap:7px;min-width:0}
.query-grid label span{font-size:11px;color:#83a1b0}
.quick-topics{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:13px}
.quick-topics span{font-size:11px;color:#8fa5b4}
.quick-topics a,.alarm-context a,.history-row a,.excluded-row a,.archive-link{font-size:11px;color:#1684b3;text-decoration:none}
.quick-topics a:hover,.history-row a:hover,.excluded-row a:hover{text-decoration:underline}
.alarm-context{margin-top:13px;background:#fff8ef;border:1px solid #f1dfc6;border-radius:7px;padding:9px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.alarm-context strong,.alarm-context span{font-size:11px;color:#886d50}
.kb-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kb-metrics>div{display:grid;gap:7px;padding:16px;min-width:0}
.kb-metrics span{font-size:11px;color:#819bab}
.kb-metrics strong{font-size:25px;color:#297ba1;line-height:1.4}
.kb-metrics strong.readiness{font-size:20px}
.kb-metrics small{color:#91a7b5;font-size:10px;line-height:1.5}
.kb-workspace{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.95fr);gap:13px;align-items:start}
.evidence-hit{border:1px solid #e4eef5;border-radius:8px;padding:13px;background:#fbfdff;margin-bottom:11px}
.hit-head{display:flex;justify-content:space-between;align-items:flex-start;gap:7px}
.hit-head>div{display:grid;gap:7px;min-width:0}
.hit-head strong{font-size:13px;color:#2c708c}
.hit-head small{font-size:10px;color:#7f9cae;overflow-wrap:anywhere}
.meta-row{display:flex;flex-wrap:wrap;gap:6px 11px;font-size:10px;color:#91abb9;margin-top:9px}
.excerpt{font-size:11px;color:#557a8d;background:#f4f9fc;border-left:3px solid #a9cfe4;padding:10px;line-height:1.85;margin:10px 0;overflow-wrap:anywhere}
.hit-bottom{display:flex;align-items:center;justify-content:space-between;gap:9px}
.hit-bottom span{font-size:10px;color:#89a4b3}
.kb-empty{padding:18px;border-radius:7px;background:#f7fafc;border:1px dashed #deebf3;font-size:12px;color:#8aa5b4;line-height:1.8}
.kb-empty p{margin:7px 0 0}
.judgment-status{display:flex;gap:10px;align-items:center;background:#edf8fd;padding:10px;border-radius:7px;flex-wrap:wrap;margin-bottom:12px}
.judgment-status.insufficient{background:#fff7ed}
.judgment-status span{font-size:11px;color:#617f95}
.kb-subsection{border-top:1px solid #e5eef5;padding-top:13px;margin-top:12px}
.kb-subsection h4{font-size:12px;color:#3e7b9a;margin:0 0 10px}
.kb-subsection>p{font-size:11px;color:#718fa1;line-height:1.8;margin:7px 0}
.suggestion{background:#f3faf7;border:1px solid #dceee5;border-radius:7px;padding:10px;margin-bottom:7px}
.suggestion p{font-size:11px;color:#3f7767;line-height:1.8;margin:0 0 5px}
.suggestion span{font-size:10px;color:#8cae9e}
.sub-empty{font-size:11px;color:#92a8b7}
.warnings p{color:#99866d}
.save-panel{margin-top:19px;display:grid;gap:7px}
.save-panel .n-button{justify-self:start}
.save-panel small{font-size:10px;line-height:1.6;color:#8fa5b4}
.kb-bottom-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:13px;align-items:start}
.history-row{padding:11px;border-bottom:1px solid #e7eff4;display:grid;gap:7px}
.history-row>div{display:grid;gap:5px}
.history-row strong{font-size:12px;color:#387894}
.history-row small{font-size:10px;color:#90aabb}
.history-row p{font-size:11px;color:#617e90;margin:0;line-height:1.7}
.history-row a{justify-self:start}
.excluded-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px;border-bottom:1px solid #e9eff3}
.excluded-row>div{display:grid;gap:5px}
.excluded-row strong{font-size:11px;color:#426c82}
.excluded-row small{font-size:10px;color:#91a9b9}
/* 只批准主动上传且能读取的摘录，原始PDF/DOCX及超限文件无法在此审核 */
.search-mode{font-size:11px;color:#7696a7;line-height:1.7;margin:8px 0 0}
.document-approval{display:grid;gap:10px;border:1px solid #d6e8f3;background:#f5fbff;padding:13px;margin:11px 0;border-radius:8px}
.document-approval strong{font-size:12px;color:#267b9d}
.document-approval p{font-size:11px;line-height:1.7;color:#819bab;margin:0}
.document-approval label{display:grid;gap:6px;font-size:11px;color:#7595a6}
.approval-actions{display:flex;gap:7px;flex-wrap:wrap}
.caveat{margin:14px 0;font-size:11px;color:#a18b70;line-height:1.8}
.archive-link{display:inline-block;background:#f0f9fd;padding:9px;border-radius:7px}
.kb-divider{height:1px;background:#e4eff4;margin:19px 0}
.draft-item{display:flex;align-items:center;justify-content:space-between;gap:8px;border-radius:7px;border:1px solid #e3edf4;background:#fbfdff;width:100%;text-align:left;padding:10px;cursor:pointer;margin:7px 0}
.draft-item.selected{background:#edf9ff;border-color:#90cbe8}
.draft-item span{display:grid;gap:5px}
.draft-item strong{font-size:11px;color:#2c728e}
.draft-item small{font-size:10px;color:#94aabb}
.draft-detail{border:1px solid #d5e8f0;background:#f7fbfd;border-radius:7px;padding:12px;margin-top:11px}
.draft-detail>strong{font-size:12px;color:#317b99}
.draft-detail>p{font-size:11px;color:#7292a2;line-height:1.7;overflow-wrap:anywhere}
.draft-review{display:grid;gap:10px}
.draft-review .n-button{justify-self:start}
.kb-success{color:#238969!important}
@media(max-width:1300px){.kb-workspace,.kb-bottom-grid{grid-template-columns:1fr}}
@media(max-width:800px){.kb-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.query-grid{grid-template-columns:1fr}}
@media(max-width:600px){.kb-hero{flex-direction:column;align-items:flex-start}.kb-metrics{grid-template-columns:1fr 1fr}}
</style>
