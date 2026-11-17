import {test,expect,type Page} from "@playwright/test";
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem("__knowledge_case")){
      localStorage.clear();
      localStorage.setItem("tanggang-demo-role","duty");
      sessionStorage.setItem("__knowledge_case","1");
    }
  });
  await page.goto("/decision/knowledge");
});
async function setRole(page:Page,role:string){
  await page.evaluate(value=>localStorage.setItem("tanggang-demo-role",value),role);
  await page.reload();
}

test("KB1 默认P002振动查询命中3份带版本章节的MOCK原文，未审核图纸被排除",async({page})=>{
  await expect(page.getByRole("heading",{name:/专业知识库与可追溯诊断/})).toBeVisible();
  await expect(page.locator(".evidence-hit")).toHaveCount(3);
  await expect(page.locator(".excluded-row")).toHaveCount(1);
  await expect(page.locator(".evidence-panel")).toContainText("DOC-P002-MANUAL");
  await expect(page.locator(".evidence-panel")).toContainText("V1.0-demo");
  await expect(page.locator(".evidence-panel")).toContainText("运行检查");
  await expect(page.locator(".evidence-panel")).toContainText("DEMO");
  await expect(page.locator(".history-row")).toHaveCount(4);
  await expect(page.locator(".judgment-status")).toContainText("证据仅供参考");
  await page.getByRole("button",{name:"查看原档案与版本"}).first().click();
  await expect(page).toHaveURL(/\/archives\?docId=DOC-P002-/);
  await expect(page.locator(".doc-detail")).toContainText("档案编号");
  await expect(page.locator(".doc-detail")).toContainText("原文");
});

test("KB2 出口压力异常没有可用资料时降级，不能复用振动说明书推断根因",async({page})=>{
  await page.getByRole("button",{name:"出口压力"}).click();
  await expect(page.locator(".evidence-hit")).toHaveCount(0);
  await expect(page.locator(".judgment-status")).toContainText("禁止诊断结论");
  await expect(page.locator(".judgment-panel")).toContainText("暂无引用了有效资料的建议");
  await expect(page.locator(".kb-empty").first()).toContainText("没有符合条件的可引用资料");
});

test("KB3 从现有故障场景射雾器关联诊断下钻时不伪造未接入的告警上下文",async({page})=>{
  await page.goto("/intelligent/correlation");
  await page.getByRole("button",{name:"预览P-002与射雾器异常（MOCK）"}).click();
  await page.locator(".corr-item").filter({hasText:"SP-004"}).click();
  await page.locator(".knowledge-link a").click();
  await expect(page).toHaveURL(/\/decision\/knowledge\?assetId=asset-sp004/);
  await expect(page.locator(".evidence-hit")).toHaveCount(0);
  await expect(page.locator(".judgment-status")).toContainText("禁止诊断结论");
  await expect(page.locator(".kb-hero")).toContainText("可追溯");
  expect(new URL(page.url()).searchParams.has("alarmId")).toBe(false);
});

test("KB4 从健康与能效进入同一知识库保留原设备档案，不另建知识孤岛",async({page})=>{
  await page.goto("/decision/health");
  await page.getByRole("link",{name:"查看证据知识与诊断"}).click();
  await expect(page).toHaveURL(/\/decision\/knowledge\?assetId=asset-p002/);
  await expect(page.locator(".evidence-hit")).toHaveCount(3);
  await expect(page.locator(".kb-workspace")).toContainText("原文匹配");
});

test("KB5 值班员确认保存证据核验草稿，管理者审核并记录意见；刷新后持久化",async({page})=>{
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-knowledge-diagnosis-v1"))).toBeNull();
  await page.getByRole("button",{name:"人工确认保存核验草稿"}).click();
  await expect(page.locator(".draft-item")).toHaveCount(1);
  const docs=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-knowledge-diagnosis-v1")??"[]"));
  expect(docs).toHaveLength(1);
  expect(docs[0].status).toBe("pending_review");
  expect(docs[0].evidence).toHaveLength(3);
  await page.locator(".draft-item").click();
  await expect(page.getByRole("button",{name:"演示审核核验草稿"})).toBeDisabled();
  await setRole(page,"manager");
  await page.locator(".draft-item").click();
  await page.locator(".draft-review textarea").fill("本次仅审核演示资料版本和内容，不代表现场真实故障判断");
  await page.getByRole("button",{name:"演示审核核验草稿"}).click();
  await expect(page.locator(".kb-success")).toContainText("manager");
  const updated=await page.evaluate(()=>JSON.parse(localStorage.getItem("tanggang-knowledge-diagnosis-v1")??"[]"));
  expect(updated[0].status).toBe("reviewed_demo");
  await page.reload();
  await expect(page.locator(".draft-item")).toContainText("DEMO已审核");
});

