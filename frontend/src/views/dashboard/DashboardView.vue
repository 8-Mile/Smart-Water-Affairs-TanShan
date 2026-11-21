<template>
  <div class="home mod-dash" :class="{ 'is-ready': pageReady }">
    <div class="home-content">
    <!-- ================= 领导/超管：新版首页（主区 + 右侧今日总览窄栏） ================= -->
    <div v-if="!isOperator" class="dash-grid">
      <!-- 主区：工艺图 + 双图表 + 供水/待办 + 双表格（顶部指标卡已并入右侧窄栏） -->
      <div class="dg-main">
        <!-- 主区两列：左列=机组运行状态+四图(2×2)｜中列=综合告警/待处理工单/近7日供水量；右列=今日数据总览窄栏 -->
        <div class="dg-cols">
          <!-- 左列：机组运行状态 + 四张图表 -->
          <div class="dg-col dg-col-left">
        <!-- 工艺流程大卡（主视觉） -->
        <div class="panel panel-stage dash-card" style="--i: 0">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:flow-chart" /></span>
              机组运行状态
            </div>
            <div class="panel-head-actions">
              <el-tooltip content="全屏查看" placement="top">
                <el-icon class="fs-btn" @click="stageFullscreen = true"><FullScreen /></el-icon>
              </el-tooltip>
              <el-link type="primary" underline="never" class="more" @click="$router.push('/equipment/list')">
                更多 <el-icon><ArrowRight /></el-icon>
              </el-link>
            </div>
          </div>
          <div class="pump-stage">
            <!-- 滚动层 + 内容层：≤800px 时内容保持 640px 最小宽度横向滚动，徽章不重叠 -->
            <div class="ps-scroll">
              <div class="ps-content">
                <!-- 图片画布：徽章以画布百分比定位，保证始终落在机组正上方 -->
                <div class="ps-canvas">
                  <img :src="oneImg" alt="泵站工艺流程" draggable="false" />
                  <!-- 透明遮罩：面板打开时，点击空白处即关闭 -->
                  <div v-if="activePump" class="pump-backdrop" @click="closePanel" />
                  <div
                    v-for="(p, i) in pumps"
                    :key="p.label"
                    class="pump-badge"
                    :class="{ active: activePumpIdx === i, 'is-on': p.running, 'is-off': !p.running }"
                    :style="{ left: pumpPos[i] }"
                    @click="onPumpClick(i)"
                  >
                    <span class="pb-main">
                      <span class="pb-line">
                        <span class="p-name">{{ p.label }}</span>
                        <span class="p-state" :class="p.running ? 'ok' : 'off'">
                          <i class="pb-dot"></i>{{ p.running ? '运行中' : '停止' }}
                        </span>
                      </span>
                      <span class="p-code">{{ pumpCode(p) }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 泵组基本信息面板：点击徽章滑出，再次点击/关闭按钮收起 -->
            <Transition name="pump-panel" :duration="{ enter: 280, leave: 0 }">
              <div v-if="activePump" class="pump-panel" :class="activePump.running ? 'is-on' : 'is-off'" :style="{ '--pp-x': panelX }" @click.stop>
                <div class="pp-head">
                  <span class="pp-ico">
                    <svg class="pp-pump" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="9.4" r="5.6" />
                      <circle cx="12" cy="9.4" r="1.7" />
                      <path d="M12 3.8v3.9M12 11.1v3.9M5.8 9.4h3.4M14.8 9.4h3.4" />
                      <path d="M9.4 15l-1.4 5M14.6 15l1.4 5M7 20h10" />
                    </svg>
                  </span>
                  <div class="pp-hmain">
                    <div class="pp-tline">
                      <span class="pp-title">{{ activePump.label }}</span>
                      <!-- 运行状态心电图（与设备台账详情一致）：运行中绿波扫描，停止红线 -->
                      <div class="pp-ecg" :class="activePump.running ? 'is-running' : 'is-stopped'">
                        <svg class="ecg-svg" viewBox="0 0 132 28" preserveAspectRatio="none" aria-hidden="true">
                          <path class="ecg-flat" :d="activePump.running ? ECG_PATH : ECG_FLAT_PATH" />
                          <path v-if="activePump.running" class="ecg-pulse" :d="ECG_PATH" />
                        </svg>
                        <span class="ecg-text">{{ activePump.running ? '运行中' : '停止' }}</span>
                      </div>
                    </div>
                    <div class="pp-sub">
                      {{ activeEquip?.code || '—' }} · {{ activeEquip?.type_name || '泵组' }}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="pp-close"
                    aria-label="关闭"
                    @click.stop="closePanel"
                  >
                    <el-icon><Close /></el-icon>
                  </button>
                </div>
                <div class="pp-body">
                  <div class="pp-metrics">
                    <div class="pp-metric">
                      <span class="pp-k">运行电流</span>
                      <div class="pp-mv"><b class="pp-big">{{ mCurrent }}</b><em>A</em></div>
                    </div>
                    <div class="pp-metric">
                      <span class="pp-k">有功功率</span>
                      <div class="pp-mv"><b class="pp-big">{{ mPower }}</b><em>kW</em></div>
                    </div>
                    <div class="pp-metric">
                      <span class="pp-k">轴承温度</span>
                      <div class="pp-mv"><b class="pp-big">{{ mTemp }}</b><em>℃</em></div>
                    </div>
                    <div class="pp-metric">
                      <span class="pp-k">本次运行</span>
                      <div class="pp-mv">
                        <template v-if="runDuration.h !== '—'">
                          <b class="pp-big">{{ runDuration.h }}</b><em>h</em>
                          <b class="pp-big">{{ runDuration.m }}</b><em>min</em>
                        </template>
                        <b v-else class="pp-big">—</b>
                      </div>
                    </div>
                  </div>
                  <template v-if="activeEquip">
                    <div class="pp-sec">运维情况</div>
                    <div class="pp-cards">
                      <div class="pp-card amber link" @click="$router.push('/repair/list')">
                        <span class="pp-k">未闭环工单</span>
                        <span class="pp-v">
                          <b class="pp-big warn">{{ ops?.open_repairs ?? 0 }}</b><em>单</em>
                          <el-icon class="pp-arrow"><ArrowRight /></el-icon>
                        </span>
                      </div>
                      <div class="pp-card blue link" @click="$router.push('/alarm/realtime')">
                        <span class="pp-k">未闭环告警</span>
                        <span class="pp-v">
                          <b class="pp-big">{{ ops?.open_alarms ?? 0 }}</b><em>条</em>
                          <el-icon class="pp-arrow"><ArrowRight /></el-icon>
                        </span>
                      </div>
                    </div>
                  </template>
                  <div v-if="!activeEquip" class="pp-empty">台账未收录该泵组，仅展示实时状态</div>
                </div>
                <div class="pp-foot pp-foot-row">
                  <span class="pp-live"><i></i>实时更新</span>
                  <button
                    class="pp-btn is-plain"
                    :disabled="!activeEquip?.id"
                    @click="
                      activeEquip?.id && $router.push({
                        path: '/equipment/list',
                        query: { equipment_id: String(activeEquip.id) },
                      })
                    "
                  >
                    <span>查看详情</span><el-icon><ArrowRight /></el-icon>
                  </button>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- 左列图表：供水量对比 / 电耗双轴 / 前后池水位 / 能耗趋势（2×2） -->
        <div class="dg-charts">
          <div class="panel dash-card" style="--i: 1">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:bar-chart-grouped-line" /></span>
                供水量 · 计划对比
              </div>
            </div>
            <div class="chart-box">
              <div ref="supplyRef" class="chart chart-line" />
              <div v-if="supplyEmpty" class="chart-empty">
                <img class="ce-img" :src="noDataImg" alt="暂无数据" />
                <span>暂无数据</span>
              </div>
            </div>
          </div>
          <div class="panel dash-card" style="--i: 2">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:line-chart-line" /></span>
                电耗 · 吨水电耗
              </div>
            </div>
            <div class="chart-box">
              <div ref="dualRef" class="chart chart-line" />
              <div v-if="dualEmpty" class="chart-empty">
                <img class="ce-img" :src="noDataImg" alt="暂无数据" />
                <span>暂无数据</span>
              </div>
            </div>
          </div>
          <div class="panel dash-card" style="--i: 3">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:line-chart-line" /></span>
                前后池水位
              </div>
            </div>
            <div class="chart-box">
              <div ref="flowRef" class="chart chart-line" />
              <div v-if="flowEmpty" class="chart-empty">
                <img class="ce-img" :src="noDataImg" alt="暂无数据" />
                <span>暂无数据</span>
              </div>
            </div>
          </div>
          <div class="panel dash-card" style="--i: 4">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:bar-chart-2-line" /></span>
                能耗趋势
              </div>
              <el-radio-group v-model="energyRange" size="small" @change="onEnergyRange">
                <el-radio-button value="day">日</el-radio-button>
                <el-radio-button value="week">周</el-radio-button>
                <el-radio-button value="month">月</el-radio-button>
              </el-radio-group>
            </div>
            <div class="chart-box">
              <div ref="energyRef" class="chart chart-line" />
              <div v-if="energyEmpty" class="chart-empty">
                <img class="ce-img" :src="noDataImg" alt="暂无数据" />
                <span>暂无数据</span>
              </div>
            </div>
          </div>
        </div>
        </div>

        <!-- 中列：综合告警 + 待处理工单 + 近 7 日供水量（三卡竖排） -->
        <div ref="listsRef" class="dg-lists">
          <div class="panel list-panel dash-card" style="--i: 5">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:alarm-warning-line" /></span>
                综合告警
              </div>
              <el-link type="primary" underline="never" class="more" @click="$router.push('/alarm/realtime')">
                更多 <el-icon><ArrowRight /></el-icon>
              </el-link>
            </div>
            <div class="list-body">
              <el-table
                :data="alarms"
                class="dash-list-table"
                size="small"
                height="100%"
                :row-style="{ height: '56px' }"
                empty-text="暂无告警"
              >
              <el-table-column
                  prop="rule_name"
                  :label="showStatusCol ? '告警内容' : '内容'"
                  min-width="58"
                  show-overflow-tooltip
                />
                <el-table-column label="时间" width="82">
                  <template #default="{ row }">
                    <span class="mt-time">{{ fmtShortTime(row.alarm_time) }}</span>
                  </template>
                </el-table-column>
                
                <el-table-column label="等级" width="52" align="center" v-if="showLevelCol">
                  <template #default="{ row }">
                    <span class="tag no-dot" :class="levelClass(row.alarm_level)">
                      {{ levelText(row.alarm_level) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="76" align="center" v-if="showStatusCol">
                  <template #default="{ row }">
                    <span class="tag" :class="alarmStatusClass(row.alarm_status)">
                      {{ alarmStatusText(row.alarm_status) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="62" align="center">
                  <template #default="{ row }">
                    <el-tooltip content="处理告警" placement="top">
                      <el-button
                        type="primary"
                        size="small"
                        circle
                        class="row-btn"
                        @click="$router.push({ path: '/alarm/realtime', query: { focus: String(row.id) } })"
                      >
                        <ArtSvgIcon icon="ri:arrow-right-line" />
                      </el-button>
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>

          <div class="panel list-panel dash-card" style="--i: 6">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:file-list-3-line" /></span>
                待处理工单
              </div>
              <el-link type="primary" underline="never" class="more" @click="$router.push('/repair/list')">
                更多 <el-icon><ArrowRight /></el-icon>
              </el-link>
            </div>
            <div class="list-body">
              <el-table
                :data="repairs"
                class="dash-list-table"
                size="small"
                height="100%"
                :row-style="{ height: '56px' }"
                empty-text="暂无待处理工单"
              >
              <el-table-column
                  prop="name"
                  :label="showStatusCol ? '工单内容' : '内容'"
                  min-width="58"
                  show-overflow-tooltip
                />
                <el-table-column label="时间" width="82">
                  <template #default="{ row }">
                    <span class="mt-time">{{ fmtShortTime(row.apply_time) }}</span>
                  </template>
                </el-table-column>
                
                <el-table-column label="类型" width="52" align="center" v-if="showLevelCol">
                  <template #default="{ row }">
                    <span class="tag no-dot" :class="repairTypeClass(row.repair_type)">
                      {{ repairTypeText(row.repair_type) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="76" align="center" v-if="showStatusCol">
                  <template #default="{ row }">
                    <span class="tag" :class="repairStatusClass(row.process_status)">
                      {{ repairStatusText(row.process_status) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="62" align="center">
                  <template #default="{ row }">
                    <el-tooltip content="处理工单" placement="top">
                      <el-button
                        type="primary"
                        size="small"
                        circle
                        class="row-btn"
                        @click="$router.push({ path: '/repair/list', query: { focus: row.order_no } })"
                      >
                        <ArtSvgIcon icon="ri:arrow-right-line" />
                      </el-button>
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
          <!-- 近 7 日供水量：大数字 + 迷你柱状（今日高亮） -->
          <div class="panel water7-panel dash-card" style="--i: 7">
            <div class="panel-head">
              <div class="panel-title">
                <span class="ph-icon"><ArtSvgIcon icon="ri:bar-chart-grouped-line" /></span>
                近 7 日供水量
              </div>
              <el-link type="primary" underline="never" class="more" @click="$router.push('/energy/stats')">
                更多 <el-icon><ArrowRight /></el-icon>
              </el-link>
            </div>
            <div class="w7-body">
              <div v-if="water7.values.length" class="w7-bars">
                <div v-for="(v, i) in water7.values" :key="i" class="w7-col">
                  <i
                    class="w7-bar"
                    :class="{ today: i === water7.values.length - 1 }"
                    :style="{ height: Math.max(4, Math.round((v / water7.max) * 100)) + '%' }"
                    :title="`${water7.labels[i]}：${fmtNum(Math.round(v))} m³`"
                  ></i>
                  <span class="w7-x">{{ water7.labels[i] }}</span>
                </div>
              </div>
              <div v-else class="w7-empty">暂无数据</div>
            </div>
          </div>
        </div>
      </div>

        <!-- 行3：待办分类（横向四类，点击直达） -->
        <!-- <div class="panel todo-panel">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:task-line" /></span>
              待办分类
            </div>
          </div>
          <div class="todo-list">
            <div
              v-for="t in todoCats"
              :key="t.label"
              class="tl-row"
              @click="$router.push(t.to)"
            >
              <span class="tl-ic" :style="{ '--c': t.color, '--t': t.tint }"><ArtSvgIcon :icon="t.icon" /></span>
              <span class="tl-label">{{ t.label }}</span>
              <b class="tl-n">{{ t.n }}</b>
              <el-icon class="tl-arrow"><ArrowRight /></el-icon>
            </div>
          </div>
        </div> -->
      </div>

      <!-- 右侧：历史数据看板（独立子组件，日历仅联动本组件数据，不影响主区实时数据） -->
      <HistoryPanel class="dash-card" style="--i: 8" />
    </div>

    <!-- ================= 操作员：我的任务视角（保留原布局） ================= -->
    <template v-else>
      <!-- 操作员首页：上=机组运行状态通栏工艺图｜下=四张待办卡横排 -->
      <div class="op-grid">
        <!-- 机组运行状态：工艺流程图 + 泵组徽章（与超管首页左上角一致） -->
        <div class="panel panel-stage dash-card" style="--i: 0">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:flow-chart" /></span>
              机组运行状态
            </div>
            <div class="panel-head-actions">
              <el-tooltip content="全屏查看" placement="top">
                <el-icon class="fs-btn" @click="stageFullscreen = true"><FullScreen /></el-icon>
              </el-tooltip>
              <el-link type="primary" underline="never" class="more" @click="$router.push('/scada/monitor')">
                更多 <el-icon><ArrowRight /></el-icon>
              </el-link>
            </div>
          </div>
          <div class="pump-stage">
            <!-- 滚动层 + 内容层：≤800px 时内容保持 640px 最小宽度横向滚动，徽章不重叠 -->
            <div class="ps-scroll">
              <div class="ps-content">
                <!-- 图片画布：徽章以画布百分比定位，保证始终落在机组正上方 -->
                <div class="ps-canvas">
                  <img :src="oneImg" alt="泵站工艺流程" draggable="false" />
                  <!-- 透明遮罩：面板打开时，点击空白处即关闭 -->
                  <div v-if="activePump" class="pump-backdrop" @click="closePanel" />
                  <div
                    v-for="(p, i) in pumps"
                    :key="p.label"
                    class="pump-badge"
                    :class="{ active: activePumpIdx === i, 'is-on': p.running, 'is-off': !p.running }"
                    :style="{ left: pumpPos[i] }"
                    @click="onPumpClick(i)"
                  >
                    <span class="pb-main">
                      <span class="pb-line">
                        <span class="p-name">{{ p.label }}</span>
                        <span class="p-state" :class="p.running ? 'ok' : 'off'">
                          <i class="pb-dot"></i>{{ p.running ? '运行中' : '停止' }}
                        </span>
                      </span>
                      <span class="p-code">{{ pumpCode(p) }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 泵组基本信息面板：点击徽章滑出，再次点击/关闭按钮收起 -->
            <Transition name="pump-panel" :duration="{ enter: 280, leave: 0 }">
              <div v-if="activePump" class="pump-panel" :class="activePump.running ? 'is-on' : 'is-off'" :style="{ '--pp-x': panelX }" @click.stop>
                <div class="pp-head">
                  <span class="pp-ico">
                    <svg class="pp-pump" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="9.4" r="5.6" />
                      <circle cx="12" cy="9.4" r="1.7" />
                      <path d="M12 3.8v3.9M12 11.1v3.9M5.8 9.4h3.4M14.8 9.4h3.4" />
                      <path d="M9.4 15l-1.4 5M14.6 15l1.4 5M7 20h10" />
                    </svg>
                  </span>
                  <div class="pp-hmain">
                    <div class="pp-tline">
                      <span class="pp-title">{{ activePump.label }}</span>
                      <!-- 运行状态心电图（与设备台账详情一致）：运行中绿波扫描，停止红线 -->
                      <div class="pp-ecg" :class="activePump.running ? 'is-running' : 'is-stopped'">
                        <svg class="ecg-svg" viewBox="0 0 132 28" preserveAspectRatio="none" aria-hidden="true">
                          <path class="ecg-flat" :d="activePump.running ? ECG_PATH : ECG_FLAT_PATH" />
                          <path v-if="activePump.running" class="ecg-pulse" :d="ECG_PATH" />
                        </svg>
                        <span class="ecg-text">{{ activePump.running ? '运行中' : '停止' }}</span>
                      </div>
                    </div>
                    <div class="pp-sub">
                      {{ activeEquip?.code || '—' }} · {{ activeEquip?.type_name || '泵组' }}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="pp-close"
                    aria-label="关闭"
                    @click.stop="closePanel"
                  >
                    <el-icon><Close /></el-icon>
                  </button>
                </div>
                <div class="pp-body">
                  <div class="pp-metrics">
                    <div class="pp-metric">
                      <span class="pp-k">运行电流</span>
                      <div class="pp-mv"><b class="pp-big">{{ mCurrent }}</b><em>A</em></div>
                    </div>
                    <div class="pp-metric">
                      <span class="pp-k">有功功率</span>
                      <div class="pp-mv"><b class="pp-big">{{ mPower }}</b><em>kW</em></div>
                    </div>
                    <div class="pp-metric">
                      <span class="pp-k">轴承温度</span>
                      <div class="pp-mv"><b class="pp-big">{{ mTemp }}</b><em>℃</em></div>
                    </div>
                    <div class="pp-metric">
                      <span class="pp-k">本次运行</span>
                      <div class="pp-mv">
                        <template v-if="runDuration.h !== '—'">
                          <b class="pp-big">{{ runDuration.h }}</b><em>h</em>
                          <b class="pp-big">{{ runDuration.m }}</b><em>min</em>
                        </template>
                        <b v-else class="pp-big">—</b>
                      </div>
                    </div>
                  </div>
                  <template v-if="activeEquip">
                    <div class="pp-sec">运维情况</div>
                    <div class="pp-cards">
                      <div class="pp-card amber link" @click="$router.push('/repair/list')">
                        <span class="pp-k">未闭环工单</span>
                        <span class="pp-v">
                          <b class="pp-big warn">{{ ops?.open_repairs ?? 0 }}</b><em>单</em>
                          <el-icon class="pp-arrow"><ArrowRight /></el-icon>
                        </span>
                      </div>
                      <div class="pp-card blue link" @click="$router.push('/alarm/realtime')">
                        <span class="pp-k">未闭环告警</span>
                        <span class="pp-v">
                          <b class="pp-big">{{ ops?.open_alarms ?? 0 }}</b><em>条</em>
                          <el-icon class="pp-arrow"><ArrowRight /></el-icon>
                        </span>
                      </div>
                    </div>
                  </template>
                  <div v-if="!activeEquip" class="pp-empty">台账未收录该泵组，仅展示实时状态</div>
                </div>
                <div class="pp-foot pp-foot-row">
                  <span class="pp-live"><i></i>实时更新</span>
                  <button
                    class="pp-btn is-plain"
                    :disabled="!activeEquip?.id"
                    @click="
                      activeEquip?.id && $router.push({
                        path: '/equipment/list',
                        query: { equipment_id: String(activeEquip.id) },
                      })
                    "
                  >
                    <span>查看详情</span><el-icon><ArrowRight /></el-icon>
                  </button>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- 右列：我的告警 / 待办工单 / 巡检 / 维保 -->
        <div class="op-side">
        <!-- 我的告警 -->
        <div class="panel panel-alarm dash-card" style="--i: 1">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:alarm-warning-line" /></span>
              我的告警
            </div>
            <el-link type="primary" underline="never" class="more" @click="$router.push('/alarm/realtime')">
              更多 <el-icon><ArrowRight /></el-icon>
            </el-link>
          </div>
          <div class="mini-scroll">
            <table class="mini-table">
            <thead>
              <tr>
                <th style="width: 82px">发生时间</th>
                <th>告警内容</th>
                <th style="width: 52px; text-align: center">等级</th>
                <th style="width: 58px; text-align: center">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="a in alarms"
                :key="a.id"
                @click="$router.push({ path: '/alarm/realtime', query: { focus: String(a.id) } })"
              >
                <td class="t-time">{{ fmtTime(a.alarm_time) }}</td>
                <td class="t-main" :title="a.rule_name">{{ a.rule_name }}</td>
                <td style="text-align: center">
                  <span class="tag no-dot" :class="levelClass(a.alarm_level)">{{ levelText(a.alarm_level) }}</span>
                </td>
                <td style="text-align: center">
                  <span class="tag" :class="alarmStatusClass(a.alarm_status)">
                    {{ alarmStatusText(a.alarm_status) }}
                  </span>
                </td>
              </tr>
              <tr v-if="alarms.length === 0">
                <td colspan="4" class="t-empty">暂无告警</td>
              </tr>
            </tbody>
            </table>
          </div>
        </div>

        <!-- 我的待办工单 -->
        <div class="panel panel-repair dash-card" style="--i: 2">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:file-list-3-line" /></span>
              我的待办工单
            </div>
            <el-link type="primary" underline="never" class="more" @click="$router.push('/repair/list')">
              更多 <el-icon><ArrowRight /></el-icon>
            </el-link>
          </div>
          <div class="mini-scroll">
            <table class="mini-table">
            <thead>
              <tr>
                <th style="width: 82px">创建时间</th>
                <th>工单内容</th>
                <th style="width: 52px; text-align: center">类型</th>
                <th style="width: 58px; text-align: center">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in repairs"
                :key="r.id"
                @click="$router.push({ path: '/repair/list', query: { focus: r.order_no } })"
              >
                <td class="t-time">{{ fmtTime(r.apply_time) }}</td>
                <td class="t-main" :title="r.name">{{ r.name }}</td>
                <td style="text-align: center">
                  <span class="tag no-dot" :class="repairTypeClass(r.repair_type)">{{ repairTypeText(r.repair_type) }}</span>
                </td>
                <td style="text-align: center">
                  <span class="tag" :class="repairStatusClass(r.process_status)">
                    {{ repairStatusText(r.process_status) }}
                  </span>
                </td>
              </tr>
              <tr v-if="repairs.length === 0">
                <td colspan="4" class="t-empty">暂无待处理工单</td>
              </tr>
            </tbody>
            </table>
          </div>
        </div>

        <!-- 我的巡检任务 -->
        <div class="panel panel-insp dash-card" style="--i: 3">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:list-check-2" /></span>
              我的巡检任务
            </div>
            <el-link type="primary" underline="never" class="more" @click="$router.push('/inspection/tasks')">
              更多 <el-icon><ArrowRight /></el-icon>
            </el-link>
          </div>
          <div class="mini-scroll">
            <table class="mini-table">
            <thead>
              <tr>
                <th style="width: 82px">任务日期</th>
                <th>计划名称</th>
                <th style="width: 62px; text-align: center">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in inspections"
                :key="t.id"
                @click="$router.push('/inspection/tasks')"
              >
                <td class="t-time">{{ t.task_date }}</td>
                <td class="t-main" :title="t.plan_name">{{ t.plan_name }}</td>
                <td style="text-align: center">
                  <span class="tag" :class="inspStatusClass(t.task_status)">
                    {{ inspStatusText(t.task_status) }}
                  </span>
                </td>
              </tr>
              <tr v-if="inspections.length === 0">
                <td colspan="3" class="t-empty">暂无待办巡检</td>
              </tr>
            </tbody>
            </table>
          </div>
        </div>

        <!-- 我的维保任务 -->
        <div class="panel panel-maint dash-card" style="--i: 4">
          <div class="panel-head">
            <div class="panel-title">
              <span class="ph-icon"><ArtSvgIcon icon="ri:tools-line" /></span>
              我的维保任务
            </div>
            <el-link type="primary" underline="never" class="more" @click="$router.push('/maintenance/plans')">
              更多 <el-icon><ArrowRight /></el-icon>
            </el-link>
          </div>
          <div class="mini-scroll">
            <table class="mini-table">
            <thead>
              <tr>
                <th style="width: 82px">截止日期</th>
                <th>维保计划</th>
                <th style="width: 62px; text-align: center">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in maintTodos"
                :key="t.id"
                @click="$router.push('/maintenance/plans')"
              >
                <td class="t-time">{{ t.due_date || '—' }}</td>
                <td class="t-main" :title="t.plan_name">{{ t.plan_name || t.equipment_name || '—' }}</td>
                <td style="text-align: center">
                  <span class="tag tag-blue">待执行</span>
                </td>
              </tr>
              <tr v-if="maintTodos.length === 0">
                <td colspan="3" class="t-empty">暂无待办维保</td>
              </tr>
            </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>
    </template>
    </div>
    <!-- 内容承载层结束 -->

    <!-- 泵站工艺流程全屏弹窗 -->
    <ProDialog
      v-model="stageFullscreen"
      title="泵站工艺流程及设备运行状态"
      fullscreen
      append-to-body
      destroy-on-close
      class="stage-dialog"
      hide-footer
    >
      <div class="stage-fullscreen-body">
        <!-- 与首页舞台一致：窄屏（≤800px）内容保持 640px 最小宽度横向滚动 -->
        <div class="ps-scroll">
          <div class="ps-content">
            <img :src="oneImg" alt="泵站工艺流程" draggable="false" />
            <div v-if="activePump" class="pump-backdrop" @click="closePanel" />
            <div
              v-for="(p, i) in pumps"
              :key="p.label"
              class="pump-badge"
              :class="{ active: activePumpIdx === i, 'is-on': p.running, 'is-off': !p.running }"
              :style="{ left: pumpPos[i] }"
              @click="onPumpClick(i)"
            >
              <span class="pb-ico">
                <svg class="pb-pump" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="9.4" r="5.6" />
                  <circle cx="12" cy="9.4" r="1.7" />
                  <path d="M12 3.8v3.9M12 11.1v3.9M5.8 9.4h3.4M14.8 9.4h3.4" />
                  <path d="M9.4 15l-1.4 5M14.6 15l1.4 5M7 20h10" />
                </svg>
              </span>
              <span class="pb-main">
                <span class="pb-line">
                  <span class="p-name">{{ p.label }}</span>
                  <span class="p-state" :class="p.running ? 'ok' : 'off'">
                    <i class="pb-dot"></i>{{ p.running ? '运行中' : '停止' }}
                  </span>
                </span>
                <span class="p-code">{{ pumpCode(p) }}</span>
              </span>
            </div>
          </div>
        </div>
        <Transition name="pump-panel" :duration="{ enter: 280, leave: 0 }">
          <div v-if="activePump" class="pump-panel" :class="activePump.running ? 'is-on' : 'is-off'" :style="{ '--pp-x': panelX }" @click.stop>
            <div class="pp-head">
                <span class="pp-ico">
                  <svg class="pp-pump" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="9.4" r="5.6" />
                    <circle cx="12" cy="9.4" r="1.7" />
                    <path d="M12 3.8v3.9M12 11.1v3.9M5.8 9.4h3.4M14.8 9.4h3.4" />
                    <path d="M9.4 15l-1.4 5M14.6 15l1.4 5M7 20h10" />
                  </svg>
                </span>
                <div class="pp-hmain">
                  <div class="pp-tline">
                    <span class="pp-title">{{ activePump.label }}</span>
                    <!-- 运行状态心电图（与设备台账详情一致）：运行中绿波扫描，停止红线 -->
                    <div class="pp-ecg" :class="activePump.running ? 'is-running' : 'is-stopped'">
                      <svg class="ecg-svg" viewBox="0 0 132 28" preserveAspectRatio="none" aria-hidden="true">
                        <path class="ecg-flat" :d="activePump.running ? ECG_PATH : ECG_FLAT_PATH" />
                        <path v-if="activePump.running" class="ecg-pulse" :d="ECG_PATH" />
                      </svg>
                      <span class="ecg-text">{{ activePump.running ? '运行中' : '停止' }}</span>
                    </div>
                  </div>
                  <div class="pp-sub">
                    {{ activeEquip?.code || '—' }} · {{ activeEquip?.type_name || '泵组' }}
                  </div>
                </div>
                <button
                  type="button"
                  class="pp-close"
                  aria-label="关闭"
                  @click.stop="closePanel"
                >
                  <el-icon><Close /></el-icon>
                </button>
              </div>
              <div class="pp-body">
                <div class="pp-metrics">
                  <div class="pp-metric">
                    <span class="pp-k">运行电流</span>
                    <div class="pp-mv"><b class="pp-big">{{ mCurrent }}</b><em>A</em></div>
                  </div>
                  <div class="pp-metric">
                    <span class="pp-k">有功功率</span>
                    <div class="pp-mv"><b class="pp-big">{{ mPower }}</b><em>kW</em></div>
                  </div>
                  <div class="pp-metric">
                    <span class="pp-k">轴承温度</span>
                    <div class="pp-mv"><b class="pp-big">{{ mTemp }}</b><em>℃</em></div>
                  </div>
                  <div class="pp-metric">
                    <span class="pp-k">本次运行</span>
                    <div class="pp-mv">
                      <template v-if="runDuration.h !== '—'">
                        <b class="pp-big">{{ runDuration.h }}</b><em>h</em>
                        <b class="pp-big">{{ runDuration.m }}</b><em>min</em>
                      </template>
                      <b v-else class="pp-big">—</b>
                    </div>
                  </div>
                </div>
                <template v-if="activeEquip">
                  <div class="pp-sec">运维情况</div>
                  <div class="pp-cards">
                    <div class="pp-card amber link" @click="$router.push('/repair/list')">
                      <span class="pp-k">未闭环工单</span>
                      <span class="pp-v">
                        <b class="pp-big warn">{{ ops?.open_repairs ?? 0 }}</b><em>单</em>
                        <el-icon class="pp-arrow"><ArrowRight /></el-icon>
                      </span>
                    </div>
                    <div class="pp-card blue link" @click="$router.push('/alarm/realtime')">
                      <span class="pp-k">未闭环告警</span>
                      <span class="pp-v">
                        <b class="pp-big">{{ ops?.open_alarms ?? 0 }}</b><em>条</em>
                        <el-icon class="pp-arrow"><ArrowRight /></el-icon>
                      </span>
                    </div>
                  </div>
                </template>
                <div v-if="!activeEquip" class="pp-empty">台账未收录该泵组，仅展示实时状态</div>
              </div>
              <div class="pp-foot pp-foot-row">
                <span class="pp-live"><i></i>实时更新</span>
                <button
                  class="pp-btn is-plain"
                  :disabled="!activeEquip?.id"
                  @click="
                    activeEquip?.id && $router.push({
                      path: '/equipment/list',
                      query: { equipment_id: String(activeEquip.id) },
                    })
                  "
                >
                  <span>查看详情</span><el-icon><ArrowRight /></el-icon>
                </button>
              </div>
          </div>
        </Transition>
      </div>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import echarts from '@/utils/echarts'
import {
  ArrowRight,
  Close,
  FullScreen,
} from '@element-plus/icons-vue'
import {
  fetchDashboardOverview,
  fetchEnergyTrend,
  fetchEquipmentOps,
  type DashboardOverview,
  type EquipmentOps,
  type PumpStatus,
} from '@/api/dashboard'
import { fetchEquipmentSnapshot, listEquipment, type EquipmentItem, type EquipmentSnapshot } from '@/api/equipment'
import { fetchEnergyStats } from '@/api/energy'
import { fetchWaterStats } from '@/api/water'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ProDialog from '@/components/ProDialog.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import {
  HYDRO_COLORS,
  hydroTooltip,
  hydroGrid,
  hydroCategoryAxis,
  hydroValueAxis,
  hydroLineSeries,
  hydroBarSeries,
  initMotionChart,
} from '@/utils/chartTheme'
import oneImg from '@/assets/img/one.webp'
import noDataImg from '@/assets/img/noData.png'
import { formatDateTime } from '@/utils/time'
import { usePermissions } from '@/utils/permissions'

/* 角色界面矩阵（终版）：操作员=我的任务视角；领导/超管=同一全局总览 */
const { roleCode } = usePermissions()
const isOperator = computed(() => roleCode.value === 'operator')

/* 泵组锚点：全局统一使用 one.webp（1859×846），以下为实测五台机组横向中心
   （截图像素级测量：徽章白卡中心与机组中轴逐一对齐后标定）。
   管理员/领导与操作员的机组运行状态分开展示（权限判断），两套锚点独立维护，避免一处调整影响另一处 */
const PUMP_POS_ADMIN = ['11%', '31%', '50%', '69.4%', '89.2%']
const PUMP_POS_OPERATOR = ['11%', '31%', '50%', '69.4%', '89.2%']
const pumpPos = computed(() => (isOperator.value ? PUMP_POS_OPERATOR : PUMP_POS_ADMIN))

/** 运行状态心电图波形（与设备台账详情 ListView 保持一致） */
const ECG_PATH =
  'M0 14 H14 L18 14 L21 4 L25 24 L29 8 L33 18 L37 14 H52 L56 14 L59 4 L63 24 L67 8 L71 18 L75 14 H90 L94 14 L97 4 L101 24 L105 8 L109 18 L113 14 H132'
const ECG_FLAT_PATH = 'M0 14 H132'

const loading = ref(false)
/* 分栏从左到右渐进显示开关：挂载即置位，替代原整页 v-loading 转圈 */
const pageReady = ref(false)
const data = ref<DashboardOverview | null>(null)
const energyRange = ref<'day' | 'week' | 'month'>('day')
const stageFullscreen = ref(false)

/* ===== 泵组点击交互：台账匹配 + 信息面板 ===== */
const activePumpIdx = ref<number | null>(null)
const equipmentList = ref<EquipmentItem[]>([])

const activePump = computed(() =>
  activePumpIdx.value != null ? (pumps.value[activePumpIdx.value] ?? null) : null,
)

/** 泵组按后端下发的 equipment_id 直接关联台账（「1#泵」仅是展示编号，与设备名无关） */
const activeEquip = computed(() => {
  const p = activePump.value
  if (!p) return undefined
  return equipmentList.value.find((e) => e.id === p.equipment_id)
})

function onPumpClick(i: number) {
  activePumpIdx.value = activePumpIdx.value === i ? null : i
}

/** 关闭详情弹窗（右上角 X） */
function closePanel() {
  activePumpIdx.value = null
}

/** 徽章第二行设备编码（台账未收录时留空） */
function pumpCode(p: PumpStatus): string {
  return equipmentList.value.find((e) => e.id === p.equipment_id)?.code || ''
}

/** 信息面板水平锚定到选中的泵体（设计图：面板浮在泵组上方居中） */
const panelX = computed(() =>
  activePumpIdx.value != null ? pumpPos.value[activePumpIdx.value] : '50%',
)

/* 信息卡③段：选中设备变化时拉取运维画像 + 实时快照（运行态与关键测点） */
const ops = ref<EquipmentOps | null>(null)
const snapshot = ref<EquipmentSnapshot | null>(null)
const runState = computed(() => snapshot.value?.run_state ?? null)
/** 运行时长的时/分拆分（设计图：2 h 18 min） */
const runDuration = computed(() => {
  if (!runState.value?.since) return { h: '—', m: '' }
  const sec = runState.value.continuous_seconds
  return { h: String(Math.floor(sec / 3600)), m: String(Math.floor((sec % 3600) / 60)) }
})
/** 关键指标：后端按 point_mapping 规则映射下发，前端只做展示格式化 */
function metricText(key: 'current' | 'power' | 'bearing_temp'): string {
  const m = snapshot.value?.metrics?.[key]
  if (!m || m.value === null || m.value === undefined) return '—'
  return Number(m.value).toFixed(1)
}
const mCurrent = computed(() => metricText('current'))
const mPower = computed(() => metricText('power'))
const mTemp = computed(() => metricText('bearing_temp'))
watch(activeEquip, async (eq) => {
  ops.value = null
  snapshot.value = null
  if (!eq) return
  const [opsRes, snapRes] = await Promise.allSettled([
    fetchEquipmentOps(eq.id),
    fetchEquipmentSnapshot(eq.id),
  ])
  ops.value = opsRes.status === 'fulfilled' ? opsRes.value.data.data : null
  snapshot.value = snapRes.status === 'fulfilled' ? snapRes.value.data.data : null
})

async function loadEquipment() {
  try {
    const { data: res } = await listEquipment({ page: 1, page_size: 200 })
    equipmentList.value = res.data.items || []
  } catch {
    equipmentList.value = []
  }
}

const pumps = computed<PumpStatus[]>(() => data.value?.pumps ?? [])
const alarms = computed(() => (data.value?.todos.alarms ?? []).slice(0, 5))
const repairs = computed(() => (data.value?.todos.repairs ?? []).slice(0, 5))
const inspections = computed(() => (data.value?.todos.inspections ?? []).slice(0, 5))
const maintTodos = computed(() => (data.value?.todos.maintenances ?? []).slice(0, 5))

/* ===== 主区近 7 日供水量图数据 ===== */
interface EnergyDayStats {
  labels: string[]
  electricity_kwh: (number | null)[]
  water_m3: (number | null)[]
  ratio: (number | null)[]
}
const energyDayStats = ref<EnergyDayStats | null>(null)

/* ===== 供水量 · 计划对比图数据（近 7 日） ===== */
interface WaterDayStats {
  labels: string[]
  actual: number[]
  plan: (number | null)[]
  unit: string
}
const waterDayStats = ref<WaterDayStats | null>(null)

/** 近 7 日供水量柱状图（/energy/stats 默认窗口即近 7 天，最后一天为今日） */
const water7 = computed(() => {
  const s = energyDayStats.value
  const values = (s?.water_m3 ?? []).map((v) => v ?? 0)
  const labels = (s?.labels ?? []).map((l) => l.slice(5).replace('-', '/'))
  return { labels, values, max: Math.max(1, ...values) }
})

/** 待办分类四行：计数与 KPI 同源（overview.counts），点击直达对应页面 */
const todoCats = computed(() => {
  const c = data.value?.counts
  return [
    {
      label: '待处理告警',
      n: c?.active_alarms ?? 0,
      to: '/alarm/realtime',
      icon: 'ri:notification-3-line',
      color: '#FF626A',
      tint: 'rgba(255, 98, 106, 0.12)',
    },
    {
      label: '维修工单',
      n: c?.pending_repairs ?? 0,
      to: '/repair/list',
      icon: 'ri:file-list-3-line',
      color: '#FFAE39',
      tint: 'rgba(255, 174, 57, 0.14)',
    },
    {
      label: '待巡检任务',
      n: c?.pending_inspections ?? 0,
      to: '/inspection/tasks',
      icon: 'ri:list-check-2',
      color: '#347DFF',
      tint: 'rgba(52, 125, 255, 0.12)',
    },
    {
      label: '待验收维保',
      n: c?.pending_maintenances ?? 0,
      to: '/maintenance/plans',
      icon: 'ri:tools-line',
      color: '#26B6F5',
      tint: 'rgba(38, 182, 245, 0.12)',
    },
  ]
})

/* 我的任务分布（操作员底部卡）：四类待办横向条，计数与 KPI 同源，点击直达页面 */
const myTaskDist = computed(() => {
  const c = data.value?.counts
  const items = [
    { label: '待办工单', value: c?.pending_repairs ?? 0, color: '#FFAE39', to: '/repair/list' },
    { label: '待办告警', value: c?.active_alarms ?? 0, color: '#FF626A', to: '/alarm/realtime' },
    { label: '待办巡检', value: c?.pending_inspections ?? 0, color: '#347DFF', to: '/inspection/tasks' },
    { label: '待办维保', value: c?.pending_maintenances ?? 0, color: '#26B6F5', to: '/maintenance/plans' },
  ]
  const max = Math.max(1, ...items.map((i) => i.value))
  // 非零项保底 6% 宽度，避免「有任务但条形不可见」
  return items.map((i) => ({
    ...i,
    pct: i.value === 0 ? 0 : Math.max(6, Math.round((i.value / max) * 100)),
  }))
})

function inspStatusText(s: string) {
  const m: Record<string, string> = { pending: '待执行', overdue: '已逾期', done: '已完成' }
  return m[s] || s
}
function inspStatusClass(s: string) {
  const m: Record<string, string> = { pending: 'tag-blue', overdue: 'tag-red', done: 'tag-green' }
  return m[s] || 'tag-gray'
}

interface KpiCardItem {
  label: string
  value: string | number
  unit: string
  color: string
  tint: string
  icon: string
  /** 点击跳转路由（操作员我的任务卡） */
  to?: string
  /** 右上角状态胶囊文案 */
  tag?: string
  /** 胶囊语气：ok 绿 / warn 橙 / danger 红 / info 蓝 */
  tone?: 'ok' | 'warn' | 'danger' | 'info'
  /** 副行说明文字 */
  sub?: string
  /** 副行进度条百分比 0-100（null 不渲染） */
  percent?: number | null
  /** 泵组点阵：true=运行中，false=停机（仅操作员泵站状态卡使用） */
  dots?: boolean[]
  /** 运行正常对勾徽章（设计稿右列 KPI 首卡） */
  check?: boolean
  /** 强调卡：放大数值与图标 */
  primary?: boolean
  /** 双指标（进出水流量）：k=标签，v=数值，unit=单位 */
  pair?: { k: string; v: string; unit: string }[]
  /** 底部计数点（如 运行中 / 停机 台数） */
  footDots?: { tone: 'ok' | 'off'; text: string }[]
  /** 设计稿配色皮肤（右侧「选择日期数据总览」四卡） */
  skin?: 'status' | 'flow' | 'alarm' | 'equip'
}

const kpiCards = computed<KpiCardItem[]>(() => {
  const d = data.value
  const pumpRunning = pumps.value.filter((p) => p.running).length
  // 操作员：我的任务 KPI（计数已由后端按 assignee 收窄），点击直达对应页面
  if (isOperator.value) {
    const myRepair = d?.counts.pending_repairs ?? 0
    const myAlarm = d?.counts.active_alarms ?? 0
    const myInsp = d?.counts.pending_inspections ?? 0
    const myMaint = d?.counts.pending_maintenances ?? 0
    const pumpTotal = pumps.value.length || 5
    const todoTag = (n: number) => (n > 0 ? '待处理' : '已清零')
    const todoTone = (n: number) => (n > 0 ? 'warn' : 'ok') as 'warn' | 'ok'
    return [
      {
        label: '我的待办工单',
        value: myRepair,
        unit: '条',
        color: '#FFAE39',
        tint: 'rgba(255, 174, 57, 0.14)',
        icon: 'ri:file-list-3-line',
        to: '/repair/list',
        tag: todoTag(myRepair),
        tone: todoTone(myRepair),
        sub: '点击进入全部工单',
      },
      {
        label: '我的待办告警',
        value: myAlarm,
        unit: '条',
        color: '#FF626A',
        tint: 'rgba(255, 98, 106, 0.12)',
        icon: 'ri:notification-3-line',
        to: '/alarm/realtime',
        tag: todoTag(myAlarm),
        tone: todoTone(myAlarm),
        sub: '点击进入告警中心',
      },
      {
        label: '我的待办巡检',
        value: myInsp,
        unit: '项',
        color: '#347DFF',
        tint: 'rgba(52, 125, 255, 0.12)',
        icon: 'ri:list-check-2',
        to: '/inspection/tasks',
        tag: todoTag(myInsp),
        tone: todoTone(myInsp),
        sub: '点击进入巡检任务',
      },
      {
        label: '我的待办维保',
        value: myMaint,
        unit: '项',
        color: '#26B6F5',
        tint: 'rgba(38, 182, 245, 0.12)',
        icon: 'ri:tools-line',
        to: '/maintenance/plans',
        tag: todoTag(myMaint),
        tone: todoTone(myMaint),
        sub: '点击进入维保计划',
      },
      {
        label: '今日告警',
        value: d?.today_alarm_count ?? 0,
        unit: '条',
        color: '#FF626A',
        tint: 'rgba(255, 98, 106, 0.12)',
        icon: 'ri:alarm-warning-line',
        to: '/alarm/realtime',
        tag: (d?.today_alarm_count ?? 0) > 0 ? '需关注' : '无异常',
        tone: (d?.today_alarm_count ?? 0) > 0 ? 'warn' : 'ok',
        sub: '今日累计告警条数',
      },
      {
        label: '泵站状态',
        value: pumpRunning > 0 ? '运行正常' : '已停运',
        unit: '',
        color: pumpRunning > 0 ? '#28C76F' : '#94a3b8',
        tint: 'rgba(40, 199, 111, 0.14)',
        icon: 'ri:pulse-line',
        tag: pumpRunning > 0 ? '实时在线' : '离线',
        tone: pumpRunning > 0 ? 'ok' : 'danger',
        dots: pumps.value.map((p) => !!p.running),
        sub: `${pumpRunning} / ${pumpTotal} 台运行`,
        primary: true,
      },
    ]
  }
  // 领导/超管首页不再使用 KPI 卡，实时指标统一由工艺图与列表承载
  return []
})

function fmtNum(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function fmtTime(s?: string) {
  return formatDateTime(s, false)
}

/** 窄表格用短时间：MM-DD HH:mm */
function fmtShortTime(s?: string) {
  const t = fmtTime(s)
  return t.length >= 16 ? t.slice(5, 16) : t
}

/* ===== 状态/等级映射 ===== */
function levelText(lv: number) {
  return ['', '紧急', '一般', '提示'][lv] || '提示'
}
function levelClass(lv: number) {
  return ['', 'tag-red', 'tag-orange', 'tag-blue'][lv] || 'tag-blue'
}
function alarmStatusText(s: string) {
  const m: Record<string, string> = {
    pending: '待处理',
    processing: '处理中',
    pending_accept: '待验收',
    resolved: '已处理',
    closed: '已处理',
    rejected: '已驳回',
    reopened: '重新处理中',
  }
  return m[s] || s
}
function alarmStatusClass(s: string) {
  const m: Record<string, string> = {
    pending: 'tag-orange',
    processing: 'tag-blue',
    pending_accept: 'tag-blue',
    resolved: 'tag-green',
    closed: 'tag-green',
    rejected: 'tag-gray',
    reopened: 'tag-blue',
  }
  return m[s] || 'tag-gray'
}
function repairTypeText(t?: string) {
  const m: Record<string, string> = {
    overhaul: '维修',
    maintenance: '维保',
    inspection: '巡检',
    fault: '抢修',
  }
  return m[t || ''] || '维修'
}
function repairTypeClass(t?: string) {
  const m: Record<string, string> = {
    overhaul: 'tag-red',
    maintenance: 'tag-orange',
    inspection: 'tag-blue',
    fault: 'tag-red',
  }
  return m[t || ''] || 'tag-red'
}
function repairStatusText(s: string) {
  const m: Record<string, string> = {
    pending_approval: '待审批',
    pending_dispatch: '待派单',
    processing: '处理中',
    pending_accept: '待验收',
    archived: '已归档',
    rejected: '已驳回',
  }
  return m[s] || s
}
function repairStatusClass(s: string) {
  const m: Record<string, string> = {
    pending_approval: 'tag-orange',
    pending_dispatch: 'tag-orange',
    processing: 'tag-blue',
    pending_accept: 'tag-blue',
    archived: 'tag-gray',
    rejected: 'tag-gray',
  }
  return m[s] || 'tag-gray'
}

/* ===== 图表 ===== */
const flowRef = ref<HTMLDivElement | null>(null)
const energyRef = ref<HTMLDivElement | null>(null)
let flowChart: echarts.ECharts | null = null
let energyChart: echarts.ECharts | null = null

/** 水位趋势空态：24h 窗口内两条线均无有效均值 */
const flowEmpty = computed(() => {
  const ft = data.value?.flow_trend_24h
  return !ft || ft.series.every((s) => s.data.every((v) => v === null))
})
/** 能耗趋势空态：按日/周/月切换后同步刷新 */
const energyEmpty = ref(true)

/* 新增两图：供水计划对比 / 电耗·吨水电耗 双轴 */
const supplyRef = ref<HTMLDivElement | null>(null)
const dualRef = ref<HTMLDivElement | null>(null)
let supplyChart: echarts.ECharts | null = null
let dualChart: echarts.ECharts | null = null
const supplyEmpty = ref(true)
const dualEmpty = ref(true)

function axisLabelColor() {
  return '#8a97a8'
}

/** 设计稿：折线末端数值胶囊（ colored pill，取最后一个有效值） */
function endPill(color: string, unit: string) {
  return {
    show: true,
    formatter: (p: { value: unknown }) => {
      const v = Array.isArray(p.value) ? p.value[1] : p.value
      return v == null ? '' : `${fmtNum(Number(v))} ${unit}`
    },
    color: '#fff',
    backgroundColor: color,
    padding: [3, 7] as [number, number],
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600 as const,
    distance: 6,
  }
}

function renderFlowChart() {
  const ft = data.value?.flow_trend_24h
  if (!flowRef.value || !ft) return
  if (!flowChart) flowChart = initMotionChart(flowRef.value)
  const colors = [HYDRO_COLORS.blue, HYDRO_COLORS.cyan]
  const labelColor = axisLabelColor()
  flowChart.setOption({
    tooltip: {
      trigger: 'axis',
      ...hydroTooltip,
      axisPointer: { lineStyle: { color: 'rgba(6,182,212,.35)', type: 'dashed' } },
    },
    legend: {
      top: 0,
      left: 'center',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#5b6b82', fontSize: 12 },
    },
    grid: { ...hydroGrid, right: 64 },
    xAxis: hydroCategoryAxis(ft.labels, {
      axisLabel: { color: labelColor, fontSize: 11, interval: 2 },
    }),
    yAxis: hydroValueAxis({
      min: 0,
      axisLabel: { color: labelColor, fontSize: 11 },
    }),
    series: ft.series.map((s, i) => ({
      ...hydroLineSeries(s.name, s.data, colors[i % 2]),
      endLabel: endPill(colors[i % 2], ft.unit),
    })),
  })
}

function renderEnergyChart(et?: DashboardOverview['energy_trend']) {
  const e = et ?? data.value?.energy_trend
  energyEmpty.value = !e || e.data.every((v) => v === null)
  if (!energyRef.value || !e) return
  if (!energyChart) energyChart = initMotionChart(energyRef.value)
  const labelColor = axisLabelColor()
  energyChart.setOption({
    tooltip: { trigger: 'axis', ...hydroTooltip },
    grid: { ...hydroGrid, top: 18, right: 64 },
    xAxis: {
      ...hydroCategoryAxis(e.labels, {
        boundaryGap: false,
        axisLabel: { color: labelColor, fontSize: 11, interval: e.granularity === 'day' ? 2 : 3 },
      }),
    },
    yAxis: hydroValueAxis({
      min: 0,
      axisLabel: { color: labelColor, fontSize: 11 },
    }),
    // 设计稿：蓝色面积折线（非柱状）
    series: [{ ...hydroLineSeries('能耗', e.data, HYDRO_COLORS.blue), endLabel: endPill(HYDRO_COLORS.blue, e.unit) }],
  })
}

/** 日期标签 2026-11-03 → 11/03 */
function shortDay(l: string) {
  return l.slice(5).replace('-', '/')
}

/** 供水量 · 计划对比：双柱（实际/计划），计划缺失当天留空不画 */
function renderSupplyChart() {
  const s = waterDayStats.value
  supplyEmpty.value = !s || !s.labels.length || s.actual.every((v) => !v)
  if (!supplyRef.value || !s) return
  if (!supplyChart) supplyChart = initMotionChart(supplyRef.value)
  const labelColor = axisLabelColor()
  supplyChart.setOption(
    {
      tooltip: {
        trigger: 'axis',
        ...hydroTooltip,
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(14,127,240,.06)' } },
        valueFormatter: (v: unknown) => (v == null ? '—' : `${fmtNum(Number(v))} ${s.unit}`),
      },
      legend: {
        top: 0,
        left: 'center',
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 6,
        itemGap: 14,
        textStyle: { color: '#5b6b82', fontSize: 11 },
      },
      grid: { ...hydroGrid, top: 26, right: 16 },
      xAxis: hydroCategoryAxis(s.labels.map(shortDay), {
        boundaryGap: true,
        axisLabel: { color: labelColor, fontSize: 11, interval: 0 },
      }),
      yAxis: hydroValueAxis({
        min: 0,
        axisLabel: { color: labelColor, fontSize: 11 },
      }),
      series: [
        hydroBarSeries('实际供水', s.actual, HYDRO_COLORS.blue, { barGap: '18%' }),
        hydroBarSeries('计划供水', s.plan, HYDRO_COLORS.cyan, { barGap: '18%' }),
      ],
    },
    true,
  )
}

/** 电耗 · 吨水电耗：柱状电耗（左轴 kWh）+ 折线吨水电耗（右轴 kWh/m³） */
function renderDualChart() {
  const s = energyDayStats.value
  const hasEnergy = !!s && s.electricity_kwh.some((v) => v != null && v > 0)
  const hasRatio = !!s && s.ratio.some((v) => v != null && v > 0)
  dualEmpty.value = !s || (!hasEnergy && !hasRatio)
  if (!dualRef.value || !s) return
  if (!dualChart) dualChart = initMotionChart(dualRef.value)
  const labelColor = axisLabelColor()
  const ratioColor = HYDRO_COLORS.orange
  dualChart.setOption(
    {
      tooltip: {
        trigger: 'axis',
        ...hydroTooltip,
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(14,127,240,.06)' } },
      },
      legend: {
        top: 0,
        left: 'center',
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 6,
        itemGap: 14,
        textStyle: { color: '#5b6b82', fontSize: 11 },
      },
      grid: { ...hydroGrid, top: 26, right: 34 },
      xAxis: hydroCategoryAxis(s.labels.map(shortDay), {
        boundaryGap: true,
        axisLabel: { color: labelColor, fontSize: 11, interval: 0 },
      }),
      yAxis: [
        hydroValueAxis({
          min: 0,
          name: 'kWh',
          nameTextStyle: { color: labelColor, fontSize: 10, padding: [0, 0, 0, -20] },
          axisLabel: { color: labelColor, fontSize: 11 },
        }),
        hydroValueAxis({
          min: 0,
          name: 'kWh/m³',
          nameTextStyle: { color: labelColor, fontSize: 10, padding: [0, -14, 0, 0] },
          axisLabel: { color: labelColor, fontSize: 11 },
          splitLine: { show: false },
        }),
      ],
      series: [
        hydroBarSeries('电耗', s.electricity_kwh, HYDRO_COLORS.blue),
        {
          name: '吨水电耗',
          type: 'line' as const,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: false,
          lineStyle: { width: 2.5, color: ratioColor },
          itemStyle: { color: ratioColor, borderColor: '#fff', borderWidth: 1.5 },
          emphasis: { focus: 'series' as const },
          data: s.ratio,
        },
      ],
    },
    true,
  )
}

function renderCharts() {
  renderFlowChart()
  renderEnergyChart()
  renderSupplyChart()
  renderDualChart()
}

async function onEnergyRange() {
  const { data: resp } = await fetchEnergyTrend(energyRange.value)
  renderEnergyChart(resp.data)
}

async function load(showMask = false) {
  // 仅首屏展示全屏 loading；60s 后台静默刷新，避免遮罩反复闪烁
  if (showMask) loading.value = true
  try {
    const { data: resp } = await fetchDashboardOverview()
    data.value = resp.data
    lastUpdated.value = new Date()
    refreshStale.value = false
    await nextTick()
    renderCharts()
    // 主区 7 日供水量 / 电耗·吨水电耗：实时拉取，不受右栏日历影响
    fetchEnergyStats().then((res) => {
      energyDayStats.value = res.data.data as unknown as EnergyDayStats
      renderDualChart()
    }).catch(() => {})
    fetchWaterStats().then((res) => {
      waterDayStats.value = res.data.data as unknown as WaterDayStats
      renderSupplyChart()
    }).catch(() => {})
  } catch {
    // 刷新失败：保留已渲染数据，进入 stale 提示态
    refreshStale.value = true
  } finally {
    if (showMask) loading.value = false
  }
}

/* 实时数据新鲜度：记录最近成功刷新时间；刷新失败进入 stale 态（保留最后数据并提示） */
const lastUpdated = ref<Date | null>(null)
const refreshStale = ref(false)

/** 列表卡宽度自适应：按卡片实际宽度决定「状态」「等级」列是否显示，避免窄卡里表头/按钮被裁 */
const winW = ref(window.innerWidth)
const listsRef = ref<HTMLElement | null>(null)
const listsW = ref(0)
const showStatusCol = computed(() => listsW.value >= 374)
const showLevelCol = computed(() => listsW.value >= 298)

let listsRO: ResizeObserver | null = null
function observeLists() {
  if (!listsRef.value || typeof ResizeObserver === 'undefined') return
  listsRO = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w) listsW.value = Math.round(w)
  })
  listsRO.observe(listsRef.value)
}

function onResize() {
  flowChart?.resize()
  energyChart?.resize()
  supplyChart?.resize()
  dualChart?.resize()
  winW.value = window.innerWidth
}

let timer: number | undefined
let chartRO: ResizeObserver | undefined
onMounted(async () => {
  pageReady.value = true
  await load(true)
  loadEquipment()
  observeLists()
  window.addEventListener('resize', onResize)
  /* ResizeObserver：窗口/侧栏收缩/卡片布局变化时同步重算图表尺寸 */
  chartRO = new ResizeObserver(() => onResize())
  ;[flowRef.value, energyRef.value, supplyRef.value, dualRef.value].forEach(
    (el) => el && chartRO!.observe(el),
  )
  timer = window.setInterval(() => load(), 60000)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  chartRO?.disconnect()
  listsRO?.disconnect()
  if (timer) window.clearInterval(timer)
  flowChart?.dispose()
  energyChart?.dispose()
  supplyChart?.dispose()
  dualChart?.dispose()
})
</script>

<style scoped>
/* 页面随内容自然延展，允许垂直滚动；不强制固定高度避免内容重叠 */
.home {
  display: flex;
  flex-direction: column;
  /* 接入布局高度拉伸链（.page-content 为 flex column，其余页面经 .page 接入）：
     高度取 flex 分配值（确定值，供 grid fr 行解析），不足一屏时撑满视口；
     内容超出（minmax 行下限兜底）时由 #app-main 自然滚动 */
  flex: 1 1 auto;
  min-height: 0;
}

/* 内容承载层：设计稿为平铺浅蓝底，卡片直接落在页面背景上（无大框磨砂容器）
   间距不再叠加：布局层 .page-content 已统一提供 20px（小屏 12px），与其他页面对齐 */
.home-content {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  /* 大屏一屏可见，高度不足时允许内部滚动 */
  overflow-y: auto;
  padding: 0;
}

.kpi-row {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 13px;
  margin-bottom: 13px;
  flex-shrink: 0;
}
/* 领导/超管五卡：单行五列（设计稿排版） */
.kpi-row.is-five {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

/* 实时数据新鲜度指示：正常绿点，断链橙点 */
.kpi-live {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin: 5px 2px 9px;
  color: #7a8ea8;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.kpi-live .kl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgb(34 197 94 / 60%);
}
.kpi-live.stale {
  color: #b86900;
}
.kpi-live.stale .kl-dot {
  background: #f59e0b;
  box-shadow: 0 0 6px rgb(245 158 11 / 60%);
}
.kpi-wave-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  /* 设计稿卡片高度固定 150px */
  height: 150px;
  padding: 15px 17px;
  overflow: hidden;
  /* 磨砂半透明卡面：透出底层背景，去左侧色轨 */
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.84) 0%, rgba(238, 247, 255, 0.72) 100%);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  border: 1px solid rgba(206, 224, 243, 0.85);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(55, 135, 220, 0.06);
  transition:
    transform 0.22s ease,
    box-shadow 0.22s ease,
    border-color 0.22s ease;
}
.kpi-wave-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--c) 24%, rgba(255, 255, 255, 0.8));
  box-shadow: 0 12px 30px rgba(55, 135, 220, 0.16);
}
/* 可点击 KPI 卡（操作员我的任务卡点击直达页面） */
.kpi-wave-card.clickable {
  cursor: pointer;
}
/* 强调卡（泵站总览）：描边略重 */
.kpi-wave-card.is-primary {
  border-color: color-mix(in srgb, var(--c) 18%, rgba(255, 255, 255, 0.8));
}

/* 头部行：图标徽章 + 标签 + 状态胶囊 */
.kw-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
/* 图标徽章：设计稿为浅色底 + 同色系线性图标（不再用实心渐变） */
.kw-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  color: var(--c);
  font-size: 19px;
  background: var(--t);
  border-radius: 10px;
}
.kw-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #6b7f9e;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 状态胶囊：按语气着色，ok 态带呼吸点（位于副行，与说明文字同行左起） */
.kw-tag {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  border-radius: 999px;
}
.kw-tag.is-ok {
  color: #1fae62;
  background: rgba(40, 199, 111, 0.14);
}
.kw-tag.is-warn {
  color: #b86900;
  background: rgba(255, 174, 57, 0.18);
}
.kw-tag.is-danger {
  color: #e0454d;
  background: rgba(255, 98, 106, 0.15);
}
.kw-tag.is-info {
  color: #2f6fd0;
  background: rgba(52, 125, 255, 0.12);
}
.kw-dot {
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: 50%;
  animation: kw-pulse 1.8s ease-in-out infinite;
}
@keyframes kw-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

/* 数字行：大数字居左，右侧迷你趋势图（设计稿核心结构） */
.kw-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.kw-value {
  position: relative;
  z-index: 1;
  flex: 0 1 auto;
  min-width: 0;
  color: #1b2c4d;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-family:
    'DIN Alternate', 'Bahnschrift', 'Helvetica Neue', 'PingFang SC', sans-serif;
}
.is-primary .kw-value {
  font-size: 32px;
}
.kw-unit {
  margin-left: 5px;
  color: #7184a2;
  font-size: 13px;
  font-weight: 400;
}

/* 双指标（进出水流量）：左右两组，标签在上、数值在下 */
.kw-pair {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-end;
  gap: 14px;
  min-width: 0;
}
.kw-pair-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.kp-k {
  color: #8496b2;
  font-size: 11px;
  white-space: nowrap;
}
.kp-v {
  overflow: hidden;
  color: #1b2c4d;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-family:
    'DIN Alternate', 'Bahnschrift', 'Helvetica Neue', 'PingFang SC', sans-serif;
}
.kp-v em {
  margin-left: 3px;
  color: #7184a2;
  font-size: 10.5px;
  font-style: normal;
  font-weight: 400;
}

/* 泵组状态点：绿=运行中，灰=停机（点阵随机组数量变化，通常 5 个） */
.kw-dots5 {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  margin-left: auto;
  padding-bottom: 6px;
}
.kw-dots5 i {
  width: 14px;
  height: 14px;
  background: #d3dbe6;
  border-radius: 50%;
  transition: background 0.3s ease;
}
.kw-dots5 i.on {
  background: var(--c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 18%, transparent);
}

/* 副行：进度条 + 说明文字 */
.kw-foot {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  min-width: 0;
  margin-top: auto;
  min-height: 16px;
}
.kw-sub {
  overflow: hidden;
  color: #8496b2;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 底部计数点（设计稿首卡）：绿点=运行中，灰点=停机 */
.kw-meta {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  color: #8496b2;
  font-size: 11.5px;
  white-space: nowrap;
}
.kw-meta i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.kw-meta i.ok {
  background: #1fae62;
}
.kw-meta i.off {
  background: #c3cedd;
}
/* ===== 主区网格：行1 左泵站(2/3)+右告警工单(1/3)，行2 底部三图全宽 ===== */
.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(340px, 1fr);
  /* 行高最小下限降低，确保在 home-content 内可收缩不溢出 */
  grid-template-rows: minmax(240px, 1.5fr) minmax(160px, 1fr);
  gap: 13px;
  min-height: 0;
  flex: 1 1 auto;
}
/* 行2：底部三图全宽 */
.charts-row {
  grid-column: 1 / -1;
  grid-row: 2;
}
/* 行1列2：综合告警 + 待处理工单，纵向均分 */
.right-col {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
/* 操作员首页：上=机组运行状态通栏工艺图｜下=四张待办卡横排
   行高按比例分配剩余视口高度（上图约 62%、下排四卡约 38%），整页纵向铺满无留白 */
.op-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(240px, 1.65fr) minmax(240px, 1fr);
  gap: 13px;
  flex: 1 1 auto;
  min-height: 0;
}
/* 通栏宽幅：图片区撑满整个卡片剩余高度，图片 cover 铺满通栏、不溢出；
   徽章以画布百分比定位，横向始终落在机组正上方 */
.op-grid .panel-stage {
  height: auto;
}
.op-grid .panel-stage .pump-stage {
  flex: none;
  height: auto;
}
.op-side {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 13px;
  min-width: 0;
}
.op-side > .panel {
  min-height: 240px;
}
@media only screen and (max-width: 1280px) {
  .op-side {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .op-side > .panel {
    min-height: 240px;
  }
}
@media only screen and (max-width: 768px) {
  .dash-grid .panel-stage .pump-stage {
    height: auto;
  }
  .op-grid .panel-stage .pump-stage {
    flex: none;
    height: auto;
  }
  .op-side {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* 操作员：四列表行（独立类，不与 .right-col 叠加，避免特异性冲突） */
.op-lists-row {
  grid-column: 1 / -1;
  grid-row: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.op-lists-row > .panel {
  min-width: 0;
}
/* 右列两卡：综合告警 + 待处理工单，flex 均分高度；超出部分在表格区内滚动 */
.panel-alarm,
.panel-repair,
.panel-insp,
.panel-maint {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
/* 表格滚动容器：内容超高自动垂直滚动，细窄主题色滚动条 */
.mini-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 152, 205, 0.4) transparent;
}
.mini-scroll::-webkit-scrollbar {
  width: 6px;
}
.mini-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.mini-scroll::-webkit-scrollbar-thumb {
  background: rgba(120, 152, 205, 0.4);
  border-radius: 3px;
}
.mini-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(120, 152, 205, 0.62);
}

/* ===== 卡片：磨砂玻璃（与维修工单模块同配方，无白底无边框） ===== */
.panel {
  padding: 14px 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  border: none;
  border-radius: 16px;
  box-shadow: 0 6px 24px rgba(55, 135, 220, 0.08);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--art-gray-900, #1b2a3d);
  font-size: 15px;
  font-weight: 700;
}
/* 标题前图标徽章：浅蓝底圆角小块（设计稿形制） */
.ph-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: #2f8bff;
  font-size: 13px;
  background: rgba(47, 139, 255, 0.12);
  border-radius: 6px;
}
.more {
  font-size: 12px;
}
.more .el-icon {
  font-size: 12px;
}
/* 面板头部操作区 */
.panel-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fs-btn {
  font-size: 16px;
  color: var(--art-gray-500, #8a97a8);
  cursor: pointer;
  transition: color 0.15s;
}
.fs-btn:hover {
  color: var(--mod-a, #0e7ff0);
}

/* 全屏弹窗工艺图铺满的 body 规则见文末非 scoped 样式块（append-to-body 传送后 scoped :deep 无法命中） */
.stage-fullscreen-body {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.stage-fullscreen-body img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

/* ===== 泵站大图：高度完全由图片自然比例决定，外层不再给任何固定高度 ===== */
.pump-stage {
  position: relative;
  /* 信息面板需要越出舞台高度展示，故不裁剪；圆角由图片自身承担 */
  overflow: visible;
  /* 高度由 img 自然比例撑高，外层不给固定值 */
  flex: none;
  height: auto;
  min-height: 0;
  border-radius: 12px;
}
/* 滚动层：默认静止；≤800px 开启横向滚动（见文末响应式段） */
.ps-scroll {
  width: 100%;
}
/* 内容层：徽章/遮罩/提示的定位与 cqw 换算基准 */
.ps-content {
  position: relative;
  width: 100%;
  container-type: inline-size;
}
/* 图片画布：徽章/遮罩的定位基准；宽高由 img 自然撑开 */
.ps-canvas {
  position: relative;
  width: 100%;
}
/* 核心修复：不用 object-fit！图片 width:100% + height:auto
   → 永远按原始比例 1859:846 显示，零裁切、零变形
   → 徽章的 left 百分比锚点（基于原始图实测）精确对准机组中心 */
.pump-stage img {
  display: block;
  width: 100%;
  height: auto;
  /* 删掉 object-fit: cover，不再裁切 */
  border-radius: 12px;
  user-select: none;
}
/* 透明遮罩：面板打开时点击空白关闭；位于图片之上、徽章之下 */
.pump-backdrop {
  position: absolute;
  inset: 0;
  z-index: 2;
}
/* 泵组徽章（设计图）：白色气泡卡，尾部指向泵体；运行中绿边、停止灰边 */
.pump-badge {
  position: absolute;
  z-index: 4;
  /* 徽章紧贴机组顶部：0.5H - 0.0221W - 27px（含尾部三角） */
  top: calc(50% - 2.21cqw - 27px);
  --bd: #c2ccd8;
  --rg: 148 163 184;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px 6px 8px;
  background: #fff;
  border: 1px solid var(--bd);
  border-radius: 10px;
  box-shadow: 0 4px 14px rgb(15 34 58 / 16%);
  transform: translate(-50%, -50%);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}
/* 状态配色：运行中绿色边框，停止灰色边框 */
.pump-badge.is-on {
  --bd: #22c55e;
  --rg: 34 197 94;
}
.pump-badge.is-off {
  --bd: #ff3b5c;
  --rg: 255 59 92;
}
.pump-badge::after {
  position: absolute;
  bottom: -9px;
  left: 50%;
  width: 16px;
  height: 16px;
  background: #fff;
  border-right: 1.5px solid var(--bd);
  border-bottom: 1.5px solid var(--bd);
  transform: translateX(-50%) rotate(45deg);
  content: '';
}
.pump-badge:hover {
  transform: translate(-50%, -56%);
  box-shadow: 0 10px 22px rgb(var(--rg) / 28%);
}
.pump-badge.active {
  box-shadow:
    0 0 0 3px rgb(var(--rg) / 18%),
    0 10px 24px rgb(var(--rg) / 28%);
}
.pump-badge .pb-ico {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--mod-a, #0e7ff0);
}
.pump-badge .pb-pump {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
.pump-badge .pb-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pump-badge .pb-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pump-badge .p-name {
  color: #1c2b3a;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
}
.pump-badge .p-state {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  color: #94a3b8;
  font-size: 10px;
  line-height: 1.15;
  white-space: nowrap;
  background: #f1f4f8;
  border-radius: 999px;
}
.pump-badge .p-state.ok {
  color: #16a34a;
  background: #e3f8e8;
}
.pump-badge .p-state.off {
  color: #ff3b5c;
  background: rgb(255 59 92 / 10%);
}
.pump-badge .pb-dot {
  width: 5px;
  height: 5px;
  background: currentcolor;
  border-radius: 50%;
}
.pump-badge .p-code {
  overflow: hidden;
  color: #8a97a8;
  font-size: 10px;
  line-height: 1.15;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 泵组信息面板（设计图）：浮在选中泵体上方居中，白底卡片 */
.pump-panel {
  position: absolute;
  top: 10px;
  left: clamp(172px, var(--pp-x, 50%), calc(100% - 172px));
  z-index: 6;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-height: min(560px, calc(100vh - 120px));
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--pp-bd, #2f7dff);
  border-radius: 14px;
  box-shadow:
    0 16px 40px -12px rgb(8 26 46 / 34%),
    0 2px 6px rgb(15 34 58 / 8%);
  transform: translateX(-50%);
}
/* 详情面板边框随泵组状态：运行中绿边呼吸，停止灰边呼吸 */
.pump-panel.is-on {
  --pp-bd: #22c55e;
  animation: pp-breathe-on 2.4s ease-in-out infinite;
}
.pump-panel.is-off {
  --pp-bd: #ff3b5c;
  animation: pp-breathe-off 2.4s ease-in-out infinite;
}
@keyframes pp-breathe-on {
  0%,
  100% {
    box-shadow:
      0 0 0 1px rgb(34 197 94 / 28%),
      0 16px 40px -12px rgb(8 26 46 / 34%),
      0 2px 6px rgb(15 34 58 / 8%);
  }
  50% {
    box-shadow:
      0 0 0 4px rgb(34 197 94 / 50%),
      0 18px 44px -10px rgb(8 26 46 / 40%),
      0 2px 6px rgb(15 34 58 / 8%);
  }
}
@keyframes pp-breathe-off {
  0%,
  100% {
    box-shadow:
      0 0 0 1px rgb(255 59 92 / 24%),
      0 16px 40px -12px rgb(8 26 46 / 34%),
      0 2px 6px rgb(15 34 58 / 8%);
  }
  50% {
    box-shadow:
      0 0 0 4px rgb(255 59 92 / 44%),
      0 18px 44px -10px rgb(8 26 46 / 40%),
      0 2px 6px rgb(15 34 58 / 8%);
  }
}
/* 头部：图标无圆底，标题 + 状态胶囊 + 关闭；下方内缩分隔线 */
.pp-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 14px 14px 11px;
}
.pp-head::after {
  position: absolute;
  right: 14px;
  bottom: 0;
  left: 14px;
  height: 1px;
  background: #eef2f7;
  content: '';
}
.pp-ico {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--mod-a, #0e7ff0);
}
.pp-pump {
  width: 28px;
  height: 28px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.9;
  stroke-linecap: round;
}
.pp-hmain {
  flex: 1;
  min-width: 0;
}
.pp-tline {
  display: flex;
  align-items: center;
  gap: 9px;
}
.pp-title {
  color: #14233a;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.pp-ecg {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: rgb(148 163 184 / 10%);
  border: 1px solid rgb(148 163 184 / 32%);
  border-radius: 14px;
}
.pp-ecg .ecg-svg {
  width: 52px;
  height: 15px;
  overflow: visible;
}
.pp-ecg .ecg-flat {
  fill: none;
  stroke: #b9c4d2;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pp-ecg .ecg-pulse {
  fill: none;
  stroke: #22c55e;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 46 84;
  animation: ecg-scan 1.3s linear infinite;
}
.pp-ecg .ecg-text {
  color: #8a97a8;
  font-size: 12px;
  font-weight: 600;
}
.pp-ecg.is-running {
  background: rgb(34 197 94 / 12%);
  border-color: rgb(34 197 94 / 45%);
}
.pp-ecg.is-running .ecg-flat {
  stroke: rgb(34 197 94 / 28%);
}
.pp-ecg.is-running .ecg-text {
  color: #16a34a;
}
/* 停止：红色直线（与设备台账详情一致） */
.pp-ecg.is-stopped {
  background: rgb(255 59 92 / 10%);
  border-color: rgb(255 59 92 / 45%);
}
.pp-ecg.is-stopped .ecg-flat {
  stroke: #ff3b5c;
}
.pp-ecg.is-stopped .ecg-text {
  color: #ff3b5c;
}
@keyframes ecg-scan {
  to {
    stroke-dashoffset: -130;
  }
}
.pp-sub {
  margin-top: 4px;
  overflow: hidden;
  color: #8895a6;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 关闭按钮：扩大点击区（原 el-icon 命中区过小，需要点两次才关） */
.pp-close {
  position: relative;
  z-index: 2;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  margin: 0;
  color: #8a95a5;
  font-size: 16px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  pointer-events: auto;
  transition:
    color 0.15s,
    background-color 0.15s;
}
.pp-close:hover {
  color: #33415a;
  background: #f2f5f9;
}
.pp-body {
  flex: 1;
  padding: 10px 14px 12px;
  overflow-y: auto;
}
/* 分段标题：蓝色竖条 + 深色粗标题 */
.pp-sec {
  position: relative;
  margin: 14px 0 10px;
  padding-left: 11px;
  color: #14233a;
  font-size: 15px;
  font-weight: 700;
}
.pp-sec::before {
  position: absolute;
  top: 50%;
  left: 0;
  width: 4px;
  height: 18px;
  background: var(--mod-a, #0e7ff0);
  border-radius: 2px;
  transform: translateY(-50%);
  content: '';
}
.pp-sec:first-child {
  margin-top: 0;
}
/* 工况 / 运维计数卡片 */
.pp-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.pp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 12px 11px;
  background: #f4f7fb;
  border-radius: 10px;
}
.pp-card.blue {
  background: #f1f5ff;
}
.pp-card.green {
  background: #e9f7ee;
}
.pp-card.amber {
  background: #fdf2e4;
}
.pp-card.link {
  cursor: pointer;
  transition: filter 0.15s;
}
.pp-card.link:hover {
  filter: brightness(0.97);
}
.pp-k {
  color: #7f8b99;
  font-size: 12px;
}
.pp-v {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.pp-v em {
  color: #7f8b99;
  font-size: 12px;
  font-style: normal;
}
.pp-big {
  color: var(--mod-a, #0e7ff0);
  font-size: 21px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.pp-big.warn {
  color: #ef8f1a;
}
.pp-v.ok {
  align-items: center;
  color: #16a34a;
  font-size: 16px;
  font-weight: 700;
}
.pp-v.ok .el-icon {
  font-size: 18px;
}
.pp-arrow {
  align-self: center;
  margin-left: auto;
  color: #b3bfcc;
  font-size: 13px;
}
/* 实时监控：2×2 指标（设计图：白底 + 中间竖分隔线 + 底部横线） */
.pp-metrics {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  row-gap: 16px;
  padding: 4px 0 14px;
}
.pp-metrics::before {
  position: absolute;
  top: 2px;
  bottom: 15px;
  left: 50%;
  width: 1px;
  background: #e6ebf2;
  content: '';
}
.pp-metrics::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: #eef2f7;
  content: '';
}
.pp-metric:nth-child(odd) {
  padding-right: 16px;
}
.pp-metric:nth-child(even) {
  padding-left: 20px;
}
.pp-metrics .pp-k {
  color: #7f8b99;
  font-size: 13px;
}
.pp-metrics .pp-big {
  color: #14233a;
  font-size: 22px;
}
.pp-mv {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-top: 7px;
}
.pp-mv em {
  color: #7f8b99;
  font-size: 12px;
  font-style: normal;
}
/* 台账 / 维保信息行 */
.pp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 2px;
  font-size: 12px;
  border-bottom: 1px solid #f1f4f8;
}
.pp-item span {
  flex-shrink: 0;
  width: 64px;
  color: #8a97a8;
}
.pp-item b {
  flex: 1;
  min-width: 0;
  color: #33415a;
  font-weight: 700;
  word-break: break-all;
}
.pp-item b.warn {
  color: #ef8f1a;
}
.pp-item.icon .el-icon {
  color: #9aa7b6;
  font-size: 14px;
}
.pp-item.icon span {
  width: auto;
}
.pp-item:last-child {
  border-bottom: none;
}
.pp-empty {
  margin-top: 12px;
  padding: 8px 10px;
  color: #8a97a8;
  font-size: 11px;
  background: #f4f6f9;
  border-radius: 8px;
}
/* 底部：实时更新 + 查看详情 */
.pp-foot {
  position: relative;
  padding: 11px 14px 13px;
  border-top: none;
}
.pp-foot::before {
  position: absolute;
  top: 0;
  right: 14px;
  left: 14px;
  height: 1px;
  background: #eef2f7;
  content: '';
}
.pp-foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.pp-live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #7f8b99;
  font-size: 12px;
}
.pp-live i {
  width: 7px;
  height: 7px;
  background: #16a34a;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgb(22 163 74 / 12%);
}
.pp-btn.is-plain {
  width: auto;
  padding: 4px 0;
  color: var(--mod-a, #2f7dff);
  font-size: 13px;
  font-weight: 700;
  background: transparent;
}
.pp-btn.is-plain:hover {
  color: #1a6fe0;
  background: transparent;
  filter: none;
}
.pp-btn.is-plain:disabled {
  color: #a8b3c0;
  background: transparent;
  cursor: not-allowed;
}
.pp-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 11px;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  background: var(--mod-a, #0e7ff0);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: filter 0.15s;
}
.pp-btn:hover {
  filter: brightness(1.06);
}
/* 面板滑入/滑出 */
.pump-panel-enter-active {
  transition: transform 0.28s cubic-bezier(0.22, 0.9, 0.3, 1);
}
/* 关闭即时卸载：离场不播放动画，避免元素滞留导致“反应慢/被二次点击” */
.pump-panel-leave-active {
  transition: none;
}
.pump-panel-enter-from,
.pump-panel-leave-to {
  transform: translate(-50%, 14px);
}
/* 窄屏：信息面板变为底部浮层，徽章适当缩小 */
@media only screen and (max-width: 1100px) {
  /* 舞台较窄时压缩徽章：隐藏编码行与状态文字，只留状态点，避免相邻徽章重叠 */
  .pump-badge {
    gap: 6px;
    padding: 4px 9px 4px 6px;
  }
  .pump-badge .pb-ico {
    width: 22px;
    height: 22px;
  }
  .pump-badge .pb-pump {
    width: 13px;
    height: 13px;
  }
  .pump-badge .p-name {
    font-size: 11px;
  }
  .pump-badge .p-state {
    gap: 0;
    font-size: 0;
  }
  .pump-badge .pb-dot {
    width: 6px;
    height: 6px;
  }
  .pump-badge .p-code {
    display: none;
  }
}
@media only screen and (max-width: 768px) {
  .pump-badge {
    gap: 6px;
    padding: 4px 8px 4px 5px;
  }
  .pump-badge .pb-ico {
    width: 22px;
    height: 22px;
  }
  .pump-badge .pb-pump {
    width: 13px;
    height: 13px;
  }
  .pump-badge .p-name {
    font-size: 11px;
  }
  .pump-badge .p-code {
    display: none;
  }
  .pump-panel {
    top: auto;
    right: 10px;
    bottom: 10px;
    left: 10px;
    width: auto;
    max-height: 58%;
    transform: none;
  }
  .pump-panel-enter-from,
  .pump-panel-leave-to {
    transform: translateY(16px);
  }
}

/* ===== 底部三图：charts-row 结构包裹，三张图各自为完整磨砂卡（与告警/工单卡片同配方） ===== */
.charts-row {
  display: grid;
  /* 设计稿三图并排；中屏（≤1660px）切换为双列 + 完成率通栏，见响应式段 */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  /* 在 home-content 内部，不再需要底部外边距 */
  margin-bottom: 0;
}
/* 操作员底部三卡：完成率 + 我的任务分布 + 机组运行状态（基础 3 列，断点覆盖见响应式段） */
.charts-row.op-charts {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
/* 我的任务分布：横向条列表 */
.mytask-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 4px 16px 10px;
  overflow-y: auto;
}
.mt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.mt-label {
  width: 60px;
  flex: none;
  font-size: 12px;
  color: var(--art-text-gray-600, #5f6b7a);
}
.mt-track {
  flex: 1;
  height: 10px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.16);
  overflow: hidden;
}
.mt-bar {
  height: 100%;
  border-radius: 6px;
  transition: width 0.5s ease;
}
.mt-num {
  width: 28px;
  flex: none;
  text-align: right;
  font-size: 14px;
  font-weight: 700;
}
.mt-empty {
  text-align: center;
  font-size: 12px;
  color: var(--art-text-gray-500, #94a3b8);
}
/* 机组运行状态 */
.pumpstat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 4px 16px 10px;
  overflow-y: auto;
}
.ps-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.ps-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}
.ps-dot.ok {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}
.ps-dot.off {
  background: #ff3b5c;
  box-shadow: 0 0 6px rgba(255, 59, 92, 0.55);
}
.ps-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--art-gray-900, #1f2d3d);
}
.ps-state {
  font-size: 12px;
}
.ps-state.ok {
  color: #22c55e;
}
.ps-state.off {
  color: #ff3b5c;
}
/* 内部三张图与右侧卡片完全同款磨砂背景（0.78/0.72），高度对齐 150px，三卡上下边缘严格一致 */
.charts-row .panel {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.72) 100%);
}
.chart-line {
  width: 100%;
  /* 撑满所在行拉伸后的面板剩余高度，ECharts 由 ResizeObserver 同步重算 */
  flex: 1 1 auto;
  height: auto;
  min-height: 120px;
}
/* 图表容器：空态时用同款磨砂底覆盖整个数据区，只显示「暂无数据」图标 */
.chart-box {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  min-height: 120px;
}
.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(238, 247, 255, 0.82) 100%);
  color: #9fb0c4;
  font-size: 13px;
}
.chart-empty .ce-img {
  width: 140px;
  display: block;
}
/* 两行四图卡片更矮，空态图同步缩小避免溢出 */
.dg-charts .chart-empty .ce-img {
  width: 84px;
}

/* ===== 紧凑表格 ===== */
.mini-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  /* 柔和圆角，无外部粗边框 */
  border-radius: 8px;
  overflow: hidden;
}
.mini-table th {
  padding: 10px 12px;
  color: #7890b0;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  /* 滚动时表头吸附 */
  position: sticky;
  top: 0;
  z-index: 2;
  background: #dceeff;
  border-bottom: 1px solid #cfe2f5;
}
.mini-table td {
  padding: 10px 12px;
  border-top: 1px solid #e5eff9;
  color: #314d78;
  line-height: 1.5;
}
/* 斑马纹：奇数行浅白，偶数行浅蓝 */
.mini-table tbody tr:nth-child(odd) {
  background: #fbfcfe;
}
.mini-table tbody tr:nth-child(even) {
  background: #f1f7fe;
}
.mini-table tbody tr {
  cursor: pointer;
  transition: background 0.15s;
}
.mini-table tbody tr:hover {
  background: #e6f2ff;
}
.t-time {
  color: var(--art-gray-500, #8a97a8) !important;
  white-space: nowrap;
}
.t-main {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-empty {
  padding: 18px 0 !important;
  color: var(--art-gray-400, #b0bccb);
  text-align: center;
}
/* 迷你表格状态标签：维修工单胶囊形制（圆点 + 浅底 + 浅描边 + 柔和投影） */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  box-shadow:
    0 2px 5px rgba(35, 78, 130, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
.tag::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
/* 等级/类型列不需要前置圆点，仅状态列保留 */
.tag.no-dot::before {
  display: none;
}
.tag-red {
  color: #f03d45;
  background: #ffecee;
  border-color: #ffd5d9;
}
.tag-orange {
  color: #f59a07;
  background: #fff2db;
  border-color: #ffe1af;
}
.tag-blue {
  color: #176bff;
  background: #e8f1ff;
  border-color: #c9deff;
}
.tag-gray {
  color: #78879c;
  background: #edf1f6;
  border-color: #d9e1eb;
}
.tag-green {
  color: #16a34a;
  background: #e7f8ed;
  border-color: #c3f0d4;
}

/* ===== 响应式 ===== */

/* 宽屏中档（≤1660px）：三图并排空间不足，流量/能耗双列 + 完成率通栏（横向仪表完整展示） */
@media only screen and (max-width: 1660px) {
  /* 通栏后 charts-row 内部为两行结构，行高恢复内容自适应（fr 拉伸仅用于 >1660 大屏）；
     stage 恢复定高，避免 auto 行高阶段图片按固有宽高比参与 min-content 计算把行撑高 */
  .home-grid {
    grid-template-rows: auto auto;
  }
  .pump-stage {
    flex: none;
    height: auto;
  }
  .charts-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* 中等桌面 / 紧凑桌面（≤1280px）：主网格切换单列，允许右侧表格正常横向滚动 */
@media only screen and (max-width: 1280px) {
  .home {
    min-height: 0;
  }
  .home-grid {
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }
  .charts-row,
  .right-col {
    grid-column: 1;
    grid-row: auto;
  }
  /* 单列布局下恢复 min-height:auto，避免作为 grid item 被 min-height:0 压缩到 0 高度 */
  .right-col {
    min-height: auto;
    /* 告警与工单并排双卡 */
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  /* 操作员四列表：保持横向四列，仅随单列网格归位 */
  .op-lists-row {
    grid-column: 1;
    grid-row: auto;
    min-height: auto;
  }
  .panel-alarm,
  .panel-repair,
  .panel-insp,
  .panel-dispatch,
  .panel-maint {
    min-height: 240px;
  }
  .pump-stage {
    height: auto;
  }
  /* 单列布局后 panel 不再被 grid 行拉伸，图表需显式高度，避免塌缩到 min-height:120px */
  .chart-line {
    height: 240px;
  }
  /* 单列布局后 panel 不再被 grid 行拉伸，图表需显式高度，避免塌缩到 min-height:120px */
  .chart-line {
    height: 240px;
  }
}

/* 小屏桌面（≤1024px）：KPI 2 列 */
@media only screen and (max-width: 1024px) {
  .kpi-row,
  .kpi-row.is-five {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .kpi-wave-card {
    min-height: 112px;
    padding: 12px 14px;
  }
  .pump-stage {
    height: auto;
  }
}

/* ≤800px（MASTER.md 响应式档）：工艺图内容保持 640px 最小宽度，超出部分横向滚动，
   避免泵组徽章随可视宽度收缩而互相重叠、工艺图被压到不可读 */
@media only screen and (max-width: 800px) {
  .ps-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .ps-content {
    min-width: 640px;
  }
}

/* 平板（≤768px）：图表堆叠，巡检纵向 */
@media only screen and (max-width: 768px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .kpi-wave-card {
    min-height: 108px;
    padding: 11px 14px;
  }
  .kw-icon {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }
  .kw-value {
    font-size: 24px;
  }
  .kw-dots5 i {
    width: 11px;
    height: 11px;
  }
  .charts-row {
    grid-template-columns: 1fr;
  }
  /* 操作员：四列表与底部双卡均单列堆叠 */
  .op-lists-row,
  .charts-row.op-charts {
    grid-template-columns: 1fr;
  }
  .right-col {
    grid-template-columns: 1fr;
  }
  .panel-alarm,
  .panel-repair,
  .panel-insp,
  .panel-dispatch,
  .panel-maint {
    min-height: 0;
  }
}

/* 手机（≤480px）：KPI 单列，紧凑模式 */
@media only screen and (max-width: 480px) {
  .kpi-row,
  .kpi-row.is-five {
    grid-template-columns: 1fr;
  }
  .panel {
    padding: 12px;
  }
  .mini-table {
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    white-space: nowrap;
  }
  .pump-stage {
    height: 220px;
    min-height: 0;
  }
  .pump-badge {
    padding: 2px 6px;
  }
  .pump-badge .p-name {
    font-size: 10px;
  }
  .pump-badge .p-state {
    font-size: 10px;
  }
}

/* ================= 领导/超管新版首页：主区 + 右侧今日总览窄栏 ================= */
/* 外层 grid：主区占满剩余宽度 | 右窄栏固定 336px */
.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 336px;
  /* 行高锁定为一屏剩余高度：工艺图弹性填充，底部指标卡固定，页面不再整体滚动 */
  grid-template-rows: minmax(0, 1fr);
  gap: 13px;
  flex: 1 1 auto;
  min-height: 0;
  align-items: stretch;
}
/* 主区：纵向排列各卡片 */
.dg-main {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-width: 0;
  min-height: 0;
}
/* ===== 右侧窄栏内的指标：KPI 四卡（对齐设计稿，四卡统一高度） ===== */
/* 历史分析块（运行时长排行等） */
.rl-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
}
.rl-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rl-block-title {
  color: rgba(234, 243, 251, 0.78);
  font-size: 12px;
  font-weight: 500;
}
.rl-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: rgba(234, 243, 251, 0.55);
  font-size: 11px;
  cursor: pointer;
}
.rl-link:hover {
  color: #fff;
}
.rl-link .el-icon {
  font-size: 10px;
}
/* 主区两列：左=机组图+四图2×2（2 份宽）｜中=告警/工单/近7日三卡竖排（1 份宽）；右窄栏在 dash-grid 层 */
.dg-cols {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 13px;
  flex: 1 1 auto;
  /* 最小可用高度：窗口过矮时不再压缩卡片，超出部分交给外层滚动，避免互相侵占 */
  min-height: 680px;
}
.dg-col-left {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-width: 0;
  min-height: 0;
}
.dg-lists {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-width: 0;
  min-height: 0;
}
.list-panel {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 200px;
  overflow: hidden;
}
.list-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 6px 6px;
  overflow: hidden;
}
/* 窄栏列表表格：字号加大、行高 56、虚线行分隔 */
.list-panel :deep(.el-table) {
  --el-table-border-color: transparent;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: #dceeff;
  --el-table-row-hover-bg-color: #f4f8ff;
  font-size: 13px;
}
.list-panel :deep(.el-table th.el-table__cell) {
  height: 36px;
  padding: 0 6px;
  color: #4a6d8e;
  font-size: 12.5px;
  font-weight: 600;
  background: #dceeff;
}
.list-panel :deep(.el-table td.el-table__cell) {
  padding: 0 6px;
  color: #31415c;
  font-size: 13px;
  border-bottom: 1px dashed rgba(206, 224, 243, 0.9);
}
.list-panel :deep(.el-table .cell) {
  padding: 0;
  line-height: 1.35;
}
.list-panel :deep(.el-table .el-table__row) {
  cursor: pointer;
}
.list-panel :deep(.el-table__inner-wrapper::before) {
  display: none;
}
/* 操作列：圆形图标按钮 */
.list-panel :deep(.row-btn) {
  width: 26px;
  height: 26px;
  padding: 0;
  font-size: 13px;
  border-radius: 50%;
}
.list-panel :deep(.row-btn .el-icon),
.list-panel :deep(.row-btn svg) {
  width: 14px;
  height: 14px;
  font-size: 14px;
}
.list-panel .tag {
  height: 20px;
  padding: 0 7px;
  font-size: 11.5px;
}
.mt-time {
  color: #7c8a9c;
  font-size: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* 工艺流程大卡：高度由图片自然比例决定，不再给固定百分比 */
.panel-stage {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  height: auto;
  min-height: 0;
}
/* 左列图表：2×2（供水对比 / 电耗双轴 / 前后池水位 / 能耗趋势），占机组图以下剩余高度 */
.dg-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 13px;
  flex: 1 1 auto;
  min-height: 0;
}
.dg-charts .panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.dg-charts .chart-box {
  min-height: 0;
}
/* 中列第三卡：近7日供水量与告警/工单三卡等分竖排（自带纵向 flex，柱状区才能撑满） */
.water7-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 200px;
}
/* 近7日供水量：大数字 + 迷你柱状（今日高亮） */
.w7-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  padding: 2px 18px 12px;
}
.w7-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.w7-num {
  color: #1f2d3d;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.w7-num em {
  margin-left: 3px;
  color: #8a97a8;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
}
.w7-sub {
  margin-left: auto;
  color: #8a97a8;
  font-size: 12px;
}
.w7-bars {
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
  gap: 10px;
  min-height: 0;
}
.w7-col {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}
.w7-bar {
  width: 100%;
  max-width: 36px;
  background: linear-gradient(180deg, #7db8ff 0%, #347dff 100%);
  border-radius: 6px 6px 2px 2px;
  transition: height 0.4s ease;
}
.w7-bar.today {
  background: linear-gradient(180deg, #26b6f5 0%, #0e7ad8 100%);
  box-shadow: 0 3px 10px rgba(38, 182, 245, 0.4);
}
.w7-x {
  overflow: hidden;
  max-width: 100%;
  color: #8a97a8;
  font-size: 11px;
  white-space: nowrap;
}
.w7-empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  color: #8a97a8;
  font-size: 12px;
}
/* 待办分类：通栏四块（图标 + 名称 + 数量），整块可点 */
.todo-panel {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
}
.todo-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 2px 16px 16px;
}
.tl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  background: #f6faff;
  border: 1px solid #e4eefb;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.tl-row:hover {
  background: #fff;
  border-color: #b9d6ff;
}
.tl-ic {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--c);
  font-size: 16px;
  background: var(--t);
  border-radius: 8px;
}
.tl-label {
  overflow: hidden;
  color: #314d78;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tl-n {
  margin-left: auto;
  color: #1f2d3d;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tl-arrow {
  color: #8a97a8;
}
/* 磨砂半透明 */
.dash-grid .panel {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(238, 247, 255, 0.70) 100%);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(30, 60, 120, 0.06);
}
/* 主舞台徽章去掉左侧泵图标后的紧凑留白（全屏弹窗保留图标） */
.panel-stage .pump-badge {
  padding: 6px 12px;
}
/* 机组图卡片收窄（半屏）时按容器宽度压缩徽章，避免相邻徽章重叠 */
@container (max-width: 760px) {
  .pump-badge {
    gap: 6px;
    padding: 4px 8px;
  }
  .pump-badge .p-name {
    font-size: 11px;
  }
  .pump-badge .p-code {
    display: none;
  }
}
@container (max-width: 620px) {
  .pump-badge .p-state {
    gap: 0;
    font-size: 0;
  }
  .pump-badge .pb-dot {
    width: 6px;
    height: 6px;
  }
}
/* ===== 机组图容器关键覆盖：全链路清理 height/object-fit ===== */
.panel-stage .ps-scroll {
  display: flex;
  align-items: center;
}
.panel-stage .ps-content {
  width: 100%;
  /* 删掉 height:100%，让图片自然撑高 */
}
/* 重要覆盖：全局 .pump-stage img 已改成 height:auto，无 object-fit
   图片始终按原始比例 100% 宽度显示，零裁切 */