test("KB6 viewer只读可检索原文，但无权保存核验草稿",async({page})=>{
  await setRole(page,"viewer");
  await expect(page.locator(".evidence-hit")).toHaveCount(3);
  await expect(page.getByRole("button",{name:"人工确认保存核验草稿"})).toBeDisabled();
  await expect(page.locator(".judgment-status")).toContainText("证据仅供参考");
  expect(await page.evaluate(()=>localStorage.getItem("tanggang-knowledge-diagnosis-v1"))).toBeNull();
});

test("KB7 用户导入的文本先为未审，manager补版本、章节和意见后才进入可引用证据",async({page})=>{
  await setRole(page,"engineer");
  await page.goto("/archives?assetId=asset-p002");
  const uploader=page.getByTestId("document-import-input");
  await uploader.setInputFiles({
    name:"P002-轴承振动检查.txt",mimeType:"text/plain",
    buffer:Buffer.from("振动异常时请核实轴承、联轴器对中，记录振动速度并开展人工检查。这是用户提供的DEMO文本片段。","utf8"),
  });
  await expect(page.locator(".doc-detail")).toContainText("DOC-USER-001");
  await expect(page.locator(".doc-detail")).toContainText("未审核");
  await page.goto("/decision/knowledge?assetId=asset-p002&symptom=振动异常");
  await expect(page.locator(".evidence-hit")).toHaveCount(3);
  await expect(page.locator(".excluded-row").filter({hasText:"DOC-USER-001"})).toContainText("DOC-USER-001");
  await setRole(page,"manager");
  await page.locator(".excluded-row").filter({hasText:"DOC-USER-001"}).getByRole("button",{name:"审核导入摘录"}).click();
  await page.getByPlaceholder("例如：V2.1-2026").fill("V1.3-2026");
  await page.getByPlaceholder("例如：第3章 / 3.2 运维检查").fill("第3章 / 3.2 轴承振动检查");
  await page.getByPlaceholder("至少8字，注明使用范围、设备型号及摘录不完整的限制").fill("已核查当前导入摘录仅用于P002模拟振动核查，未核实原文件全文");
  await page.getByRole("button",{name:"确认DEMO审核摘录"}).click();
  await expect(page.locator(".evidence-hit")).toHaveCount(4);
  await expect(page.locator(".evidence-panel")).toContainText("DOC-USER-001");
  await expect(page.locator(".evidence-panel")).toContainText("V1.3-2026");
  await expect(page.locator(".evidence-panel")).toContainText("第3章");
  await page.locator(".evidence-hit").filter({hasText:"DOC-USER-001"}).getByRole("button",{name:"查看原档案与版本"}).click();
  await expect(page.locator(".doc-detail")).toContainText("审核意见");
  await expect(page.locator(".doc-detail")).toContainText("未核实原文件全文");
});

test("KB8 超限导入只有元信息，不允许管理者未经内容审阅直接批准",async({page})=>{
  await setRole(page,"engineer");
  await page.goto("/archives?assetId=asset-p002");
  await page.getByTestId("document-import-input").setInputFiles({
    name:"超限检修文件.md",mimeType:"text/markdown",buffer:Buffer.alloc(270*1024,65),
  });
  await page.goto("/decision/knowledge?assetId=asset-p002&symptom=振动异常");
  await expect(page.locator(".excluded-row").filter({hasText:"DOC-USER-001"})).toContainText("DOC-USER-001");
  await setRole(page,"manager");
  await expect(page.locator(".excluded-row").filter({hasText:"DOC-USER-001"}).getByRole("button",{name:"审核导入摘录"})).toHaveCount(0);
  await expect(page.locator(".evidence-hit")).toHaveCount(3);
});

test("KB9 绑定原始告警ID时显示真实业务来源和跳转；场景中找不到ID则拒绝伪造",async({page})=>{
  await page.goto("/decision/knowledge?assetId=asset-p002&alarmId=ALM-P002-01&symptom=振动异常");
  await expect(page.locator(".alarm-context")).toContainText("ALM-P002-01");
  await expect(page.locator(".history-row").filter({hasText:"ALM-P002-01"})).toHaveCount(1);
  await page.goto("/decision/knowledge?assetId=asset-p002&alarmId=ALM-SP004-01&symptom=振动异常");
  await expect(page.locator(".alarm-context")).toContainText("不匹配");
  await expect(page.locator(".history-row").filter({hasText:"ALM-SP004-01"})).toHaveCount(0);
});