.panel-stage .pump-stage img {
  height: auto;
}
/* 舞台图片区高度完全由 img 自然比例决定 */
.panel-stage .pump-stage {
  flex: none;
  height: auto;
  min-height: 0;
}
/* 管理员/领导左列工艺图：不再给 aspect-ratio，由 img width:100% + height:auto 自然撑 */
.dash-grid .panel-stage {
  height: auto;
}
.dash-grid .panel-stage .pump-stage {
  flex: none;
  height: auto;
  min-height: 0;
  /* 删掉 aspect-ratio，完全交给 img 自然比例 */
}

/* 中屏（≤1280px）：主区与右栏变上下堆叠，行内双列降为单列 */
@media only screen and (max-width: 1280px) {
  .dash-grid {
    grid-template-columns: minmax(0, 1fr);
    /* 堆叠模式恢复内容自适应行高，否则单行被压成一屏高、主区塌成 0 */
    grid-template-rows: auto auto;
  }
  .dg-main {
    min-height: auto;
  }
  /* 堆叠模式：左列与中列改为纵向排列 */
  .dg-cols {
    grid-template-columns: minmax(0, 1fr);
    flex: none;
  }
  .dg-lists {
    flex: none;
  }
  .list-panel {
    flex: none;
    min-height: 260px;
  }
  .dg-charts {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
    grid-auto-rows: auto;
  }
  .water7-panel {
    flex: none;
  }
  .todo-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dg-rail {
    position: static;
    flex: none;
    width: auto;
  }
  .panel-stage {
    height: auto;
  }
  .panel-stage .pump-stage {
    flex: none;
    height: clamp(260px, 42vw, 460px);
  }
  .dg-charts .panel {
    flex: none;
    height: 260px;
    min-height: 0;
  }
  /* 覆盖旧版操作员布局在 ≤1280px 给 .chart-line 的定高 240px */
  .dg-charts .chart-line {
    height: auto;
  }
}
</style>

<!-- 非 scoped：page-content 是本页祖先元素，scoped 无法命中；
     仅在首页移除 border-mode 给 .page-content 的 1px 描边、收紧页顶留白，其他页面不受影响 -->
<style>
html[data-box-mode] .page-content:has(.mod-dash) {
  border: none !important;
}
/* 缩短顶部 KPI 卡片与页面顶部区域的间距，整体更紧凑 */
.page-content:has(.mod-dash) {
  padding-top: 10px;
}
/* 全屏工艺图弹窗：工艺图铺满（append-to-body 传送后无 data-v，scoped :deep 无法命中，
   只能用全局类选择器；全局弹窗 24px 内边距规范不适用于此贴边铺满场景） */
.stage-dialog .el-dialog__body {
  padding: 0;
  height: calc(100vh - 55px);
}
</style>