test("KB10 现有AI助手一句话查证据：显示原文版本章节和出处，点击跳转同一知识工作台",async({page})=>{
  await page.goto("/overview");
  await page.getByRole("banner").getByRole("button",{name:"问 AI",exact:true}).click();
  await page.locator(".n-drawer textarea").first().fill("查找P-002振动异常的诊断依据");
  await page.getByRole("button",{name:"解析指令",exact:true}).click();
  await expect(page.locator(".knowledge-ai-result")).toBeVisible();
  await expect(page.locator(".knowledge-ai-result")).toContainText("DOC-P002-MANUAL");
  await expect(page.locator(".knowledge-ai-result")).toContainText("V1.0-demo");
  await expect(page.locator(".knowledge-ai-hits>div")).toHaveCount(3);
  await expect(page.locator(".timeline")).toContainText("knowledge.search");
  await page.getByRole("button",{name:"打开完整知识核验工作台"}).click();
  await expect(page).toHaveURL(/\/decision\/knowledge\?assetId=asset-p002&symptom=/);
  await expect(page.locator(".evidence-hit")).toHaveCount(3);
});
test("KB11 AI检索不存在设备时拒绝猜测；压力主题缺资料时拒绝无来源诊断",async({page})=>{
  await page.goto("/overview");
  await page.getByRole("banner").getByRole("button",{name:"问 AI",exact:true}).click();
  await page.locator(".n-drawer textarea").first().fill("查找Z-999振动异常的诊断依据");
  await page.getByRole("button",{name:"解析指令",exact:true}).click();
  await expect(page.locator(".knowledge-ai-result")).toHaveCount(0);
  await expect(page.locator(".intent-card")).toContainText("Z-999");
  await page.locator(".n-drawer textarea").first().fill("查找P-002压力异常的诊断依据");
  await page.getByRole("button",{name:"解析指令",exact:true}).click();
  await expect(page.locator(".knowledge-ai-result")).toContainText("没有适用设备");
  await expect(page.locator(".knowledge-ai-hits")).toHaveCount(0);
});

test("KB12 显式无效设备ID不能偷偷回退P002并引用其他设备说明书",async({page})=>{
  await page.goto("/decision/knowledge?assetId=asset-no-such&symptom=振动异常");
  await expect(page.locator(".evidence-hit")).toHaveCount(0);
  await expect(page.locator(".judgment-status")).toContainText("禁止诊断结论");
  await expect(page.locator(".warnings")).toContainText("设备不存在");
  await expect(page.getByRole("button",{name:"人工确认保存核验草稿"})).toBeDisabled();
});

test("KB13 历史草稿已演示审核后，原说明书引用删除必须变成失效提示而不是仍显示可信",async({page})=>{
  await page.getByRole("button",{name:"人工确认保存核验草稿"}).click();
  await setRole(page,"manager");
  await page.locator(".draft-item").click();
  await page.locator(".draft-review textarea").fill("仅审核本地演示文档引用，不代表现场故障判断");
  await page.getByRole("button",{name:"演示审核核验草稿"}).click();
  await expect(page.locator(".citation-valid")).toBeVisible();
  await expect(page.locator(".draft-item")).toContainText("DEMO已审核");
  await setRole(page,"engineer"); // manager仅可审核资料，不拥有删除引用权限
  await page.goto("/archives?docId=DOC-P002-MANUAL");
  await page.getByRole("button",{name:"删除引用"}).click();
  await page.getByRole("button",{name:"确认删除"}).click();
  await page.goto("/decision/knowledge?assetId=asset-p002&symptom=振动异常");
  await expect(page.locator(".evidence-hit")).toHaveCount(2);
  await page.locator(".draft-item").click();
  await expect(page.locator(".draft-item")).toContainText("原引用失效");
  await expect(page.locator(".citation-stale")).toContainText("DOC-P002-MANUAL");
  await expect(page.locator(".citation-stale")).toContainText("历史建议不可直接复用");
  await expect(page.locator(".draft-detail")).toContainText("manager");
});

test("KB14 未审核旧草稿的资料被删除时，管理者审核按钮必须禁止",async({page})=>{
  await page.getByRole("button",{name:"人工确认保存核验草稿"}).click();
  await page.goto("/archives?docId=DOC-P002-MANUAL");
  await setRole(page,"engineer"); // 由档案维护角色删除，随后管理者审核
  await page.getByRole("button",{name:"删除引用"}).click();
  await page.getByRole("button",{name:"确认删除"}).click();
  await page.goto("/decision/knowledge");
  await setRole(page,"manager");
  await page.locator(".draft-item").click();
  await expect(page.locator(".citation-stale")).toBeVisible();
  await page.locator(".draft-review textarea").fill("虽然已补充审核意见但引用来源不复存在，必须拒绝");
  await expect(page.getByRole("button",{name:"演示审核核验草稿"})).toBeDisabled();
});

test("KB15 缺少压力主题原文可生成资料缺口报告，但不能贴上有效证据标签",async({page})=>{
  await page.getByRole("button",{name:"出口压力"}).click();
  await page.getByRole("button",{name:"人工确认保存核验草稿"}).click();
  await expect(page.locator(".draft-item")).toContainText("仅缺口报告");
  await page.locator(".draft-item").click();
  await expect(page.locator(".citation-gap")).toContainText("没有可用于专业检查建议的原文依据");
  await expect(page.locator(".citation-valid")).toHaveCount(0);
  await setRole(page,"manager");
  await page.locator(".draft-item").click();
  await page.locator(".draft-review textarea").fill("只能确认当前缺少压力异常适用资料，并不能确认故障原因");
  await page.getByRole("button",{name:"演示审核核验草稿"}).click();
  await expect(page.locator(".draft-item")).toContainText("仅缺口报告");
  await expect(page.locator(".citation-gap")).toBeVisible();
});
