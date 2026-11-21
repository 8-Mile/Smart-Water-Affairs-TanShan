<template>
  <div class="page mod-asset page-fill" :class="{ 'is-ready': pageReady }">
    <!-- 顶部 KPI + 搜索（保持原样，作为页面工具条） -->
    <IconTabs v-model="activeTab" :tabs="deviceTabs">
      <template #list>
        <div class="kpi-panel">
          <div class="kpi-row">
            <KpiCard
              v-for="(c, idx) in kpiCards"
              :key="c.label"
              class="dash-card"
              :style="{ '--i': idx }"
              variant="tile"
              :color="c.color"
              :label="c.label"
              :value="c.value"
              :unit="c.unit"
              :metrics="c.metrics"
              :percent="c.percent"
              :percent-suffix="c.percentSuffix"
              :bg-image="c.bgImage"
              :icon-image="c.iconImage"
              :side-image="c.sideImage"
              :active="cardFilter === c.key"
              :breathing="cardFilter === c.key"
              clickable
              :title="c.key ? '点击筛选该状态，再次点击取消' : '查看全部设备'"
              @click="onKpiClick(c.key)"
            />
          </div>
        </div>

        <!-- 档案管理主布局：左树 + 右详情 -->
        <div class="asset-layout">
          <!-- 左侧设备档案树 -->
          <el-card shadow="never" class="tree-card">
            <template #header>
              <div class="tree-head">
                <div class="tree-head-left">
                  <span class="th-title">设备列表</span>
                  <span class="th-count">{{ treeCount }}台</span>
                </div>
                <div class="tree-tools">
                  <el-button
                    v-if="hasPerm('eq:create')"
                    type="primary"
                    circle
                    class="th-add"
                    title="新增设备"
                    @click="openCreate"
                  >
                    <ArtSvgIcon icon="ri:add-line" />
                  </el-button>
                  <el-button
                    v-if="hasPerm('eq:list')"
                    circle
                    class="th-export"
                    title="导出设备台账"
                    @click="showExportDialog = true"
                  >
                    <ArtSvgIcon icon="ri:download-2-line" />
                  </el-button>
                </div>
              </div>
            </template>
            <el-input
              v-model="treeKw"
              class="tree-search"
              placeholder="搜索机组或设备"
              clearable
            >
              <template #prefix><ArtSvgIcon icon="ri:search-line" /></template>
            </el-input>
            <div class="tree-chips">
              <button
                class="tchip"
                :class="{ 'is-on': treeFilter === 'all' }"
                @click="treeFilter = 'all'"
              >全部</button>
              <button
                class="tchip"
                :class="{ 'is-on': treeFilter === 'running' }"
                @click="treeFilter = 'running'"
              >运行中</button>
              <button
                class="tchip"
                :class="{ 'is-on': treeFilter === 'alarm' }"
                @click="treeFilter = 'alarm'"
              >有告警</button>
            </div>
            <div class="tree-col-head">
              <span>运行状态</span>
              <span>关联事项</span>
            </div>
            <!-- 首次加载骨架屏：替代树空态"暂无数据"的闪现 -->
            <div v-if="treeBooting" class="tree-skeleton" aria-hidden="true">
              <div v-for="n in 6" :key="n" class="ts-row">
                <span class="ts-ico" />
                <span class="ts-line" :style="{ width: `${58 + ((n * 7) % 28)}%` }" />
                <span class="ts-tag" />
              </div>
            </div>
            <el-tree
              v-else
              ref="treeRef"
              :key="treeModeKey"
              :data="treeLazy ? EMPTY_TREE_DATA : treeViewData"
              :props="TREE_PROPS"
              node-key="id"
              :indent="10"
              highlight-current
              :lazy="treeLazy"
              :load="loadTreeNode"
              :default-expand-all="!treeLazy"
              :expand-on-click-node="false"
              :filter-node-method="filterNode"
              class="asset-tree"
              @node-click="onTreeClick"
            >
              <template #default="{ data }">
                <div class="tree-node" :class="{ 'is-active': data.id === selectedId }">
                  <span
                    class="tn-ico"
                    :style="{ color: typeColor(data.type_id), background: typeColor(data.type_id) + '14' }"
                  >
                    <ArtSvgIcon :icon="treeNodeIcon(data)" />
                  </span>
                  <span class="tn-name" :title="data.name">{{ shortName(data.name) }}</span>
                  <span class="tn-status" :class="treeRunTone(data)">
                    <i class="tn-dot" />{{ treeRunLabel(data) }}
                  </span>
                  <span class="tn-rel">
                    <span
                      v-if="totalAlarmCount(data) > 0"
                      class="tn-badge is-alarm"
                      :title="`${totalAlarmCount(data)} 条未闭环告警，最高${['', '紧急', '重要', '一般'][totalAlarmLevel(data)]}级`"
                      @click.stop="goAlarmBadge(data)"
                    >
                      <ArtSvgIcon icon="ri:alarm-warning-line" />
                      {{ totalAlarmCount(data) > 99 ? '99+' : totalAlarmCount(data) }}
                    </span>
                    <span
                      v-if="totalRepairCount(data) > 0"
                      class="tn-badge is-order"
                      :title="`${totalRepairCount(data)} 条未闭环维修工单`"
                      @click.stop="goRepairOrders(data)"
                    >
                      <ArtSvgIcon icon="ri:file-list-2-line" />
                      {{ totalRepairCount(data) > 99 ? '99+' : totalRepairCount(data) }}
                    </span>
                  </span>
                </div>
              </template>
            </el-tree>
          </el-card>

          <!-- 右侧设备详情区 -->
          <div class="detail-area">
            <el-card v-if="!selectedEquipment" shadow="never" class="da-empty">
              <el-empty description="请在左侧选择设备查看详情">
                <el-button type="primary" v-if="treeData.length" @click="selectFirst">
                  选择{{ treeData[0].name }}
                </el-button>
              </el-empty>
            </el-card>

            <div v-else class="detail-anim" :key="selectedId ?? 'none'">
              <!-- 选中设备的主信息卡 -->
              <el-card shadow="never" class="da-head dash-card" :class="detailToneClass" :style="{ '--i': 0 }">
                <!-- 头部：图标 + 名称/状态标签 + 操作按钮 -->
                <div class="dd-header">
                  <div class="dd-icon"><ArtSvgIcon :icon="equipVisualIcon" /></div>
                  <div class="dd-head-main">
                    <div class="dd-title-row">
                      <span class="dd-title">{{ detailTitle }}</span>
                      <!-- 运行状态：运行中=动态心电图，停机=红色直线，无数据=灰色未接入 -->
                      <div
                        class="dh-ecg"
                        :class="{ 'is-running': isRunning, 'is-stopped': hasData && !isRunning, 'is-unlinked': !hasData }"
                        :title="hasData ? runLabel(selectedEquipment.running_status) : '设备已登记台账，但尚未接入实时/历史数据'"
                      >
                        <svg class="ecg-svg" viewBox="0 0 132 28" preserveAspectRatio="none" aria-hidden="true">
                          <path class="ecg-flat" :d="isRunning ? ECG_PATH : ECG_FLAT_PATH" />
                          <path v-if="isRunning" class="ecg-pulse" :d="ECG_PATH" />
                        </svg>
                        <span class="ecg-text">{{ hasData ? runLabel(selectedEquipment.running_status) : '未接入' }}</span>
                      </div>
                      <span
                        v-if="selectedEquipment.repair_state === 'pending'"
                        class="dd-tag is-orange is-link"
                        title="点击查看该设备的维修工单"
                        @click="goRepairOrders(selectedEquipment)"
                      >待检修</span>
                      <span
                        v-else-if="selectedEquipment.repair_state === 'overhaul'"
                        class="dd-tag is-purple is-link"
                        title="点击查看该设备的维修工单"
                        @click="goRepairOrders(selectedEquipment)"
                      >检修中</span>
                      <span
                        v-if="totalAlarmCount(selectedEquipment) > 0"
                        class="dh-alarm-badge is-link"
                        :style="{
                          background: levelColor(totalAlarmLevel(selectedEquipment)) + '18',
                          color: levelColor(totalAlarmLevel(selectedEquipment)),
                          borderColor: levelColor(totalAlarmLevel(selectedEquipment)) + '50',
                        }"
                        :title="alarmBadgeTitle(selectedEquipment)"
                        @click="goAlarmBadge(selectedEquipment)"
                      >
                        <ArtSvgIcon icon="ri:alarm-warning-fill" />
                        {{ totalAlarmCount(selectedEquipment) }}
                      </span>
                    </div>
                    <div class="dd-sub">
                      {{ selectedEquipment.code }}<i class="dd-sep">|</i>{{ selectedEquipment.type_name || '—' }}<template v-if="selectedEquipment.parent_name"><i class="dd-sep">|</i>{{ selectedEquipment.parent_name }}</template>
                      <!-- 运行/停机时长：只认启停事件；无记录显示“—”（每秒刷新） -->
                      <template v-if="hasData && runState">
                        <i class="dd-sep">|</i>
                        <span class="dd-sub-dur" :class="runState.running ? 'is-run' : 'is-stop'">
                          {{ runState.running ? '已连续运行' : '已停机' }}
                          <b>{{ runState.since ? formatDuration(runSecondsNow) : '—' }}</b>
                          <span v-if="runState.since" class="dd-sub-since">（自 {{ formatSinceDate(runState.since) }} 起）</span>
                          <span v-else class="dd-sub-since">（无启停记录）</span>
                        </span>
                      </template>
                      <template v-if="runState">
                        <i class="dd-sep">|</i>
                        <span class="dd-sub-dur" :class="runState.running ? 'is-run' : 'is-stop'">
                          {{ runState.running ? '累计运行' : '累计停机' }}
                          <b>{{ formatH(runState.running ? runState.total_run_hours : runState.total_stop_hours) }}</b>h
                        </span>
                      </template>
                    </div>
                  </div>
                  <div class="dd-actions">
                    <el-button
                      v-if="hasPerm('eq:update')"
                      class="btn-edit"
                      title="编辑资料"
                      @click="openEdit(selectedEquipment)"
                    >
                      <ArtSvgIcon icon="ri:edit-line" class="btn-ico" /><span class="btn-label">编辑资料</span>
                    </el-button>
                    <el-button
                      v-if="hasPerm('repair:create')"
                      class="btn-repair"
                      title="设备报修"
                      @click="goRepair(selectedEquipment)"
                    >
                      <ArtSvgIcon icon="ri:tools-line" class="btn-ico" /><span class="btn-label">设备报修</span>
                    </el-button>
                    <DeleteConfirm
                      v-if="hasPerm('eq:delete')"
                      :text="deleteConfirmText(selectedEquipment)"
                      @confirm="onDelete(selectedEquipment)"
                    >
                      <el-button class="btn-del" title="删除设备">
                        <ArtSvgIcon icon="ri:delete-bin-line" class="btn-ico" /><span class="btn-label">删除设备</span>
                      </el-button>
                    </DeleteConfirm>
                  </div>
                </div>

                <!-- KPI 总览（仅末级设备展示；父级结构不显示） -->
                <div v-if="snapshot && !selectedChildren.length" class="dd-kpis">
                  <div class="dd-kpi">
                    <div class="dd-kpi-ic is-blue"><ArtSvgIcon icon="ri:database-2-line" /></div>
                    <div class="dd-kpi-tx">
                      <div class="dd-kpi-l">测点总数</div>
                      <div class="dd-kpi-v">{{ snapshot.points.total }}<i>个</i></div>
                      <div class="dd-kpi-s" :title="catBreakdown">{{ catBreakdown || `${catKeys.length}类测点` }}</div>
                    </div>
                  </div>
                  <div class="dd-kpi">
                    <div class="dd-kpi-ic" :class="snapshot.points.offline > 0 ? 'is-orange' : 'is-green'"><ArtSvgIcon icon="ri:wifi-line" /></div>
                    <div class="dd-kpi-tx">
                      <div class="dd-kpi-l">通信在线<span class="dd-rate" :class="{ 'is-warn': snapshot.points.offline > 0 }">{{ onlineRate }}%</span></div>
                      <div class="dd-kpi-v">{{ snapshot.points.online }}<i>/{{ snapshot.points.total }}</i></div>
                      <div class="dd-kpi-s" :class="{ 'is-warn': snapshot.points.offline > 0 }">
                        {{ snapshot.points.offline > 0 ? `离线 ${snapshot.points.offline} 个` : '全部在线' }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 主体：左 tabs（实时监测/告警记录/设备档案） + 右侧概况栏 -->
                <div class="dd-body">
                  <div class="dd-main">
                    <div class="dd-tabs">
                      <span class="dd-tab" :class="{ active: activeDetailTab === 'monitor' }" @click="activeDetailTab = 'monitor'">
                        实时监测<i v-if="snapshot">{{ snapshot.points.total }}</i>
                      </span>
                      <span class="dd-tab" :class="{ active: activeDetailTab === 'alarms' }" @click="activeDetailTab = 'alarms'">
                        告警记录<i>{{ totalAlarmCount(selectedEquipment) }}</i>
                      </span>
                      <span class="dd-tab" :class="{ active: activeDetailTab === 'profile' }" @click="activeDetailTab = 'profile'">设备档案</span>
                    </div>

                    <!-- 实时监测 -->
                    <template v-if="activeDetailTab === 'monitor'">
                      <div class="dd-sec-bar">
                        <div class="dd-sec-bar-l">
                          <span class="dd-sec-name">实时测点</span>
                          <span class="dd-sec-desc">按类型查看设备采集数据</span>
                        </div>
                        <div class="dd-sec-bar-r">
                          <!-- 卡片/列表切换：仅 1600px 以上显示 -->
                          <div class="dd-view-toggle">
                            <span
                              class="dd-vt-btn"
                              :class="{ active: pointViewMode === 'grid' }"
                              title="卡片视图"
                              @click="pointViewMode = 'grid'"
                            ><ArtSvgIcon icon="ri:layout-grid-line" /></span>
                            <span
                              class="dd-vt-btn"
                              :class="{ active: pointViewMode === 'list' }"
                              title="列表视图"
                              @click="pointViewMode = 'list'"
                            ><ArtSvgIcon icon="ri:menu-line" /></span>
                          </div>
                          <el-button
                            size="small"
                            class="dd-refresh-btn"
                            :loading="snapshotLoading"
                            @click="void loadSnapshot(selectedEquipment.id)"
                          ><ArtSvgIcon icon="ri:refresh-line" style="margin-right:4px" />刷新</el-button>
                        </div>
                      </div>
                      <div v-if="snapshot && catKeys.length" class="dd-chips">
                        <span class="dd-chip" :class="{ active: activeCat === '' }" @click="activeCat = ''">全部 {{ snapshot.points.total }}</span>
                        <span
                          v-for="cat in catKeys"
                          :key="cat"
                          class="dd-chip"
                          :class="{ active: activeCat === cat }"
                          :style="activeCat === cat ? { background: pointCatColor(cat), borderColor: pointCatColor(cat) } : {}"
                          @click="activeCat = activeCat === cat ? '' : cat"
                        >{{ pointCatLabel(cat) }} {{ snapshot.grouped_values[cat].length }}</span>
                      </div>
                      <!-- 卡片视图：平铺 + 分页（设计稿布局） -->
                      <template v-if="snapshot && pointViewMode === 'grid'">
                        <div class="dd-grid">
                          <div
                            v-for="(p, idx) in pagedPoints"
                            :key="p.tag_name + p.equipment_id"
                            class="dd-pt dash-card"
                            :class="{ 'is-over': !!p.over_level, 'is-offline': !p.is_online }"
                            :style="{ '--i': idx + 1 }"
                          >
                            <div class="dd-pt-name" :title="p.tag_name">
                              {{ p.display_name }}
                              <span v-if="!p.is_online" class="gp-offline-dot" title="该点位未收到历史数据">
                                <ArtSvgIcon icon="ri:signal-tower-off-line" />
                              </span>
                            </div>
                            <div class="dd-pt-val">
                              <template v-if="p.is_online && p.value !== null && p.value !== undefined">
                                <span class="num" :class="{ 'is-over': !!p.over_level }">{{ p.value.toFixed?.(1) ?? p.value }}</span>
                                <span class="unit">{{ p.unit || '' }}</span>
                              </template>
                              <template v-else>
                                <span class="num off">--</span>
                              </template>
                              <span v-if="p.is_online && p.over_level" class="gp-over-badge" :style="{ background: overLevelColor(p.over_level) }">
                                {{ overLevelLabel(p.over_level) }}
                              </span>
                            </div>
                            <div class="dd-pt-sub">{{ p.equipment_name || selectedEquipment.name }} · {{ p.tag_name }}</div>
                          </div>
                        </div>
                        <div v-if="flatPoints.length" class="dd-mon-foot">
                          <span>共 {{ flatPoints.length }} 个测点</span>
                          <el-pagination
                            v-model:current-page="pointPage"
                            :page-size="POINT_PAGE_SIZE"
                            :total="flatPoints.length"
                            layout="prev, pager, next"
                            small
                            background
                          />
                        </div>
                      </template>
                      <!-- 列表视图：el-table 分类分组，可折叠 -->
                      <template v-else-if="snapshot">
                        <el-table
                          :data="listViewRows"
                          :span-method="listSpanMethod"
                          :row-class-name="listRowClass"
                          :row-style="listRowStyle"
                          stripe
                        >
                          <template #empty><el-empty :image-size="80" description="暂无测点数据" /></template>
                          <el-table-column label="序号" width="70" align="center">
                            <template #default="{ row }">
                              <template v-if="row.__groupRow">
                                <ArtSvgIcon
                                  :icon="collapsedCats[row.__cat] ? 'ri:arrow-right-s-line' : 'ri:arrow-down-s-line'"
                                  class="lv-toggle"
                                  :style="{ color: pointCatColor(row.__cat) }"
                                  @click="toggleCat(row.__cat)"
                                />
                              </template>
                              <template v-else>{{ row.__seq }}</template>
                            </template>
                          </el-table-column>
                          <el-table-column label="测点名称" min-width="240" show-overflow-tooltip>
                            <template #default="{ row }">
                              <template v-if="row.__groupRow">
                                <span class="lv-group-title">
                                  <ArtSvgIcon :icon="pointCatIcon(row.__cat)" class="lv-group-icon" :style="{ color: pointCatColor(row.__cat) }" />
                                  <span :style="{ color: pointCatColor(row.__cat) }">{{ pointCatLabel(row.__cat) }}</span>
                                  <span class="lv-group-count" :style="{ color: pointCatColor(row.__cat) }">({{ row.__total }})</span>
                                </span>
                              </template>
                              <template v-else>
                                {{ row.display_name }}
                                <span v-if="!row.is_online" class="gp-offline-dot" title="离线">
                                  <ArtSvgIcon icon="ri:signal-tower-off-line" />
                                </span>
                              </template>
                            </template>
                          </el-table-column>
                          <el-table-column label="实时值" width="130" align="center">
                            <template #default="{ row }">
                              <template v-if="row.__groupRow">—</template>
                              <template v-else>
                                <span v-if="row.is_online && row.value !== null && row.value !== undefined" class="lv-val">
                                  {{ row.value.toFixed?.(1) ?? row.value }}
                                  <span v-if="row.unit" class="lv-unit">{{ row.unit }}</span>
                                </span>
                                <span v-else class="lv-off">—</span>
                              </template>
                            </template>
                          </el-table-column>
                          <el-table-column label="来源" min-width="180" show-overflow-tooltip>
                            <template #default="{ row }">
                              <template v-if="row.__groupRow">—</template>
                              <template v-else><span class="lv-source">{{ row.equipment_name || selectedEquipment.name }}</span></template>
                            </template>
                          </el-table-column>
                          <el-table-column label="测点标识" min-width="200" show-overflow-tooltip>
                            <template #default="{ row }">
                              <template v-if="row.__groupRow">—</template>
                              <template v-else><span class="lv-tag">{{ row.tag_name }}</span></template>
                            </template>
                          </el-table-column>
                          <el-table-column label="操作" width="80" align="center">
                            <template #default="{ row }">
                              <template v-if="row.__groupRow">—</template>
                              <template v-else>
                                <el-button link type="primary" size="small" @click="goPointDetail(row)">详情</el-button>
                              </template>
                            </template>
                          </el-table-column>
                        </el-table>
                      </template>
                      <el-empty v-if="snapshot && !catKeys.length" description="暂无测点数据" :image-size="60" />
                    </template>

                    <!-- 告警记录 -->
                    <template v-else-if="activeDetailTab === 'alarms'">
                      <div v-loading="alarmsLoading" class="dd-alarm-wrap">
                        <div v-if="detailAlarms.length" class="dd-alarm-list">
                          <div
                            v-for="a in detailAlarms"
                            :key="a.id"
                            class="dd-alarm-item link"
                            :class="{ 'item-focus': focusedAlarmIds.includes(a.id) }"
                            title="查看告警页面"
                            @click="goAlarmHistory(selectedEquipment, a)"
                          >
                            <span
                              class="dd-alarm-level"
                              :style="{ background: levelColor(a.alarm_level) + '18', color: levelColor(a.alarm_level) }"
                            >{{ alarmLevelLabel(a.alarm_level) }}</span>
                            <div class="dd-alarm-main">
                              <div class="dd-alarm-name">{{ a.rule_name }}</div>
                              <div class="dd-alarm-sub">
                                {{ a.alarm_time }}<template v-if="a.trigger_value"> · 触发值 {{ a.trigger_value }}</template>
                              </div>
                            </div>
                            <span class="dd-alarm-status" :class="'st-' + a.alarm_status">{{ alarmStatusLabel(a.alarm_status) }}</span>
                            <ArtSvgIcon icon="ri:arrow-right-s-line" class="dd-alarm-go" />
                          </div>
                        </div>
                        <el-empty v-else-if="!alarmsLoading" description="暂无告警记录" :image-size="60" />
                      </div>
                    </template>

                    <!-- 设备档案 -->
                    <template v-else>
                      <div class="dd-profile">
                        <div class="dd-profile-grid">
                          <div class="dd-pf-item"><span>设备编号</span><b>{{ selectedEquipment.code }}</b></div>
                          <div class="dd-pf-item"><span>设备分类</span><b>{{ selectedEquipment.type_name || '—' }}</b></div>
                          <div class="dd-pf-item"><span>所属设备</span><b>{{ selectedEquipment.parent_name || '—' }}</b></div>
                          <div class="dd-pf-item"><span>生产厂商</span><b>{{ selectedEquipment.manufacturer_name || '—' }}</b></div>
                          <div class="dd-pf-item"><span>维护厂商</span><b>{{ selectedEquipment.maintainer_name || '—' }}</b></div>
                          <div class="dd-pf-item"><span>生产日期</span><b>{{ selectedEquipment.production_date || '—' }}</b></div>
                          <div class="dd-pf-item"><span>采购日期</span><b>{{ selectedEquipment.purchase_date || '—' }}</b></div>
                          <div class="dd-pf-item"><span>首次运行</span><b>{{ selectedEquipment.first_run_date || '—' }}</b></div>
                          <div class="dd-pf-item"><span>累计运行</span><b>{{ formatH(runState?.total_run_hours ?? selectedEquipment.continuous_run_hours) }} h</b></div>
                          <div class="dd-pf-item"><span>累计停机</span><b>{{ formatH(runState?.total_stop_hours ?? selectedEquipment.continuous_stop_hours) }} h</b></div>
                          <div v-if="selectedEquipment.remark" class="dd-pf-item is-full"><span>备注</span><b>{{ selectedEquipment.remark }}</b></div>
                        </div>
                        <template v-if="hasRated(selectedEquipment)">
                          <div class="dd-sec-title is-static">
                            <ArtSvgIcon icon="ri:file-list-3-line" /><span>额定参数</span>
                          </div>
                          <div class="da-rated">
                            <div class="rated-item"><div class="rated-label">机组编号</div><div class="rated-value">{{ selectedEquipment.unit_no ?? '-' }}</div></div>
                            <div class="rated-item"><div class="rated-label">泵型</div><div class="rated-value">{{ selectedEquipment.pump_type || '-' }}</div></div>
                            <div class="rated-item"><div class="rated-label">额定功率</div><div class="rated-value">{{ selectedEquipment.rated_power_kw ?? '-' }} <span class="u">kW</span></div></div>
                            <div class="rated-item"><div class="rated-label">额定电流</div><div class="rated-value">{{ selectedEquipment.rated_current_a ?? '-' }} <span class="u">A</span></div></div>
                            <div class="rated-item"><div class="rated-label">额定电压</div><div class="rated-value">{{ selectedEquipment.rated_voltage_kv ?? '-' }} <span class="u">kV</span></div></div>
                            <div class="rated-item"><div class="rated-label">额定流量</div><div class="rated-value">{{ selectedEquipment.rated_flow_m3s ?? '-' }} <span class="u">m³/s</span></div></div>
                          </div>
                        </template>
                        <template v-if="Object.keys(selectedRatedParams).length">
                          <div class="dd-sec-title is-static">
                            <ArtSvgIcon icon="ri:file-list-3-line" /><span>档案参数</span>
                          </div>
                          <div class="da-rated">
                            <div v-for="(v, k) in selectedRatedParams" :key="k" class="rated-item">
                              <div class="rated-label">{{ k }}</div>
                              <div class="rated-value">{{ v || '-' }}</div>
                            </div>
                          </div>
                        </template>
                      </div>
                    </template>
                  </div>

                  <!-- 右侧概况栏 -->
                  <div class="dd-side">
                    <div class="dd-side-sec">
                      <div class="dd-side-title">设备概况</div>
                      <div class="dd-visual">
                        <img v-if="equipImage" :src="equipImage" :alt="selectedEquipment.name" />
                        <template v-else>
                          <ArtSvgIcon :icon="equipVisualIcon" />
                          <div class="dd-visual-cap">{{ selectedEquipment.type_name || '设备' }}示意</div>
                        </template>
                      </div>
                      <div class="dd-info-row"><span>设备分类</span><b>{{ selectedEquipment.type_name || '—' }}</b></div>
                      <div class="dd-info-row"><span>所属设备</span><b>{{ selectedEquipment.parent_name || '—' }}</b></div>
                      <div class="dd-info-row"><span>生产厂家</span><b>{{ selectedEquipment.manufacturer_name || '未填写' }}</b></div>
                      <div v-if="hasPerm('eq:update')" class="dd-info-link" @click="openEdit(selectedEquipment)">
                        查看完整档案<ArtSvgIcon icon="ri:arrow-right-line" />
                      </div>
                    </div>
                    <div v-if="snapshot" class="dd-side-sec">
                      <div class="dd-side-title">运维概况</div>
                      <div class="dd-ops-open link" title="查看维修工单" @click="goRepairList(selectedEquipment.id)">
                        <ArtSvgIcon icon="ri:file-list-3-line" />
                        <div>
                          <div class="dd-ops-open-l">未闭环工单</div>
                          <div class="dd-ops-open-v" :class="{ nonzero: snapshot.ops.open_repairs > 0 }">{{ snapshot.ops.open_repairs }}<i>个</i></div>
                        </div>
                      </div>
                      <div class="dd-ops-open link" title="查看实时告警" @click="goAlarmRealtime(selectedEquipment)">
                        <ArtSvgIcon icon="ri:alarm-warning-line" style="color:#f08a24" />
                        <div>
                          <div class="dd-ops-open-l">未闭环告警</div>
                          <div class="dd-ops-open-v" :class="{ nonzero: totalAlarmCount(selectedEquipment) > 0 }">{{ totalAlarmCount(selectedEquipment) }}<i>条</i></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </el-card>

              <!-- 子设备：横向一行 6 个 + 右侧分页/全部设备 -->
              <DeviceChildrenCard
                v-if="selectedChildren.length"
                :items="selectedChildren"
                :selected-id="selectedId"
                :alarm-counts="alarmCounts"
                :alarm-levels="alarmLevels"
                :start-index="1"
                @select="selectEquipment"
              />

            </div>
          </div>
        </div>
      </template>
      <template #types>
        <TypesView />
      </template>
    </IconTabs>

    <!-- 设备表单弹窗（编辑/新增） -->
    <ProDialog v-model="visible" :title="form.id ? '编辑设备' : '新增设备'" width="720px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-row :gutter="12">
          <el-col :span="24">
            <el-form-item label="上级设备" prop="parent_id">
              <EquipmentTreeSelect
                v-model="form.parent_id"
                clearable
                placeholder="不选则为顶级设备（机组/系统分组）"
              />
              <div class="parent-hint">选择上级后，该设备将挂在对应机组/分组的树节点下</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="设备名称" prop="name" required>
              <el-input v-model="form.name">
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:edit-line" /></span>
                </template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="设备编号" prop="code" required>
              <el-input v-model="form.code">
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:code-s-slash-line" /></span>
                </template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="设备分类" prop="type_id" required>
              <el-select v-model="form.type_id" style="width: 100%">
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:price-tag-3-line" /></span>
                </template>
                <el-option v-for="t in types" :key="t.id" :label="t.name" :value="t.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="运行状态">
              <el-select
                v-model="form.running_status"
                style="width: 100%"
                :disabled="form.run_status_source === 'scada'"
              >
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:pulse-line" /></span>
                </template>
                <el-option label="运行中" value="running" />
                <el-option label="已停机" value="stopped" />
              </el-select>
              <div v-if="form.run_status_source === 'scada'" class="run-src-hint">
                该设备已接入 SCADA，运行状态由运行信号实时派生，不可手工修改
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="生产厂商">
              <el-select v-model="form.manufacturer_id" filterable clearable style="width: 100%">
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:building-line" /></span>
                </template>
                <el-option v-for="t in manufacturers" :key="t.id" :label="t.name" :value="t.id" />
                <template v-if="hasPerm('eq:create')" #footer>
                  <el-button class="select-add-btn" text type="primary" @click="openInline('manufacturer')">
                    <ArtSvgIcon icon="ri:add-line" style="margin-right: 4px" />新建生产厂商
                  </el-button>
                </template>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="维保厂商">
              <el-select v-model="form.maintainer_id" filterable clearable style="width: 100%">
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:building-line" /></span>
                </template>
                <el-option v-for="t in maintainers" :key="t.id" :label="t.name" :value="t.id" />
                <template v-if="hasPerm('eq:create')" #footer>
                  <el-button class="select-add-btn" text type="primary" @click="openInline('maintainer')">
                    <ArtSvgIcon icon="ri:add-line" style="margin-right: 4px" />新建维保厂商
                  </el-button>
                </template>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="维保期限(天)">
              <el-input-number v-model="form.maintain_term_days" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="维护状态">
              <el-select v-model="form.maintain_status" style="width: 100%">
                <template #prefix>
                  <span class="field-badge"><ArtSvgIcon icon="ri:tools-line" /></span>
                </template>
                <el-option label="正常" value="normal" />
                <el-option label="需保养" value="need_maintain" />
                <el-option label="故障待修" value="fault" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="累计运行(小时)">
              <el-input-number v-model="form.continuous_run_hours" :min="0" :precision="2" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="累计停机(小时)">
              <el-input-number v-model="form.continuous_stop_hours" :min="0" :precision="2" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="生产时间">
              <el-date-picker v-model="form.production_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="采购时间">
              <el-date-picker v-model="form.purchase_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="首次运行">
              <el-date-picker v-model="form.first_run_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <div class="field-textarea">
                <span class="field-badge"><ArtSvgIcon icon="ri:file-text-line" /></span>
                <el-input v-model="form.remark" type="textarea" :rows="2" />
              </div>
            </el-form-item>
          </el-col>
          <!-- 按上级分组的差异化档案字段 -->
          <template v-if="formProfileFields.length">
            <el-col :span="24">
              <div class="rated-params-title">
                <ArtSvgIcon icon="ri:file-list-3-line" />
                <span>档案参数（{{ topGroupName(form.parent_id) }}）</span>
              </div>
            </el-col>
            <el-col v-for="field in formProfileFields" :key="field" :span="12">
              <el-form-item :label="field.replace(/\(.*\)/, '')">
                <el-input v-model="form.rated_params[field]" :placeholder="field.includes('(') ? field : ''" />
              </el-form-item>
            </el-col>
          </template>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">
          <ArtSvgIcon icon="ri:close-line" class="btn-icon" />取消
        </el-button>
        <el-button type="primary" @click="onSave">
          <ArtSvgIcon icon="ri:check-line" class="btn-icon" />保存
        </el-button>
      </template>
    </ProDialog>

    <!-- 导出历史数据对话框 -->
    <ProDialog v-model="showExportDialog" title="导出历史数据" width="560px">
      
      <el-form label-width="90px" style="margin-top:16px" label-position="right">
        <el-form-item label="导出范围">
          <el-select v-model="exportUnit" style="width:100%">
            <el-option label="全部机组（机组1-机组5）" value="all" />
            <el-option v-for="n in 5" :key="n" :label="`机组${n}`" :value="String(n)" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <div class="export-range">
           
            <el-date-picker
              v-model="exportRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              :shortcuts="exportShortcuts"
              style="width:100%"
              @change="onRangePick"
            />
            <div class="export-range-hint">不选时间则导出全部历史数据</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showExportDialog = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="doExport">
          <ArtSvgIcon icon="ri:download-cloud-2-line" class="btn-icon" />开始导出
        </el-button>
      </template>
    </ProDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElInput, ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules, ElTree } from 'element-plus'
import {
  createEquipment,
  deleteEquipment,
  fetchEquipmentDetail,
  fetchEquipmentSnapshot,
  fetchEquipmentStats,
  listEquipment,
  type EquipmentItem,
  type EquipmentSnapshot,
  type EquipmentStats,
  updateEquipment,
} from '@/api/equipment'
import { fetchAlarmCounts, listAlarms } from '@/api/alarm'
import { listRepairs } from '@/api/repair'
import type { AlarmCountsResult, AlarmItem } from '@/api/alarm'
import { fetchEquipmentScadaValues, fetchUnitReportExport } from '@/api/scada'
import { connectAlarmWs, onAlarmEvent, disconnectAlarmWs } from '@/utils/alarmWs'
import { createResource, optionsResource } from '@/api/system'
import type { OptionItem } from '@/api/types'
import ProSearchBar from '@/components/ProSearchBar.vue'
import type { SearchFormItem } from '@/components/ProSearchBar.vue'
import ArtSvgIcon from '@/components/ArtSvgIcon.vue'
import ArtButtonTable from '@/components/ArtButtonTable.vue'
import DeleteConfirm from '@/components/DeleteConfirm.vue'
import EquipmentTreeSelect from '@/components/EquipmentTreeSelect.vue'
import ProDialog from '@/components/ProDialog.vue'
import KpiCard from '@/components/KpiCard.vue'
import TypesView from './TypesView.vue'
import DeviceChildrenCard from './components/DeviceChildrenCard.vue'
import IconTabs, { type IconTabItem } from '@/components/IconTabs.vue'
import { usePermissions } from '@/utils/permissions'

// 台账 Tab：设备分类维护属管理职能
const deviceTabs = computed<IconTabItem[]>(() => {
  const list: IconTabItem[] = [{ name: 'list', label: '设备台账', icon: 'ri:folder-tree' }]
  if (hasAnyPerm(['eq:type:create', 'eq:type:update', 'eq:type:delete'])) {
    list.push({ name: 'types', label: '设备分类', icon: 'ri:price-tag-3-line' })
  }
  return list
})
// KPI 卡素材
import eqBgTotal from '@/assets/img/equipment/background/01_total_blue_background.svg'
import eqBgOnline from '@/assets/img/equipment/background/02_online_green_background.svg'
import eqBgInspect from '@/assets/img/equipment/background/03_inspection_orange_background.svg'
import eqBgFault from '@/assets/img/equipment/background/04_fault_red_background.svg'
import eqBgOverhaul from '@/assets/img/equipment/background/05_maintenance_purple_background.svg'
import eqIconTotal from '@/assets/img/equipment/LeftIcon/total.webp'
import eqIconOnline from '@/assets/img/equipment/LeftIcon/running.webp'
import eqIconInspect from '@/assets/img/equipment/LeftIcon/repair.webp'
import eqIconFault from '@/assets/img/equipment/LeftIcon/fault.webp'
import eqIconOverhaul from '@/assets/img/equipment/LeftIcon/jianxiu.webp'
import eqSideTotal from '@/assets/img/equipment/RightIcon/total.svg'
import eqSideOnline from '@/assets/img/equipment/RightIcon/online.svg'
import eqSideInspect from '@/assets/img/equipment/RightIcon/nspection.svg'
import eqSideFault from '@/assets/img/equipment/RightIcon/fault.svg'
import eqSideOverhaul from '@/assets/img/equipment/RightIcon/chilun.svg'
import { equipmentImage, equipmentImageByName } from '@/utils/equipmentImages'
import {
  alarmCountOf,
  alarmLevelOf,
  levelColor,
  runLabel,
  runTag,
  shortName,
  treeNodeIcon,
  typeColor,
  typeIcon,
} from '@/utils/equipmentDisplay'

const { hasPerm, hasAnyPerm } = usePermissions()

const route = useRoute()
const router = useRouter()
/** 从其他页面带 equipment_id 进来时需要全量树做定位/范围过滤，此时不走懒加载 */
const presetEqId = Number(route.query.equipment_id) || 0

const activeTab = ref('list')
// 初值为 true：首帧直接进骨架屏，避免 onMounted 之前闪一帧"暂无数据"
const loading = ref(true)
const rows = ref<EquipmentItem[]>([]) // 顶级设备 + children

// 左侧树选中
const treeRef = ref<InstanceType<typeof ElTree>>()
const selectedId = ref<number | null>(null)
const treeKw = ref('')

const stats = ref<EquipmentStats | null>(null)
const visible = ref(false)
const highlightId = ref<number | null>(null)
const query = reactive({ name: '', code: '' })
const cardFilter = ref<'' | 'running' | 'pending' | 'overhaul' | 'offline'>('')
const types = ref<OptionItem[]>([])
const manufacturers = ref<OptionItem[]>([])
const maintainers = ref<OptionItem[]>([])

// 告警数据：设备自身未闭环告警的计数 + 最高等级（顶级设备前端汇总）
const alarmCounts = ref<Record<string, number>>({})
const alarmLevels = ref<Record<string, number>>({})
// 事实快照（从后端 snapshot 接口一次返回测点/越限/运维画像）
const snapshot = ref<EquipmentSnapshot | null>(null)
const snapshotLoading = ref(false)

// ---------- 连续运行/停止时长（每秒刷新倒计时） ----------
const runState = computed(() => snapshot.value?.run_state ?? null)
/** 运行/停止连续秒数（每秒自增；无 since 时从后端返回值展示） */
const runSecondsNow = ref(0)
let _runTimer: number | undefined
function startRunCountdown() {
  stopRunCountdown()
  runSecondsNow.value = runState.value?.continuous_seconds ?? 0
  if (runState.value?.since) {
    // 从 since 时间戳重新计算（更准，防止页面停留时后端时间差漂移）
    const baseMs = new Date(runState.value.since).getTime()
    const tick = () => {
      const diff = Math.floor((Date.now() - baseMs) / 1000)
      runSecondsNow.value = diff >= 0 ? diff : 0
    }
    tick()
    _runTimer = window.setInterval(tick, 1000)
  }
}
function stopRunCountdown() {
  if (_runTimer) { clearInterval(_runTimer); _runTimer = undefined }
}
// ========== 详情页签 / 测点分类筛选 / 告警记录 ==========
const activeDetailTab = ref<'monitor' | 'alarms' | 'profile'>('monitor')
const activeCat = ref('')
const detailAlarms = ref<AlarmItem[]>([])
const alarmsLoading = ref(false)
let alarmLoadedFor = 0
/** 告警列表中需要高亮的告警 id（顶部告警徽标点击时设置） */
const focusedAlarmIds = ref<number[]>([])

/** 标题：子设备显示为「父级 · 短名」 */
const detailTitle = computed(() => {
  const e = selectedEquipment.value
  if (!e) return ''
  return e.parent_name ? `${e.parent_name}-${shortName(e.name)}` : e.name
})

const catKeys = computed(() => Object.keys(snapshot.value?.grouped_values || {}))
/** 测点分类构成，如“电气11 · 温度6 · 开关量21”（按数量降序） */
const catBreakdown = computed(() => {
  const gv = snapshot.value?.grouped_values || {}
  return Object.entries(gv)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, pts]) => `${pointCatLabel(cat)}${pts.length}`)
    .join(' · ')
})
/** 通信在线率（%） */
const onlineRate = computed(() => {
  const p = snapshot.value?.points
  return p && p.total > 0 ? Math.round((p.online / p.total) * 100) : 0
})
const visibleCats = computed(() =>
  activeCat.value ? catKeys.value.filter((c) => c === activeCat.value) : catKeys.value,
)

// 卡片视图：平铺 + 分页
const POINT_PAGE_SIZE = 12
/** 视图模式：卡片 / 列表（列表仅 1600px 以上提供切换入口） */
const pointViewMode = ref<'grid' | 'list'>('grid')
const pointPage = ref(1)
/** 卡片视图下的平铺测点（受分类 chips 过滤，按分类顺序拼接） */
const flatPoints = computed(() => {
  const gv = snapshot.value?.grouped_values || {}
  return visibleCats.value.flatMap((c) => gv[c] || [])
})
const pagedPoints = computed(() =>
  flatPoints.value.slice((pointPage.value - 1) * POINT_PAGE_SIZE, pointPage.value * POINT_PAGE_SIZE),
)
watch([activeCat, selectedId], () => { pointPage.value = 1 })

// ========== 列表视图（el-table 分组折叠，无分页） ==========
/** 分组折叠状态：cat → 是否折叠 */
const collapsedCats = reactive<Record<string, boolean>>({})
function toggleCat(cat: string) {
  collapsedCats[cat] = !collapsedCats[cat]
}
/** 构造带分组标题行的表格数据：按分类顺序，组内序号 01..N */
const listViewRows = computed(() => {
  const rows: any[] = []
  const gv = snapshot.value?.grouped_values || {}
  visibleCats.value.forEach((cat) => {
    const items = gv[cat] || []
    rows.push({ __groupRow: true, __cat: cat, __total: items.length })
    if (!collapsedCats[cat]) {
      items.forEach((p, i) => {
        rows.push({ ...p, __cat: cat, __seq: String(i + 1).padStart(2, '0') })
      })
    }
  })
  return rows
})
/** 分组标题行：序号列留箭头，名称列横跨剩余 5 列 */
function listSpanMethod({ row, columnIndex }: { row: any; columnIndex: number }) {
  if (!row.__groupRow) return
  if (columnIndex === 0) return { rowspan: 1, colspan: 1 }
  if (columnIndex === 1) return { rowspan: 1, colspan: 5 }
  return { rowspan: 0, colspan: 0 }
}
function listRowClass({ row }: { row: any }) {
  return row.__groupRow ? 'lv-group-row' : ''
}
/** 分组行注入分类配色的 CSS 变量（主色 + 浅底 + 描边） */
function listRowStyle({ row }: { row: any }) {
  if (!row.__groupRow) return {}
  const main = pointCatColor(row.__cat)
  const rgb = hexToRgb(main)
  if (!rgb) return {}
  return {
    '--cat-main': main,
    '--cat-bg': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`,
    '--cat-bg-hover': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
    '--cat-border': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`,
  } as Record<string, string>
}
function hexToRgb(hex: string) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}
function goPointDetail(p: any) {
  if (p.equipment_id) router.push({ path: `/equipment/detail/${p.equipment_id}` })
}

/** 设备概况缩略图：按设备名称匹配 info 文件夹图片，无匹配则回退图标 */
const equipImage = computed(() => equipmentImageByName(selectedEquipment.value?.name || ''))
/** 下属设备条目缩略图：同一套名称匹配规则 */
const childImage = equipmentImage
/** 无图片时的缩略图标：水位/监测类用专属水位图标，其余按设备分类 */
const equipVisualIcon = computed(() => {
  const name = selectedEquipment.value?.name || ''
  if (/水位|监测站/.test(name)) return 'ri:water-percent-line'
  return typeIcon(selectedEquipment.value?.type_id ?? 0)
})

/** 未闭环告警状态（其余视为已关闭/已驳回） */
const ACTIVE_ALARM_STATUS = ['pending', 'processing', 'pending_accept']

async function loadDetailAlarms(eqId: number, force = false) {
  if (!force && alarmLoadedFor === eqId) return
  alarmLoadedFor = eqId
  alarmsLoading.value = true
  try {
    const { data } = await listAlarms({ equipment_id: eqId, page: 1, page_size: 50 })
    // 排序：未处理/未关闭的排前面，已关闭的排后面；同组内按告警时间倒序
    detailAlarms.value = (data.data.items || []).slice().sort((a, b) => {
      const aClosed = !ACTIVE_ALARM_STATUS.includes(a.alarm_status)
      const bClosed = !ACTIVE_ALARM_STATUS.includes(b.alarm_status)
      if (aClosed !== bClosed) return aClosed ? 1 : -1
      return (b.alarm_time || '').localeCompare(a.alarm_time || '')
    })
  } catch {
    detailAlarms.value = []
  } finally {
    alarmsLoading.value = false
  }
}

watch(activeDetailTab, (t) => {
  if (t === 'alarms' && selectedId.value != null) void loadDetailAlarms(selectedId.value)
})
// 切换设备时清空告警高亮，防止残留
watch(selectedId, () => {
  focusedAlarmIds.value = []
})

function alarmLevelLabel(l: number) {
  return ['', '一类紧急', '二类重要', '三类一般'][l] || `${l}级`
}
function alarmStatusLabel(s: string) {
  return (
    ({ pending: '待处理', processing: '处理中', pending_accept: '待验收', closed: '已闭环', rejected: '已驳回' }) as Record<string, string>
  )[s] || s
}

// 导出历史数据
const showExportDialog = ref(false)
const exporting = ref(false)
const exportUnit = ref('all')
const exportRange = ref<[string, string] | null>(null)
/** 当前选中的时间快捷项；手动选择日期时清空 */
const exportQuick = ref<'' | 'yesterday' | '3d' | '7d'>('')

/** 手动选择日期时，取消快捷项高亮 */
function onRangePick() {
  exportQuick.value = ''
}

/** 时间范围快捷项（日期面板侧边栏）：昨天 / 最近三天 / 最近一周 */
const exportShortcuts = [
  {
    text: '昨天',
    value: () => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      return [d, d]
    },
  },
  {
    text: '最近三天',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 2)
      return [start, end]
    },
  },
  {
    text: '最近一周',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 6)
      return [start, end]
    },
  },
]

const emptyForm = () => ({
  id: null as number | null,
  name: '',
  code: '',
  type_id: undefined as number | undefined,
  parent_id: undefined as number | undefined,
  scada_point_ids: '',
  manufacturer_id: undefined as number | undefined,
  maintainer_id: undefined as number | undefined,
  maintain_term_days: undefined as number | undefined,
  running_status: 'stopped',
  run_status_source: 'manual' as 'scada' | 'manual',
  maintain_status: 'normal',
  continuous_run_hours: 0,
  continuous_stop_hours: 0,
  production_date: undefined as string | undefined,
  purchase_date: undefined as string | undefined,
  first_run_date: undefined as string | undefined,
  remark: '',
  rated_params: {} as Record<string, string>,
  status: 1,
})

const form = reactive(emptyForm())

/** 按顶级父级分组的差异化档案字段模板（机组/闸门/真空/供水/排水/净水/配电/监测） */
const PROFILE_FIELD_TEMPLATES: [RegExp, string[]][] = [
  [/机组/, ['装机容量(kW)', '设计流量(m³/s)', '设计扬程(m)', '机组效率(%)']],
  [/闸门/, ['孔口尺寸', '设计水头(m)', '启闭机型式', '启闭力(kN)']],
  [/真空/, ['抽气速率(m³/min)', '极限真空度(kPa)']],
  [/供水|排水|净水/, ['额定流量(m³/h)', '额定扬程(m)', '额定功率(kW)']],
  [/配电/, ['额定电压(kV)', '额定电流(A)', '防护等级']],
  [/监测/, ['量程', '精度等级', '输出信号']],
]
/** 设备所在顶级分组名（沿 parent 链向上找根） */
function topGroupName(id: number | null | undefined): string {
  if (!id) return ''
  let node = findNode(rows.value, id)
  while (node?.parent_id) {
    node = findNode(rows.value, node.parent_id)
  }
  return node?.name || ''
}
/** 当前设备适用的档案扩展字段（按顶级分组匹配模板；设备自身是顶级时按自身名称） */
function profileFieldsFor(id: number | null | undefined, selfName?: string): string[] {
  const key = topGroupName(id) || selfName || ''
  return PROFILE_FIELD_TEMPLATES.find(([re]) => re.test(key))?.[1] || []
}
/** 表单当前应展示的扩展字段 */
const formProfileFields = computed(() => {
  const pid = form.parent_id
  return pid ? profileFieldsFor(pid) : []
})
/** 解析 rated_params JSON */
function parseRatedParams(raw?: string | null): Record<string, string> {
  if (!raw) return {}
  try { return JSON.parse(raw) as Record<string, string> } catch { return {} }
}
/** 当前选中设备的扩展档案参数 */
const selectedRatedParams = computed(() => parseRatedParams(selectedEquipment.value?.rated_params))

const formRef = ref<FormInstance>()
const rules: FormRules = {
  name: [{ required: true, message: '请填写设备名称', trigger: 'blur' }],
  code: [{ required: true, message: '请填写设备编号', trigger: 'blur' }],
  type_id: [{ required: true, message: '请选择设备分类', trigger: 'change' }],
}

// ========== 计算 ==========
/** 树过滤范围：从首页/其他页面带 equipment_id 进来时，只显示该顶级机组的树 */
const treeScopeId = ref<number | null>(null)
/** 首次加载（尚无树数据）时用骨架屏占位，避免"暂无数据"空态闪现 */
const treeBooting = computed(() => loading.value && rows.value.length === 0)
const treeData = computed(() => {
  if (!treeScopeId.value) return rows.value
  return rows.value.filter((r) => r.id === treeScopeId.value)
})
/** 设备总数：优先用 KPI stats 口径；若被过滤在单机组范围内则统计该机组节点数 */
const treeCount = computed(() => {
  if (treeScopeId.value) return countAll(treeData.value)
  return stats.value?.total ?? countAll(rows.value)
})

/** 递归统计树节点总数 */
function countAll(list: EquipmentItem[]): number {
  let n = 0
  for (const it of list) {
    n += 1
    if (it.children?.length) n += countAll(it.children)
  }
  return n
}

/** 在树中递归找设备 */
function findNode(list: EquipmentItem[], id: number): EquipmentItem | null {
  for (const it of list) {
    if (it.id === id) return it
    if (it.children?.length) {
      const f = findNode(it.children, id)
      if (f) return f
    }
  }
  return null
}

// ========== 懒加载树：节点 / 详情缓存 ==========
/** 已加载过的树节点（懒加载时子孙不在 rows 里，点击后从这里取兜底） */
const treeNodeMap = new Map<number, EquipmentItem>()
/** 设备 id → 父设备 id（懒加载逐层加载时登记，用于告警徽章增量向上汇总） */
const parentIdx = new Map<number, number | null>()
/** 选中设备详情缓存：树节点只有精简字段，完整字段按需拉 /equipment/{id} */
const detailCache = ref<Record<number, EquipmentItem>>({})
/** 懒加载模式下当前选中设备的直接子设备（底部下属设备卡） */
const lazyChildren = ref<EquipmentItem[]>([])
/** 懒加载树徽章以服务端子树汇总为基准，WS 新增告警时补增量 */
const badgeDelta = ref<Record<string, number>>({})

function registerTreeNodes(list: EquipmentItem[]) {
  for (const it of list) {
    treeNodeMap.set(it.id, it)
    parentIdx.set(it.id, it.parent_id ?? null)
    if (it.children?.length) registerTreeNodes(it.children)
  }
}

const selectedEquipment = computed<EquipmentItem | null>(() => {
  const id = selectedId.value
  if (!id) return null
  const base = findNode(rows.value, id) ?? treeNodeMap.get(id) ?? null
  const full = detailCache.value[id]
  if (!base) return full ?? null
  return full ? { ...base, ...full } : base
})
const selectedChildren = computed(() =>
  treeLazy.value ? lazyChildren.value : selectedEquipment.value?.children || [],
)

// ========== 告警工具 ==========
/** 设备自身告警数（不含子设备） */
function selfAlarmCount(eq: EquipmentItem): number {
  return alarmCountOf(eq, alarmCounts.value)
}
/** 设备告警数（顶级含自身+所有子设备，子设备等于自身） */
function totalAlarmCount(eq: EquipmentItem | null | undefined): number {
  if (!eq) return 0
  // 懒加载：服务端已按子树算好，直接叠加 WS 新增增量
  if (typeof eq.alarm_total === 'number') {
    return eq.alarm_total + (badgeDelta.value[String(eq.id)] ?? 0)
  }
  let n = selfAlarmCount(eq)
  if (eq.children?.length) {
    for (const c of eq.children) n += totalAlarmCount(c)
  }
  return n
}
/** 设备自身最高告警等级（1紧急 2重要 3一般；0=无告警） */
function selfAlarmLevel(eq: EquipmentItem): number {
  return alarmLevelOf(eq, alarmLevels.value)
}
/** 设备最高告警等级（顶级汇总自身+所有子设备，取最小数值即最高等级） */
function totalAlarmLevel(eq: EquipmentItem | null | undefined): number {
  if (!eq) return 0
  if (typeof eq.alarm_level === 'number') return eq.alarm_level
  let lv = selfAlarmLevel(eq)
  if (eq.children?.length) {
    for (const c of eq.children) {
      const clv = totalAlarmLevel(c)
      if (clv > 0 && (lv === 0 || clv < lv)) lv = clv
    }
  }
  return lv
}

// ========== 左侧树：筛选 chips + 运行状态文案 + 未闭环工单数 ==========
const treeFilter = ref<'all' | 'running' | 'alarm'>('all')
/** 按 chips 过滤后的树：命中自身或任一子孙命中都保留 */
const treeViewData = computed(() => {
  if (treeFilter.value === 'all') return treeData.value
  const keep = (n: EquipmentItem): EquipmentItem | null => {
    const kids = (n.children || []).map(keep).filter(Boolean) as EquipmentItem[]
    const selfOk =
      treeFilter.value === 'running' ? n.running_status === 'running' : totalAlarmCount(n) > 0
    if (selfOk || kids.length) return { ...n, children: kids }
    return null
  }
  return treeData.value.map(keep).filter(Boolean) as EquipmentItem[]
})
/** 树 props：isLeaf 用于懒加载判断是否还有下一层 */
const TREE_PROPS = { label: 'name', children: 'children', isLeaf: 'is_leaf' }
/**
 * 懒加载模式下 el-tree 的 data 必须用稳定引用：每次渲染都传新的 [] 会触发
 * el-tree 内部对 data 的深度 watch，把已懒加载出来的子节点清空。
 */
const EMPTY_TREE_DATA: EquipmentItem[] = []
/**
 * 懒加载模式：无搜索关键字、无 chips 筛选、无单机组范围、无 KPI 筛选、非带参定位时，
 * 只按需逐层加载；出现上述场景才回退全量树，保证筛选/定位语义不变。
 */
const treeLazy = computed(
  () =>
    !treeKw.value.trim() &&
    treeFilter.value === 'all' &&
    !treeScopeId.value &&
    !cardFilter.value &&
    !presetEqId,
)
/** 树模式切换用 key：懒加载/全量切换时重挂载 el-tree */
const treeModeKey = ref(0)
function treeRunLabel(e: EquipmentItem) {
  if (e.has_data === false) return '未接入'
  return e.running_status === 'running' ? '运行中' : '停机'
}
function treeRunTone(e: EquipmentItem) {
  if (e.has_data === false) return 'is-unlinked'
  return e.running_status === 'running' ? 'is-running' : 'is-stopped'
}

/** 未闭环工单计数（equipment_id → 条数） */
const repairCounts = ref<Record<string, number>>({})
const OPEN_REPAIR_STATES = ['pending_dispatch', 'dispatched', 'processing', 'pending_accept']
function selfRepairCount(eq: EquipmentItem): number {
  return repairCounts.value[String(eq.id)] ?? 0
}
/** 设备工单数（顶级含自身+所有子设备） */
function totalRepairCount(eq: EquipmentItem | null | undefined): number {
  if (!eq) return 0
  if (typeof eq.repair_total === 'number') return eq.repair_total
  let n = selfRepairCount(eq)
  if (eq.children?.length) {
    for (const c of eq.children) n += totalRepairCount(c)
  }
  return n
}
async function loadRepairCounts() {
  try {
    const { data } = await listRepairs({ page: 1, page_size: 200 })
    const items = data.data?.items || []
    const m: Record<string, number> = {}
    for (const o of items) {
      if (!o.equipment_id || !OPEN_REPAIR_STATES.includes(o.process_status)) continue
      const k = String(o.equipment_id)
      m[k] = (m[k] ?? 0) + 1
    }
    repairCounts.value = m
  } catch {
    repairCounts.value = {}
  }
}

// 测点分类辅助
const POINT_CAT_LABEL: Record<string, string> = {
  temperature: '温度',
  electrical: '电气',
  hydraulic: '水力',
  switch: '开关量',
  other: '其他',
}
const POINT_CAT_COLOR: Record<string, string> = {
  temperature: '#f08a24',
  electrical: '#0e7ff0',
  hydraulic: '#10c99a',
  switch: '#8b67dd',
  other: '#64748b',
}
const POINT_CAT_ICON: Record<string, string> = {
  temperature: 'ri:thermometer-line',
  electrical: 'ri:flashlight-line',
  hydraulic: 'ri:water-flash-line',
  switch: 'ri:toggle-line',
  other: 'ri:apps-2-line',
}
function pointCatLabel(cat: string) { return POINT_CAT_LABEL[cat] || cat }
function pointCatColor(cat: string) { return POINT_CAT_COLOR[cat] || '#64748b' }
function pointCatIcon(cat: string) { return POINT_CAT_ICON[cat] || 'ri:apps-2-line' }

// 越限等级辅助
const OVER_LEVEL_COLOR: Record<string, string> = {
  hihi: '#ff3b5c',
  hi: '#f08a24',
  lo: '#0e7ff0',
  lolo: '#10c99a',
}
const OVER_LEVEL_LABEL: Record<string, string> = {
  hihi: 'HHI',
  hi: 'HI',
  lo: 'LO',
  lolo: 'LOL',
}
function overLevelColor(level: string) { return OVER_LEVEL_COLOR[level] || '#f08a24' }
function overLevelLabel(level: string) { return OVER_LEVEL_LABEL[level] || level.toUpperCase() }

// ========== 事实快照加载（一次请求搞定测点/越限/运维画像） ==========
async function loadSnapshot(eqId: number, silent = false) {
  if (!silent) snapshotLoading.value = true
  try {
    const { data } = await fetchEquipmentSnapshot(eqId)
    snapshot.value = data.data
    startRunCountdown()  // 选中/刷新设备后重启连续时长倒计时
  } catch {
    if (!silent) snapshot.value = null
  } finally {
    if (!silent) snapshotLoading.value = false
  }
}

/** 选中设备变化时刷新快照，并重置详情页签/筛选/告警缓存 */
watch(selectedId, async (id) => {
  activeDetailTab.value = 'monitor'
  activeCat.value = ''
  detailAlarms.value = []
  alarmLoadedFor = 0
  if (id != null) {
    void loadSnapshot(id)
  } else {
    snapshot.value = null
  }
})

// ========== 自动刷新机制（对应 SCADA 推送前的轮询方案） ==========
// 页面可见、停留在实时监测页签且选中设备时，每 5 秒静默拉一次当前设备快照；
// 切设备/切页签/页面隐藏自动暂停，组件卸载清除定时器，不会累积刷新造成卡顿。
let snapshotTimer: ReturnType<typeof setInterval> | undefined
function stopSnapshotTimer() {
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = undefined }
}
function startSnapshotTimer() {
  stopSnapshotTimer()
  snapshotTimer = setInterval(() => {
    if (document.hidden || activeDetailTab.value !== 'monitor') return
    if (selectedId.value != null && !snapshotLoading.value) void loadSnapshot(selectedId.value, true)
  }, 5000)
}
onMounted(startSnapshotTimer)
onBeforeUnmount(() => { stopSnapshotTimer(); stopRunCountdown() })

// ========== 连续时长格式化 ==========
/** 秒数 → 友好字符串，如 132420 → "36h 47min"；<1h 按分钟；<1min 按秒 */
function formatDuration(sec: number | null | undefined): string {
  sec = sec ?? 0
  if (!sec || sec < 0) return '—'
  const d = Math.floor(sec / 86400); sec -= d * 86400
  const h = Math.floor(sec / 3600); sec -= h * 3600
  const m = Math.floor(sec / 60); const s = sec % 60
  const parts: string[] = []
  if (d) parts.push(`${d}天`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}min`)
  if (!parts.length) parts.push(`${s}s`)
  return parts.join(' ')
}
/** ISO8601 起始时间 → 友好字符串，如 "2026-10-29 08:00" */
function formatSinceDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    // 同一年省略年份，否则完整显示
    if (d.getFullYear() === now.getFullYear()) {
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '—' }
}
/** 累计小时 → 友好展示：整数不带小数，否则 1 位小数；0 显示 0 */
function formatH(h: number | null | undefined): string {
  const v = Number(h ?? 0)
  if (!v || v <= 0) return '0'
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
function maintainLabel(v: string) {
  return (
    ({ normal: '正常', need_maintain: '需保养', fault: '故障待修' } as Record<string, string>)[v] || v
  )
}
function runToneClass(v: string) {
  return ({ running: 'tone-running', stopped: 'tone-stopped', fault: 'tone-fault', overhaul: 'tone-stopped' } as Record<string, string>)[v] || 'tone-stopped'
}

// ========== 运行状态心电图 ==========
/** 心电图波形（两段心跳） */
const ECG_PATH = 'M0 14 H14 L18 14 L21 4 L25 24 L29 8 L33 18 L37 14 H52 L56 14 L59 4 L63 24 L67 8 L71 18 L75 14 H90 L94 14 L97 4 L101 24 L105 8 L109 18 L113 14 H132'
/** 停机：一条直线 */
const ECG_FLAT_PATH = 'M0 14 H132'
const isRunning = computed(() => selectedEquipment.value?.running_status === 'running')
/** 详情卡左侧色条：未接入=灰，其余按运行状态 */
const detailToneClass = computed(() =>
  selectedEquipment.value?.has_data === false
    ? 'tone-unlinked'
    : runToneClass(selectedEquipment.value?.running_status || ''),
)
/** 是否已接入实时/历史数据；未接入时运行状态不可信 */
const hasData = computed(() => selectedEquipment.value?.has_data !== false)
function hasRated(e: EquipmentItem) {
  return !!(e.rated_power_kw != null || e.rated_flow_m3s != null || e.unit_no != null)
}

// ========== 树操作 ==========
function onTreeClick(data: EquipmentItem) {
  selectedId.value = data.id
  highlightId.value = data.id
  void loadLazySelection(data.id)
}
function selectEquipment(id: number) {
  selectedId.value = id
  highlightId.value = id
  void loadLazySelection(id)
  nextTick(() => treeRef.value?.setCurrentKey(id))
}
function selectFirst() {
  if (rows.value.length) selectEquipment(rows.value[0].id)
}

function filterNode(value: string, data: EquipmentItem) {
  if (!value) return true
  return data.name.includes(value) || (data.code || '').includes(value)
}

/** 懒加载：展开节点时才请求下一层（字段精简 + is_leaf），根节点复用 load() 已取的数据 */
async function loadTreeNode(node: any, resolve: (data: any) => void) {
  if (node.level === 0) {
    if (!rows.value.length) {
      // 树在数据回来之前就挂载时兜底：直接取一次顶级，避免根节点空态后不再重试
      try {
        const { data } = await listEquipment({ lazy: true, page: 1, page_size: 200 })
        rows.value = data.data.items || []
        registerTreeNodes(rows.value)
      } catch {
        /* 交给空态 */
      }
    }
    resolve(rows.value)
    return
  }
  const pid = node.data?.id as number | undefined
  if (!pid) {
    resolve([])
    return
  }
  try {
    const { data } = await listEquipment({ lazy: true, parent_id: pid, page: 1, page_size: 200 })
    const items: EquipmentItem[] = data.data.items || []
    registerTreeNodes(items)
    resolve(items)
  } catch {
    resolve([])
  }
}

/** 懒加载模式：选中节点时按需补全详情字段 + 拉取直接子设备（底部卡） */
async function loadLazySelection(id: number) {
  if (!treeLazy.value) return
  void ensureDetail(id)
  try {
    const { data } = await listEquipment({ lazy: true, parent_id: id, page: 1, page_size: 200 })
    const items: EquipmentItem[] = data.data.items || []
    registerTreeNodes(items)
    lazyChildren.value = items
  } catch {
    lazyChildren.value = []
  }
}

/** 拉取并缓存设备完整详情（树节点只有精简字段） */
async function ensureDetail(id: number) {
  if (detailCache.value[id]) return
  try {
    const { data } = await fetchEquipmentDetail(id)
    detailCache.value = { ...detailCache.value, [id]: data.data }
  } catch {
    /* 失败时保留树节点精简字段兜底 */
  }
}

/** 取完整设备字段（编辑表单需要全字段；懒加载下先按需补详情） */
async function ensureFullEquipment(row: EquipmentItem): Promise<EquipmentItem> {
  if (!treeLazy.value) return row
  const cached = detailCache.value[row.id]
  if (cached) return { ...row, ...cached }
  try {
    const { data } = await fetchEquipmentDetail(row.id)
    detailCache.value = { ...detailCache.value, [row.id]: data.data }
    return { ...row, ...data.data }
  } catch {
    return row
  }
}

/** WS 新增告警：沿父链累加增量，让懒加载树的子树徽章同步 +1 */
function bumpBadgeDelta(eid: number) {
  const next = { ...badgeDelta.value }
  let cur: number | null | undefined = eid
  while (cur != null) {
    const k = String(cur)
    next[k] = (next[k] ?? 0) + 1
    cur = parentIdx.get(cur)
  }
  badgeDelta.value = next
}

// ========== 工单跳转 ==========
const REPAIR_STATUS_LABEL: Record<string, string> = {
  pending_dispatch: '待派单',
  dispatched: '已派单',
  processing: '处置中',
  pending_accept: '待验收',
}
const REPAIR_SOURCE_LABEL: Record<string, string> = {
  alarm: '告警触发',
  manual: '人工报修',
  inspection: '巡检触发',
  maintenance: '维保计划',
}
function goRepairList(equipmentId?: number) {
  router.push({
    name: 'repair-list',
    query: equipmentId ? { equipment_id: String(equipmentId) } : {},
  })
}
/** 运维概况区「未闭环告警」点击 → 跳告警中心，显示全量 */
function goAlarmRealtime(e: EquipmentItem | null) {
  if (!e) return
  router.push({ path: '/alarm/realtime' })
}
const CLOSED_ALARM_STATES = ['closed', 'rejected', 'reopened']
function goAlarmHistory(e: EquipmentItem | null, alarm?: AlarmItem) {
  if (!e) return
  // 有 repair_order_no → 跳维修工单页 + 高亮对应工单行（显示全量工单）
  if (alarm?.repair_order_no) {
    router.push({ path: '/repair/list', query: { focus: alarm.repair_order_no } })
    return
  }
  // 无 repair_order_no → 跳告警中心 + 高亮对应告警行（显示全量告警）
  if (alarm?.id) {
    const isOpen = !CLOSED_ALARM_STATES.includes(alarm.alarm_status)
    router.push({
      path: '/alarm/realtime',
      query: {
        ...(isOpen ? {} : { tab: 'history' }),
        focus: String(alarm.id),
      },
    })
    return
  }
  // 降级：跳告警中心历史 tab
  router.push({
    path: '/alarm/realtime',
    query: { tab: 'history' },
  })
}
watch(treeKw, (val) => {
  treeRef.value?.filter(val)
})
// 切换分类 chips 后树数据重算，需重新套用搜索关键字过滤
watch(treeFilter, () => {
  nextTick(() => treeRef.value?.filter(treeKw.value))
})
// 懒加载 / 全量树切换：按新模式重新取数并重挂载树（key 变化才会重新走 lazy load）
watch(treeLazy, async () => {
  await load()
  treeModeKey.value += 1
  await nextTick()
  if (treeKw.value) treeRef.value?.filter(treeKw.value)
})

// ========== 数据加载 ==========
async function loadStats() {
  const { data } = await fetchEquipmentStats()
  stats.value = data.data
}

async function load() {
  loading.value = true
  try {
    const { data } = await listEquipment({
      page: 1,
      page_size: 200,
      // 懒加载模式只取顶级（字段精简），展开时再逐层拉；筛选/定位场景用全量树
      ...(treeLazy.value ? { lazy: true } : { tree: true }),
      name: query.name || undefined,
      code: query.code || undefined,
      running_status: cardFilter.value === 'running' ? cardFilter.value : undefined,
      offline: cardFilter.value === 'offline' ? true : undefined,
      repair_state:
        cardFilter.value === 'pending' || cardFilter.value === 'overhaul'
          ? cardFilter.value
          : undefined,
    })
    rows.value = data.data.items
    registerTreeNodes(rows.value)
    // 恢复选中（搜索后如果之前选中的还在树里，保持选中）
    if (
      selectedId.value &&
      !findNode(rows.value, selectedId.value) &&
      !treeNodeMap.has(selectedId.value)
    ) {
      selectedId.value = rows.value[0]?.id ?? null
    }
  } finally {
    loading.value = false
  }

  // 懒加载节点自带子树徽章汇总，不用再拉本地计数表
  if (treeLazy.value) {
    void loadStats()
    void loadRepairCounts()
    return
  }

  // 辅助数据（统计卡 / 告警徽章 / 维修数）：树已渲染可交互，这几项在后台并行补齐，
  // 不再阻塞 loading 解除，避免首屏要等全部请求返回才可用
  const allIds: number[] = []
  function collect(list: EquipmentItem[]) {
    for (const it of list) {
      allIds.push(it.id)
      if (it.children?.length) collect(it.children)
    }
  }
  collect(rows.value)
  void loadStats()
  if (allIds.length) {
    fetchAlarmCounts(allIds)
      .then(({ data: c }) => {
        const r: AlarmCountsResult = c.data
        alarmCounts.value = r.counts || {}
        alarmLevels.value = r.highest_levels || {}
      })
      .catch(() => {
        alarmCounts.value = {}
        alarmLevels.value = {}
      })
  }
  void loadRepairCounts()
}

function onSearch() { load() }
function onReset() {
  query.name = ''
  query.code = ''
  load()
}
function onKpiClick(key: '' | 'running' | 'pending' | 'overhaul' | 'offline') {
  const lazyBefore = treeLazy.value
  // 点"设备总数"（空筛选）→ 同时清掉单机组范围过滤，恢复全量
  if (key === '') {
    cardFilter.value = ''
    treeScopeId.value = null
  } else {
    cardFilter.value = cardFilter.value === key ? '' : key
  }
  // 树模式发生切换时由 treeLazy 的 watcher 统一重新取数，避免重复请求
  if (treeLazy.value === lazyBefore) load()
}

// ========== 表单/CRUD ==========
function openCreate() {
  Object.assign(form, emptyForm())
  visible.value = true
}
async function openEdit(row: EquipmentItem) {
  // 懒加载树节点只有精简字段，编辑前按需补齐完整档案，避免保存时把其他字段清空
  const full = await ensureFullEquipment(row)
  Object.assign(form, emptyForm(), full)
  form.rated_params = parseRatedParams(full.rated_params)
  visible.value = true
}
async function onSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const payload = { ...form }
  delete (payload as { id?: number | null }).id
  delete (payload as { run_status_source?: string }).run_status_source
  // 扩展档案字段序列化；空对象不提交
  const rated = Object.fromEntries(Object.entries(form.rated_params || {}).filter(([, v]) => v !== ''))
  ;(payload as unknown as { rated_params?: string }).rated_params =
    Object.keys(rated).length ? JSON.stringify(rated) : undefined
  if (form.id) await updateEquipment(form.id, payload)
  else await createEquipment(payload)
  ElMessage.success('保存成功')
  visible.value = false
  await load()
}
/** 统计设备在树中的全部子孙数量 */
function countDescendants(id: number): number {
  const find = (list: EquipmentItem[]): EquipmentItem | null => {
    for (const it of list) {
      if (it.id === id) return it
      const hit = find(it.children || [])
      if (hit) return hit
    }
    return null
  }
  const node = find(rows.value)
  let count = 0
  const walk = (n: EquipmentItem) => (n.children || []).forEach((c) => { count++; walk(c) })
  if (node) walk(node)
  return count
}
/** 删除确认文案：有关联子设备时明确提示级联删除 */
function deleteConfirmText(eq: EquipmentItem): string {
  const n = countDescendants(eq.id)
  if (n > 0) {
    return `确认删除设备「${eq.name}」？其下关联的 ${n} 台子设备将一并删除，且不可恢复。`
  }
  // 懒加载模式下子孙未加载，用 is_leaf 兜底提示存在下级设备
  if (eq.is_leaf === false) {
    return `确认删除设备「${eq.name}」？其下关联的子设备将一并删除，且不可恢复。`
  }
  return `确认删除设备「${eq.name}」？`
}
async function onDelete(row: EquipmentItem) {
  await deleteEquipment(row.id)
  ElMessage.success('已删除')
  if (selectedId.value === row.id) {
    selectedId.value = row.parent_id ?? rows.value[0]?.id ?? null
  }
  await load()
}

function openDetail(row: EquipmentItem) {
  router.push({ name: 'equipment-detail', params: { id: row.id } })
}
function goRepair(row: EquipmentItem | null) {
  if (!row) return
  router.push({ path: '/repair/list', query: { equipment_id: String(row.id) } })
}
/** 待检修/检修中标签 → 跳维修工单列表，显示全量 + 若有已关联工单数则带 ?focus= 自动高亮 */
async function goRepairOrders(row: EquipmentItem | null) {
  if (!row) return
  const query: Record<string, string> = {}
  try {
    // 查一条未闭环且已派工的告警 → 用工单号定位工单页
    const { data } = await listAlarms({ equipment_id: row.id, page: 1, page_size: 20 })
    const alarms: AlarmItem[] = data.data.items || []
    const withRepair = alarms.find((a) => a.repair_order_no)
    if (withRepair?.repair_order_no) query.focus = withRepair.repair_order_no
  } catch {
    /* API 失败忽略 */
  }
  router.push({ path: '/repair/list', query })
}
/** 告警徽标 hover 提示 */
function alarmBadgeTitle(eq: EquipmentItem | null): string {
  if (!eq) return ''
  const cnt = totalAlarmCount(eq)
  const lv = totalAlarmLevel(eq)
  const lvLabel = ['', '紧急', '重要', '一般'][lv] || '未知'
  return `${cnt} 条未闭环告警，最高${lvLabel}级；点击查看相关告警`
}
/** 告警徽标点击 → 只切本页「告警记录」tab，不高亮 */
function goAlarmBadge(eq: EquipmentItem | null) {
  if (!eq) return
  if (selectedId.value !== eq.id) {
    selectedId.value = eq.id
  }
  activeDetailTab.value = 'alarms'
}

async function doExport() {
  exporting.value = true
  try {
    const params: { unit: string; start?: string; end?: string } = { unit: exportUnit.value }
    if (exportRange.value) {
      params.start = `${exportRange.value[0]} 00:00:00`
      params.end = `${exportRange.value[1]} 23:59:59`
    }

    const res = await fetchUnitReportExport(params)
    const blob = new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const unitLabel = exportUnit.value === 'all' ? '全部机组' : `机组${exportUnit.value}`
    const dateLabel = exportRange.value
      ? `${exportRange.value[0]}_${exportRange.value[1]}`
      : '全部时间'
    link.download = `机组运行日报_${unitLabel}_${dateLabel}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showExportDialog.value = false
    ElMessage.success('导出完成')
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || '导出失败'
    ElMessage.error(msg)
  } finally {
    exporting.value = false
  }
}

// ========== 内联新建 ==========
type InlineKind = 'manufacturer' | 'maintainer'
const INLINE_META: Record<InlineKind, { title: string; path: string; needCode: boolean }> = {
  manufacturer: { title: '新建生产厂商', path: '/manufacturers', needCode: false },
  maintainer: { title: '新建维保厂商', path: '/maintenance-vendors', needCode: false },
}
async function openInline(kind: InlineKind) {
  const meta = INLINE_META[kind]
  await new Promise((resolve) => window.setTimeout(resolve, 200))
  const state = reactive({ name: '', code: `LOC${Date.now().toString().slice(-8)}` })
  const fieldLabel = (text: string) =>
    h('div', { style: 'font-size:13px;margin:4px 0 6px;color:var(--art-gray-600)' }, text)
  try {
    await ElMessageBox({
      title: meta.title,
      confirmButtonText: '保存并选用',
      cancelButtonText: '取消',
      customStyle: { width: '420px' },
      message: () =>
        h('div', { style: 'padding: 8px 4px 0' }, [
          fieldLabel('名称'),
          h(ElInput, {
            modelValue: state.name,
            'onUpdate:modelValue': (v: string) => (state.name = v),
            maxlength: 128,
            placeholder: '请输入名称',
          }),
          ...(meta.needCode
            ? [
                fieldLabel('编码'),
                h(ElInput, {
                  modelValue: state.code,
                  'onUpdate:modelValue': (v: string) => (state.code = v),
                  maxlength: 64,
                  placeholder: '请输入唯一编码',
                }),
              ]
            : []),
        ]),
      beforeClose: (action: string, _instance: unknown, done: () => void) => {
        if (action === 'confirm') {
          if (!state.name.trim()) { ElMessage.warning('请填写名称'); return }
          if (meta.needCode && !state.code.trim()) { ElMessage.warning('请填写编码'); return }
        }
        done()
      },
    })
  } catch { return }

  const body: Record<string, string> = { name: state.name.trim() }
  if (meta.needCode) body.code = state.code.trim()
  const { data } = await createResource<{ id: number; name: string }>(meta.path, body)
  const created = data.data
  if (kind === 'manufacturer') { manufacturers.value.push({ id: created.id, name: created.name }); form.manufacturer_id = created.id }
  else { maintainers.value.push({ id: created.id, name: created.name }); form.maintainer_id = created.id }
  ElMessage.success('已创建，数据已同步到对应主数据模块')
}

// ========== 生命周期 ==========
const pageReady = ref(false)

onMounted(async () => {
  pageReady.value = true
  const kw = (route.query.kw as string | undefined)?.trim()
  if (kw) query.code = kw

  // 下拉选项与设备树并行加载：不再串行等待 3 个 options 返回后才请求树
  const [, t, m, v] = await Promise.all([
    load(),
    optionsResource('/equipment-types/options'),
    optionsResource('/manufacturers/options'),
    optionsResource('/maintenance-vendors/options'),
  ])
  types.value = t.data.data
  manufacturers.value = m.data.data
  maintainers.value = v.data.data

  // 优先：从其他页面带 equipment_id → 自动选中该设备；若是顶级机组，同时把树过滤到该机组
  if (presetEqId && rows.value.length) {
    let target: EquipmentItem | null = findNode(rows.value, presetEqId)
    if (target?.parent_id) {
      // 子设备 → 选中父级机组，树过滤也按父级
      target = rows.value.find((r) => r.id === target!.parent_id) ?? target
    }
    if (target) {
      selectedId.value = target.id
      treeScopeId.value = target.parent_id ? null : target.id // 顶级机组才过滤范围
      await nextTick()
      treeRef.value?.setCurrentKey(target.id)
    }
  } else if (!selectedId.value && rows.value.length) {
    // 默认选中一号机组（顶级第一台），并触发详情/子设备按需加载
    selectEquipment(rows.value[0].id)
  }

  // 工作台跳转定位（kw 搜索保留）
  if (kw) {
    const hit = findNode(rows.value.filter(() => true) as unknown as EquipmentItem[], 0)
    void hit // 保留
  }

  // 连接告警 WebSocket，实时更新徽章
  connectAlarmWs()
  offAlarmWs = onAlarmEvent((event, data) => {
    if (event === 'alarm.created' && data && typeof data === 'object') {
      const payload = data as { equipment_id?: number; alarm_level?: number }
      const eid = payload.equipment_id
      const lv = payload.alarm_level ?? 3
      if (!eid) return
      const key = String(eid)
      alarmCounts.value = { ...alarmCounts.value, [key]: (alarmCounts.value[key] ?? 0) + 1 }
      // 懒加载树徽章基于服务端子树汇总，新增告警沿父链补增量
      bumpBadgeDelta(eid)
      // 更新最高等级（数值越小等级越高：1 > 2 > 3）
      const curLv = alarmLevels.value[key] ?? 0
      if (curLv === 0 || lv < curLv) {
        alarmLevels.value = { ...alarmLevels.value, [key]: lv }
      }
    } else if (event === 'alarm.closed' || event === 'alarm.handled') {
      // 告警闭环/处理后，重新拉一次计数（简单可靠，后续可做精确递减）
      void refreshAlarmCounts()
    }
  })
})

let offAlarmWs: (() => void) | null = null
onUnmounted(() => {
  offAlarmWs?.()
  offAlarmWs = null
  disconnectAlarmWs()
})

/** 刷新所有设备的告警计数/等级（告警闭环后兜底重新拉） */
async function refreshAlarmCounts() {
  const allIds: number[] = []
  function collect(list: EquipmentItem[]) {
    for (const it of list) {
      allIds.push(it.id)
      if (it.children?.length) collect(it.children)
    }
  }
  collect(rows.value)
  if (!allIds.length) return
  try {
    const { data: c } = await fetchAlarmCounts(allIds)
    const r: AlarmCountsResult = c.data
    alarmCounts.value = r.counts || {}
    alarmLevels.value = r.highest_levels || {}
  } catch {
    /* 静默 */
  }
}

const kpiCards = computed(() => {
  const s = stats.value
  const running = s?.running ?? 0
  const overhaul = s?.overhaul ?? 0
  const pending = s?.pending ?? 0
  const offline = s?.offline ?? 0
  const ratio = (v?: number) => (s ? (v ?? 0) : null)
  return [
    {
      key: '' as const, label: '设备总数', value: s?.total ?? '—', unit: s ? '台' : '',
      metrics: [{ label: '正常运行', value: `${running} 台` }, { label: '离线', value: `${offline} 台` }],
      percent: ratio(s?.running_ratio), percentSuffix: '运行中', color: '#168AF6',
      bgImage: eqBgTotal, iconImage: eqIconTotal, sideImage: eqSideTotal,
    },
    {
      key: 'running' as const, label: '在线设备', value: s?.running ?? '—', unit: s ? '台' : '',
      metrics: [{ label: '离线设备', value: `${offline} 台` }, { label: '在线率', value: `${s?.running_ratio ?? 0}%` }],
      percent: ratio(s?.running_ratio), color: '#10c99a',
      bgImage: eqBgOnline, iconImage: eqIconOnline, sideImage: eqSideOnline,
    },
    {
      key: 'pending' as const, label: '待检修设备', value: s?.pending ?? '—', unit: s ? '台' : '',
      metrics: [{ label: '待检修', value: `${pending} 台` }, { label: '占比', value: `${s?.pending_ratio ?? 0}%` }],
      percent: ratio(s?.pending_ratio), color: '#f08a24',
      bgImage: eqBgInspect, iconImage: eqIconInspect, sideImage: eqSideInspect,
    },
    {
      key: 'overhaul' as const, label: '检修中设备', value: s?.overhaul ?? '—', unit: s ? '台' : '',
      metrics: [{ label: '检修中', value: `${overhaul} 台` }, { label: '占比', value: `${s?.overhaul_ratio ?? 0}%` }],
      percent: ratio(s?.overhaul_ratio), color: '#8B67DD',
      bgImage: eqBgOverhaul, iconImage: eqIconOverhaul, sideImage: eqSideOverhaul,
    },
    {
      key: 'offline' as const, label: '离线设备', value: s?.offline ?? '—', unit: s ? '台' : '',
      metrics: [{ label: '停机/离线', value: `${offline} 台` }, { label: '离线率', value: `${s?.offline_ratio ?? 0}%` }],
      percent: ratio(s?.offline_ratio), color: '#ff3b5c',
      bgImage: eqBgFault, iconImage: eqIconFault, sideImage: eqSideFault,
    },
  ]
})


</script>

<style lang="scss" scoped>
@use '@styles/core/breakpoints.scss' as bp;

.page.mod-asset {
  .warn { margin-bottom: 12px; }
  .warn-item {
    display: flex; align-items: center; gap: 8px; padding: 2px 0;
    cursor: pointer; border-radius: 4px; transition: background-color 0.15s;
  }
  .warn-item:hover { background: rgba(240, 138, 36, 0.12); }
  .warn-text { flex: 1; min-width: 0; }
  .warn-entry { color: #176bff; font-size: 12px; opacity: 0.85; }

  .btn-icon { margin-right: 4px; font-size: 15px; vertical-align: -2px; }
  :deep(.select-add-btn) {
    width: 100%; border-top: 1px solid var(--el-border-color-lighter); border-radius: 0;
  }
}

/* ============ 档案布局 ============ */
.asset-layout {
  display: flex;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
  /* 硬高度约束：让内部 overflow 容器真正滚，外层页面不跟着被撑
     上方 KPI 面板 + 外层 tabs + 设备台账页签 约 280px */
  height: calc(100vh - 280px);
  /* 最小可用高度：视口不够高时不再压缩内容，改由外层 #app-main 出现整页滚动条 */
  min-height: 620px;
}
.tree-card {
  flex: 0 0 360px;
  display: flex;
  flex-direction: column;
  overflow-y: auto !important;
  min-height: 0;
  background: rgb(255 255 255 / 72%) !important;
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid rgb(200 220 240 / 30%);
}
.tree-card :deep(.el-card__header) {
  background: transparent !important;
  border-bottom: 1px solid rgb(200 220 240 / 25%);
}
/* 设备列表内容整体左移：收紧左右内边距 */
.tree-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  overflow: hidden;
}
.tree-head {
  display: flex;
  align-items: center;
  gap: 10px;
  .tree-head-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
  }
  .th-ico { color: #0e7ff0; font-size: 16px; }
  .th-title { font-weight: 700; font-size: 16px; color: #0b1e33; }
  .th-count {
    background: #eef5ff;
    color: #0e7ff0;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .tree-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    .el-button {
      width: 34px;
      height: 34px;
      padding: 0;
      font-size: 17px;
      margin-left: 0;
    }
    /* 新增：蓝色圆底 + 白色加号（与设计图一致） */
    .th-add {
      :deep(.el-icon),
      :deep(svg) { color: #fff; }
    }
    /* 导出：描边圆形图标按钮 */
    .th-export {
      color: #0e7ff0;
      border-color: #cfe4ff;
      background: #f4f9ff;
      &:hover,
      &:focus { color: #0e7ff0; border-color: #0e7ff0; background: #e8f2ff; }
    }
  }
}
.tree-search {
  margin-bottom: 10px;
}
/* 分类 chips（全部 / 运行中 / 有告警） */
.tree-chips {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  .tchip {
    flex: 1;
    height: 30px;
    border: 1px solid #e3ecf7;
    border-radius: 8px;
    background: #fff;
    color: #5a6a7d;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    &:hover { border-color: #cfe4ff; color: #0e7ff0; }
    &.is-on {
      border-color: #0e7ff0;
      background: #eaf3ff;
      color: #0e7ff0;
      font-weight: 600;
    }
  }
}
/* 树列表小表头：运行状态 | 关联事项 */
.tree-col-head {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  padding: 0 8px 6px;
  font-size: 12px;
  color: #8a9bb0;
}
/* 树首次加载骨架屏：6 行灰条 + 扫光，替代"暂无数据"空态 */
.tree-skeleton {
  flex: 1;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  .ts-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 24px;
  }
  .ts-ico,
  .ts-line,
  .ts-tag {
    background: linear-gradient(90deg, #e9f0f8 25%, #f6faff 37%, #e9f0f8 63%);
    background-size: 400% 100%;
    border-radius: 6px;
    animation: ts-shimmer 1.2s ease-in-out infinite;
  }
  .ts-ico {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
  }
  .ts-line {
    flex: 1;
    height: 10px;
  }
  .ts-tag {
    flex-shrink: 0;
    width: 44px;
    height: 10px;
  }
}
@keyframes ts-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tree-skeleton .ts-ico,
  .tree-skeleton .ts-line,
  .tree-skeleton .ts-tag {
    animation: none;
  }
}

.asset-tree {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  :deep(.el-tree-node__content) {
    position: relative;
    height: 34px;
    padding: 0 8px 0 2px;
    border-radius: 6px;
    transition: background-color var(--motion-fast) var(--ease-standard);
  }
  :deep(.el-tree-node__content:hover) {
    background: #f4f9ff;
  }
  :deep(.el-tree-node.is-current > .el-tree-node__content) {
    background: linear-gradient(90deg, #e8f2ff 0%, #f5faff 100%) !important;
    box-shadow: inset 0 0 0 1px rgb(22 109 254 / 10%);
  }
  /* 选中竖条：与侧栏菜单高亮同款 3px 主色渐变 */
  :deep(.el-tree-node.is-current > .el-tree-node__content)::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: linear-gradient(180deg, #4a95f0, #166dfe);
  }
  :deep(.el-tree-node__expand-icon) {
    color: #8a9bb0;
    font-size: 14px;
    padding: 0 2px 0 0;
  }
  :deep(.el-tree-node__expand-icon.is-leaf) { color: transparent; }
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font-size: 13px;
  position: relative;
  .tn-ico {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border-radius: 6px;
  }
  .tn-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: #0b1e33;
  }
  /* 选中节点名称强调 */
  &.is-active .tn-name {
    color: #166dfe;
  }
  /* 运行状态：状态点 + 文字（运行中绿 / 停机灰），颜色统一走 --status-* token */
  .tn-status {
    flex-shrink: 0;
    width: 56px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #8a9bb0;
    .tn-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--status-offline);
    }
    &.is-running {
      color: var(--status-running);
      .tn-dot { background: var(--status-running); }
    }
    &.is-stopped {
      color: #8a9bb0;
      .tn-dot { background: var(--status-offline); }
    }
    &.is-unlinked {
      color: #a9b6c6;
      .tn-dot { background: #d7dee8; }
    }
  }
  /* 关联事项：告警铃铛（橙） + 工单文档（蓝） */
  .tn-rel {
    flex-shrink: 0;
    min-width: 46px;
    display: inline-flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .tn-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    &.is-alarm { color: var(--status-pending); }
    &.is-order { color: var(--status-info); }
  }
}

.detail-area {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  /* 由内部卡片各自滚动，容器本身不出滚动条，保证整体不超出屏幕 */
  overflow: hidden;
}

/* 详情区动画包裹：切换设备时整体重挂载，让 dash-card 逐张入场动画重放；
   display: contents 保证不影响原有 flex 布局 */
.detail-anim {
  display: contents;
}

.da-empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
}

.da-head {
  /* 主详情占满剩余高度，内部 flex 分区，列表区独立滚动 */
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 4px solid var(--status-offline);
  transition: border-color 0.2s;
  background: rgb(255 255 255 / 72%) !important;
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border-color: rgb(200 220 240 / 30%);
  &.tone-running { border-left-color: var(--status-running); }
  /* 停机/检修：与顶部“离线设备”卡片一致（--status-alarm） */
  &.tone-stopped { border-left-color: var(--status-alarm); }
  &.tone-fault { border-left-color: var(--status-alarm); }
  /* 未接入实时数据：灰色 */
  &.tone-unlinked { border-left-color: var(--status-offline); }
}
.da-head-inner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}
/* 卡片 body 撑满卡片高度：末级设备没有「下属设备」卡时，
   上方的监测内容自动向下占满，不留空白 */
.da-head :deep(.el-card__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dh-left { flex: 1; min-width: 0; }
.dh-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 18px;
  font-weight: 700;
  color: #0b1e33;
  margin-bottom: 10px;
  .dh-icon { color: #0e7ff0; font-size: 22px; }
}
.dh-alarm-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 34px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  border-radius: 17px;
  border: 1px solid transparent;
  background: #ffeaea;
  color: #ff3b5c;
  transition: filter 0.15s, transform 0.15s;
  &.is-link {
    cursor: pointer;
    &:hover { filter: brightness(0.94); transform: translateY(-1px); }
  }
  .art-svg-icon { font-size: 14px; line-height: 1; flex-shrink: 0; }
}
.dh-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 13px;
  color: #64748b;
  b { color: #334155; font-weight: 500; margin-right: 4px; }
}
.dh-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

/* 运行状态心电图：运行中=动态心跳，停机=直线 */
.dh-ecg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: 17px;
  background: rgb(148 163 184 / 10%);
  border: 1px solid rgb(148 163 184 / 32%);

  .ecg-svg {
    width: 72px;
    height: 20px;
    overflow: visible;
  }
  .ecg-flat {
    fill: none;
    stroke: #b9c4d2;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ecg-pulse {
    fill: none;
    stroke: var(--art-success);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 46 84;
    animation: ecg-scan 1.3s linear infinite;
  }
  .ecg-text {
    font-size: 13px;
    font-weight: 600;
    color: #8a97a8;
  }

  &.is-running {
    background: color-mix(in srgb, var(--art-success) 12%, transparent);
    border-color: color-mix(in srgb, var(--art-success) 45%, transparent);

    .ecg-flat { stroke: color-mix(in srgb, var(--art-success) 28%, transparent); }
    .ecg-text { color: color-mix(in srgb, var(--art-success) 65%, #0b1e33); }
  }

  /* 停机：红色直线，与顶部“离线设备”卡片 #ff3b5c 保持一致 */
  &.is-stopped {
    background: color-mix(in srgb, #ff3b5c 10%, transparent);
    border-color: color-mix(in srgb, #ff3b5c 45%, transparent);

    .ecg-flat { stroke: #ff3b5c; }
    .ecg-text { color: #ff3b5c; }
  }

  /* 未接入：虚线边框 + 灰色直线，避免误读成“停机” */
  &.is-unlinked {
    border-style: dashed;
    background: transparent;

    .ecg-flat { stroke: #c9d2de; stroke-dasharray: 4 4; }
    .ecg-text { color: #98a4b3; font-weight: 500; }
  }
}

@keyframes ecg-scan {
  to { stroke-dashoffset: -130; }
}

/* 副信息行内的运行/停机时长：只展示与当前状态对应的一项 */
.dd-sub-dur {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  font-weight: 500;

  b {
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;  /* 数字等宽，跳动时不晃 */
  }
  &.is-run {
    color: color-mix(in srgb, var(--art-success) 65%, #0b1e33);
  }
  &.is-stop {
    color: #ff3b5c;
  }
  .dd-sub-since {
    color: #98a4b3;
    font-size: 11.5px;
    font-weight: 400;
  }
}

/* 事实：测点总览 */
.da-points-summary {
  margin-top: 14px;
  padding: 12px 14px;
  background: rgb(244 248 252 / 80%);
  border-radius: 10px;
  border: 1px solid rgb(200 220 240 / 40%);
}
.ps-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.ps-cell {
  flex: 1;
  background: white;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
  border: 1px solid rgb(200 220 240 / 30%);
}
.ps-num {
  display: block;
  font-size: 22px;
  font-weight: 700;
  color: #0e7ff0;
  font-variant-numeric: tabular-nums;
  &.small { font-size: 13px; font-weight: 500; color: #475569; }
}
.ps-lbl {
  display: block;
  font-size: 11px;
  color: #8a97a8;
  margin-top: 2px;
}
.ps-of {
  font-size: 13px;
  font-weight: 500;
  font-style: normal;
  color: #8a97a8;
  margin-left: 1px;
}
.ps-online .ps-num { color: #10c99a; }
.ps-offline .ps-num { color: #b0bac8; }
.ps-over .ps-num { color: #f08a24; }
.ps-over.has-over .ps-num { color: #ff3b5c; }
.ps-fresh .ps-num { font-size: 13px; }

/* 越限测点 */
.da-over {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgb(200 220 240 / 50%);
}
.over-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #ff3b5c;
  .ri-alarm-warning-fill { font-size: 15px; }
}
.over-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.over-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgb(255 59 92 / 6%);
  border-radius: 8px;
  border-left: 3px solid #ff3b5c;
  font-size: 12px;
}
.over-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}
.over-name { flex: 1; color: #0f172a; font-weight: 500; }
.over-val { font-weight: 700; color: #ff3b5c; font-variant-numeric: tabular-nums; }
.over-th { color: #8a97a8; font-size: 11px; }
.over-eq { color: #7c3aed; font-size: 11px; }

/* 实时测点分组 */
.da-grouped {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed rgb(200 220 240 / 50%);
}
.gp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #0b1e33;
  margin-bottom: 10px;
  .ri-pulse-line { color: #0e7ff0; font-size: 15px; }
  .gp-refresh {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    color: #8a97a8;
    font-size: 14px;
    transition: color 0.15s;
    &:hover { color: #0e7ff0; }
    .spinning { animation: spin 0.6s linear infinite; }
  }
}
@keyframes spin { to { transform: rotate(360deg); } }
.gp-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gp-group {}
.gp-cat {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  padding-bottom: 6px;
  margin-bottom: 8px;
  /* 标题下划线 */
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  user-select: none;
  .ri { font-size: 13px; }
  .gp-cat-n { font-weight: 400; color: #94a3b8; }
  .gp-cat-caret {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    color: #475569;
    font-size: 20px;
    transition: color 0.15s;
  }
  &:hover .gp-cat-caret { color: #0e7ff0; }
}
.gp-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.gp-item {
  background: #f4f8fc;
  border-radius: 8px;
  padding: 8px 12px;
  border: 1px solid transparent;
  transition: border-color 0.15s, opacity 0.15s;
  &.is-over { border-color: #ff3b5c; background: rgb(255 59 92 / 6%); }
  &.is-offline { opacity: 0.55; background: #f1f5f9; }
}
.gp-label {
  font-size: 11px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 3px;
  .gp-sub { color: #94a3b8; font-size: 10px; margin-left: 4px; }
  .gp-offline-dot {
    color: #b0bac8;
    font-size: 11px;
    display: inline-flex;
    opacity: 0.6;
  }
}
.gp-val {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 2px;
}
.gp-num {
  font-size: 17px;
  font-weight: 700;
  color: #0e7ff0;
  font-variant-numeric: tabular-nums;
  &.is-over { color: #ff3b5c; }
  &.offline { color: #b0bac8; font-weight: 400; }
}
.gp-unit { font-size: 11px; color: #8a97a8; }
.gp-bool { font-size: 12px; color: #8b67dd; font-weight: 500; }
.gp-over-badge {
  font-size: 10px;
  color: white;
  padding: 0 5px;
  border-radius: 3px;
  font-weight: 700;
}

/* 运维画像 */
.da-ops {
  margin-top: 12px;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgb(14 127 240 / 6%), rgb(16 201 154 / 6%));
  border-radius: 10px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  border: 1px solid rgb(14 127 240 / 10%);
}
.ops-item {
  text-align: center;
}
.ops-num {
  font-size: 22px;
  font-weight: 700;
  color: #0b1e33;
  font-variant-numeric: tabular-nums;
  &.nonzero { color: #ff3b5c; }
  &.small { font-size: 14px; font-weight: 500; color: #475569; }
}
.ops-lbl {
  font-size: 11px;
  color: #8a97a8;
  margin-top: 1px;
}

/* 额定参数区 */
.da-rated {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed #e6edf5;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  .rated-item {
    background: #fff;
    border: 1px solid #eef1f5;
    border-radius: 8px;
    padding: 10px 14px;
  }
  .rated-label { font-size: 12px; color: #8a97a8; margin-bottom: 4px; }
  .rated-value { font-size: 16px; font-weight: 600; color: #0b1e33;
    .u { font-size: 11px; font-weight: 400; color: #8a97a8; margin-left: 2px; }
  }
}

.dh-actions,
.dd-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 6px;

  .btn-ico { margin-right: 4px; }

  /* 调色板取组件 token（--art-*），与表格操作按钮 ArtButtonTable 同色系 */
  .btn-edit {
    color: var(--art-secondary);
    border-color: color-mix(in srgb, var(--art-secondary) 45%, transparent);
    background: color-mix(in srgb, var(--art-secondary) 12%, transparent);

    &:hover,
    &:focus {
      color: var(--art-secondary);
      border-color: var(--art-secondary);
      background: color-mix(in srgb, var(--art-secondary) 20%, transparent);
    }
  }

  .btn-del {
    color: var(--art-error);
    border-color: color-mix(in srgb, var(--art-error) 45%, transparent);
    background: color-mix(in srgb, var(--art-error) 12%, transparent);

    &:hover,
    &:focus {
      color: var(--art-error);
      border-color: var(--art-error);
      background: color-mix(in srgb, var(--art-error) 20%, transparent);
    }
  }

  .btn-repair {
    color: var(--art-warning);
    border-color: color-mix(in srgb, var(--art-warning) 45%, transparent);
    background: color-mix(in srgb, var(--art-warning) 12%, transparent);

    &:hover,
    &:focus {
      color: var(--art-warning);
      border-color: var(--art-warning);
      background: color-mix(in srgb, var(--art-warning) 20%, transparent);
    }
  }
}

.da-empty {
  background: rgb(255 255 255 / 72%) !important;
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border-color: rgb(200 220 240 / 30%);
}

/* 修复状态标签（沿用 ListView 已有样式） */
.repair-tag.is-pending { color: #f08a24; background: #fff3e2; border-color: #ffdfb8; }
.repair-tag.is-overhaul { color: #8b67dd; background: #f1ecfe; border-color: #ddcffb; }

@media screen and (max-width: 820px) {
  .asset-layout { flex-direction: column; }
  .tree-card { flex: 0 0 200px; }
  .detail-area { flex: 1 1 auto; }
}

@include bp.respond(tablet) {
  .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.kpi-panel-top {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
}
.kpi-panel-title {
  font-size: 14px; font-weight: 600; color: #1e3a5f;
  letter-spacing: 0.5px;
}
.kpi-panel-actions { display: flex; gap: 8px; }
.export-tip {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 14px; background: #f0f7ff; border-radius: 8px;
  color: #0e7ff0; font-size: 13px;
  ArtSvgIcon { font-size: 16px; }
}
.export-range {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.export-range-quick {
  display: flex;
  align-items: center;
  gap: 8px;
}
.export-range-label {
  font-size: 12px;
  color: #8a97a8;
  flex: none;
}
.export-range-hint {
  font-size: 12px;
  color: #8a97a8;
  line-height: 1;
}

/* ========== 详情改版（按设计图）：头部 / KPI / tabs / 侧栏 ========== */
.dd-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  /* 详情卡内部滚动时头部吸顶，设备名/状态/操作按钮始终可见（el-card 默认内边距 20px） */
  position: sticky;
  top: -20px;
  z-index: 5;
  margin: -20px -20px 0;
  padding: 20px 20px 10px;
  background: rgb(255 255 255 / 92%);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid #eef2f6;
}
.dd-icon {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #fff;
  background: linear-gradient(135deg, #2f8bff, #0e7ff0);
  box-shadow: 0 6px 14px rgba(14, 127, 240, 0.25);
}
.dd-head-main { flex: 1; min-width: 0; }
.dd-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.dd-title { font-size: 18px; font-weight: 700; color: #1d2b3a; }
/* 待检修/检修中标签：高度、圆角、内边距与左侧运行状态（.dh-ecg）完全一致 */
.dd-tag {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  border-radius: 17px;
  border: 1px solid transparent;
  transition: filter 0.15s, transform 0.15s;
  &.is-green { background: #e6f7ef; color: #10b981; border-color: rgb(16 185 129 / 38%); }
  &.is-red { background: #ffecef; color: #ff3b5c; border-color: rgb(255 59 92 / 38%); }
  &.is-orange { background: #fff4e5; color: #f08a24; border-color: rgb(240 138 36 / 38%); }
  &.is-purple { background: #f1ebfd; color: #8b67dd; border-color: rgb(139 103 221 / 38%); }
  &.is-gray { background: #eef1f5; color: #8a97a8; border-color: rgb(138 151 168 / 38%); }
  &.is-link { cursor: pointer; &:hover { filter: brightness(0.94); transform: translateY(-1px); } }
}
.dd-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #8a97a8;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dd-sep { color: #d5dbe3; font-style: normal; }
/* 标题行内的心电图略缩小 */
.dd-title-row .dh-ecg {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  .ecg-svg { width: 56px; height: 16px; }
  .ecg-text { font-size: 12px; }
}
.dd-actions { flex: none; display: flex; gap: 8px; align-items: center; }

.dd-kpis {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 14px;
}
.dd-kpi {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #eef1f5;
  border-radius: 10px;
  background: #fff;
}
.dd-kpi-ic {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  &.is-blue { background: #e8f1ff; color: #0e7ff0; }
  &.is-green { background: #e6f7ef; color: #10b981; }
  &.is-orange { background: #fff4e5; color: #f08a24; }
  &.is-red { background: #ffecef; color: #ff3b5c; }
  &.is-cyan { background: #e6f9fb; color: #0aa2c0; }
}
.dd-kpi-l {
  font-size: 12px;
  color: #8a97a8;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dd-rate {
  font-size: 11px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: 4px;
  line-height: 1.7;
  background: #e6f7ef;
  color: #10b981;
  &.is-warn { background: #fff4e5; color: #f08a24; }
}
.dd-kpi-s.is-warn { color: #f08a24; font-weight: 600; }
.run-src-hint {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: #b36408;
}
.dd-kpi-v {
  font-size: 20px;
  font-weight: 700;
  color: #1d2b3a;
  line-height: 1.3;
  i { font-style: normal; font-size: 12px; font-weight: 400; color: #8a97a8; margin-left: 2px; }
  &.small { font-size: 16px; }
}
.dd-kpi-s { font-size: 11px; color: #a8b3c0; }

.dd-body {
  display: flex;
  gap: 16px;
  margin-top: 14px;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.dd-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dd-side {
  flex: none;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  /* 右侧概况区：不显示任何滚动条（内容仍可滚动，不会裁切） */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar { width: 0; height: 0; display: none; }
}
.dd-side-sec {
  border: 1px solid #eef1f5;
  border-radius: 10px;
  padding: 12px 14px;
  background: #fff;
}
/* 「设备概况」吃掉右栏剩余高度：示意图随高度放大，避免右栏底部留大片空白 */
.dd-side-sec:first-child {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dd-side-title {
  font-size: 13px;
  font-weight: 600;
  color: #1d2b3a;
  padding-left: 8px;
  border-left: 3px solid #0e7ff0;
  margin-bottom: 10px;
}
.dd-visual {
  aspect-ratio: 1 / 1;
  /* 允许被拉伸：设备概况变高时示意图区域随之占满 */
  flex: 1 1 auto;
  min-height: 120px;
  border-radius: 10px;
  background: url('../../assets/img/equipment/info/bg.webp') center / cover no-repeat;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #0e7ff0;
  font-size: 44px;
  margin-bottom: 10px;
  overflow: hidden;
  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}
.dd-visual-cap { font-size: 11px; color: #a8b3c0; }
.dd-info-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 7px 0;
  border-bottom: 1px dashed #f0f3f7;
  span { color: #8a97a8; }
  b { font-weight: 500; color: #1d2b3a; }
  &:last-child { border-bottom: none; }
}
.dd-info-link {
  margin-top: 8px;
  font-size: 12px;
  color: #0e7ff0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  &:hover { text-decoration: underline; }
}
.dd-ops-open {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7faff;
  margin-bottom: 6px;
  > svg, > .svg-icon { font-size: 22px; color: #0e7ff0; }
}
.dd-ops-open-l { font-size: 11px; color: #8a97a8; }
.dd-ops-open-v {
  font-size: 18px;
  font-weight: 700;
  color: #1d2b3a;
  i { font-style: normal; font-size: 11px; font-weight: 400; color: #8a97a8; margin-left: 2px; }
  &.nonzero { color: #f08a24; }
}

.dd-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #eef1f5;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.dd-tab {
  padding: 8px 14px;
  font-size: 13px;
  color: #5a6b7d;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  i {
    font-style: normal;
    font-size: 11px;
    background: #eef1f5;
    color: #8a97a8;
    border-radius: 8px;
    padding: 0 6px;
    line-height: 1.6;
  }
  &.active {
    color: #0e7ff0;
    border-bottom-color: #0e7ff0;
    font-weight: 600;
    i { background: #e8f1ff; color: #0e7ff0; }
  }
  &:hover { color: #0e7ff0; }
}

.dd-sec-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.dd-sec-bar-l { display: flex; align-items: baseline; gap: 10px; }
.dd-sec-name { font-size: 14px; font-weight: 600; color: #1d2b3a; }
.dd-sec-desc { font-size: 12px; color: #a8b3c0; }
.dd-sec-bar-r { display: flex; align-items: center; gap: 10px; }
.dd-sec-note { font-size: 11px; color: #b7c1cd; }
/* 卡片/列表切换：默认隐藏（小屏不显示），仅在 1600px 以上出现 */
.dd-view-toggle {
  display: none;
  border: 1px solid #d6e0eb;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 2px rgba(14, 127, 240, 0.08);
}
.dd-vt-btn {
  width: 36px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #8a97a8;
  cursor: pointer;
  transition: all 0.18s ease;
  & + & { border-left: 1px solid #d6e0eb; }
  &.active {
    background: linear-gradient(180deg, #2a8bff 0%, #166dfe 100%);
    color: #fff;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }
  &:not(.active):hover { color: #166dfe; background: #f0f7ff; }
}
@media (min-width: 1601px) {
  .dd-view-toggle { display: inline-flex; }
}
.dd-refresh-btn {
  border-radius: 8px;
  height: 34px;
  padding: 0 20px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  --el-button-bg-color: #166dfe;
  --el-button-border-color: #166dfe;
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: #3a97f2;
  --el-button-hover-border-color: #3a97f2;
  --el-button-hover-text-color: #fff;
  --el-button-active-bg-color: #0e5bd6;
  box-shadow: 0 2px 6px rgba(22, 109, 254, 0.25);
  transition: all 0.18s ease;
  .art-svg-icon { font-size: 17px; margin-right: 6px; }
  &:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(22, 109, 254, 0.35); }
}
.parent-hint { font-size: 11px; color: #a8b3c0; line-height: 1.5; margin-top: 2px; }
/* 列表视图：行式测点（与系统表格风格统一） */
.dd-rows-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  background: #e8edf3;
  border: 1px solid #dde3ec;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  color: #1d2b3a;
  margin-bottom: 10px;
  span:nth-child(1) { flex: 1 1 40%; }
  span:nth-child(2) { flex: none; min-width: 120px; text-align: right; }
  span:nth-child(3) { flex: 1 1 32%; text-align: right; }
}
.dd-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}
.dd-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  transition: background 0.15s;
  &:nth-child(even) { background: #f8fafc; }
  &:hover { background: #eef5fd; }
  & + & { border-top: 1px solid #ebeef5; }
  &.is-offline { background: #fafafa; &:nth-child(even) { background: #f4f5f7; } &:hover { background: #eef5fd; } }
  &.is-over { background: #fff7f8; &:nth-child(even) { background: #fff1f2; } &:hover { background: #ffecef; } }
  .dd-row-name {
    flex: 1 1 40%;
    min-width: 0;
    font-size: 14px;
    color: #303133;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dd-row-val {
    flex: none;
    min-width: 120px;
    text-align: right;
    .num { font-size: 17px; font-weight: 700; color: #1d2b3a; font-family: 'DIN Alternate', 'Bahnschrift', monospace; }
    .num.is-over { color: #ff3b5c; }
    .num.off { color: #b7c1cd; font-weight: 500; }
    .unit { font-size: 12px; color: #8a97a8; margin-left: 3px; }
  }
  .dd-row-sub {
    flex: 1 1 32%;
    min-width: 0;
    font-size: 13px;
    color: #909399;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.dd-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; flex-shrink: 0; }
.dd-chip {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 16px;
  border: 1px solid #e3e8ef;
  color: #5a6b7d;
  cursor: pointer;
  background: #fff;
  &.active { background: #0e7ff0; border-color: #0e7ff0; color: #fff; }
  &:hover { border-color: #0e7ff0; color: #0e7ff0; }
  &.active:hover { color: #fff; }
}

.dd-sec { margin-bottom: 14px; }
.dd-sec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  padding: 8px 0;
  border-bottom: 1px solid #eef1f5;
  cursor: pointer;
  user-select: none;
  &.is-static { cursor: default; color: #1d2b3a; margin: 14px 0 8px; }
}
.dd-sec-n { font-weight: 400; color: #a8b3c0; }
.gp-cat-caret { margin-left: auto; color: #475569; display: inline-flex; font-size: 20px; }
/* 树节点展开箭头：放大加深 */
:deep(.el-tree-node__expand-icon) { font-size: 16px; color: #475569; }

.dd-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 10px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 行高随可用高度拉伸：测点较少时卡片撑满剩余空间，底部不留大片空白 */
  align-content: stretch;
  grid-auto-rows: minmax(78px, 1fr);
}
.dd-pt {
  border: 1px solid #edf1f6;
  border-radius: 8px;
  padding: 12px 14px;
  background: #fff;
  /* 卡片被拉高后内容垂直居中，避免文本堆在顶部显得空 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  &.is-over { border-color: #ffd9de; background: #fff7f8; }
  &.is-offline { opacity: 0.6; }
}
/* 测点卡片渐进入场：入场动画 forwards 会把 opacity 锁成 1，
   离线卡片改用收尾透明度 0.6，避免原有的灰显状态丢失 */
.dd-pt.dash-card {
  opacity: 0;
  --pt-end-opacity: 1;
}
.dd-pt.is-offline.dash-card { --pt-end-opacity: 0.6; }
.is-ready .dd-pt.dash-card { animation-name: dd-pt-in; }
@keyframes dd-pt-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: var(--pt-end-opacity, 1); transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dd-pt.dash-card { opacity: 1; }
  .dd-pt.is-offline.dash-card { opacity: 0.6; }
}
.dd-pt-name {
  font-size: 12px;
  font-weight: 600;
  color: #33455c;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dd-pt-val {
  margin: 6px 0 3px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  .num { font-size: 20px; font-weight: 700; color: #1f9dff; &.is-over { color: #ff3b5c; } &.off { color: #a8b3c0; } }
  .unit { font-size: 11px; color: #8a97a8; }
}
.dd-pt-sub {
  font-size: 11px;
  color: #a8b3c0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dd-mon-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #a8b3c0;
  padding-top: 10px;
  border-top: 1px dashed #f0f3f7;
  span { display: inline-flex; align-items: center; gap: 4px; }
}

/* ===== 列表视图 el-table（6列分组）真实路径：.dd-main > .el-table ===== */
:deep(.dd-main .el-table) {
  --el-table-border-color: transparent;
  --el-table-text-color: #264779;
  --el-table-header-text-color: #1a57a8;
  --el-table-row-hover-bg-color: #e6f2ff;
  background: transparent;
  border: none !important;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;

  .el-table__inner-wrapper {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .el-table__header-wrapper { flex-shrink: 0; }
  .el-table__body-wrapper {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    /* 强制常显滚动条（macOS 默认隐藏 overlay 滚动条） */
    &::-webkit-scrollbar { width: 8px; height: 8px; }
    &::-webkit-scrollbar-thumb {
      background: rgb(14 127 240 / 38%);
      border-radius: 4px;
      &:hover { background: rgb(14 127 240 / 60%); }
    }
    &::-webkit-scrollbar-track { background: rgb(226 236 248 / 45%); border-radius: 4px; }
    /* EP 2.x 实际滚动容器是内层 el-scrollbar__wrap */
    .el-scrollbar { height: 100%; }
    .el-scrollbar__wrap {
      overflow-y: auto !important;
      &::-webkit-scrollbar { width: 8px; height: 8px; }
      &::-webkit-scrollbar-thumb {
        background: rgb(14 127 240 / 38%);
        border-radius: 4px;
        &:hover { background: rgb(14 127 240 / 60%); }
      }
      &::-webkit-scrollbar-track { background: rgb(226 236 248 / 45%); border-radius: 4px; }
    }
  }

  &::before, &::after, &.el-table--border::after { display: none !important; }
  .el-table__inner-wrapper::before { display: none !important; }
  th.el-table__cell, td.el-table__cell {
    border-right: none !important;
    border-bottom: none !important;
  }

  /* 表头：蓝渐变 + 圆角 + 首列蓝强调线 */
  .el-table__header-wrapper thead tr {
    background: linear-gradient(180deg, #eaf3ff 0%, #d3e6ff 100%);
  }
  .el-table__header-wrapper th.el-table__cell {
    height: 46px !important; padding: 0 !important;
    background: transparent !important;
    color: #1a57a8 !important; font-size: 13px !important; font-weight: 700 !important;
    letter-spacing: 0.5px;
  }
  .el-table__header-wrapper th.el-table__cell:first-child {
    border-radius: 12px 0 0 12px; position: relative;
    &::before {
      content: ''; position: absolute; left: 10px; top: 50%;
      width: 3px; height: 16px; border-radius: 2px;
      background: linear-gradient(180deg, #3a97f2 0%, #166dfe 100%);
      transform: translateY(-50%); box-shadow: 0 0 4px rgba(22, 109, 254, 0.35);
    }
  }
  .el-table__header-wrapper th.el-table__cell:last-child { border-radius: 0 12px 12px 0; }

  /* 数据行 */
  .el-table__body tr { height: 44px !important; }
  .el-table__body td.el-table__cell {
    height: 44px !important; padding: 0 14px !important;
    font-size: 13px; color: #264779;
    background: #fbfcfe !important;
  }
  .el-table__body tr.el-table__row--striped td.el-table__cell { background: #f1f7fe !important; }
  .el-table__body tr:hover > td.el-table__cell { background: #e6f2ff !important; }

  /* 分组标题行 */
  .el-table__body tr.lv-group-row td.el-table__cell {
    background: var(--cat-bg, linear-gradient(180deg, #f0f6ff 0%, #e4f0ff 100%)) !important;
    font-weight: 600; color: var(--cat-main, #166dfe) !important;
    border-top: 1px solid var(--cat-border, #cce0ff) !important;
    border-bottom: 1px solid var(--cat-border, #cce0ff) !important;
  }
  .el-table__body tr.lv-group-row:hover > td.el-table__cell {
    background: var(--cat-bg-hover, linear-gradient(180deg, #e4f0ff 0%, #d6e7ff 100%)) !important;
  }

  .cell { display: flex; align-items: center; min-height: 22px; }
  th .cell { justify-content: center; }
}

/* 兼容卡片视图的 dd-sec-table（保留原样） */
:deep(.dd-sec-table.el-table) {
  --el-table-border-color: transparent;
  --el-table-text-color: #264779;
  --el-table-header-text-color: #1a57a8;
  --el-table-row-hover-bg-color: #e6f2ff;
  background: transparent;
  border: none !important;

  &::before, &::after, &.el-table--border::after { display: none !important; }
  .el-table__inner-wrapper::before { display: none !important; }
  th.el-table__cell, td.el-table__cell {
    border-right: none !important;
    border-bottom: none !important;
  }

  .el-table__header-wrapper thead tr { background: linear-gradient(180deg, #eaf3ff 0%, #d3e6ff 100%); }
  .el-table__header-wrapper th.el-table__cell {
    height: 46px; padding: 0 !important; background: transparent !important;
    color: #1a57a8; font-size: 13px; font-weight: 700; letter-spacing: 0.5px;
  }
  .el-table__header-wrapper th.el-table__cell:first-child {
    border-radius: 12px 0 0 12px; position: relative;
    &::before {
      content: ''; position: absolute; left: 10px; top: 50%;
      width: 3px; height: 16px; border-radius: 2px;
      background: linear-gradient(180deg, #3a97f2 0%, #166dfe 100%);
      transform: translateY(-50%); box-shadow: 0 0 4px rgba(22, 109, 254, 0.35);
    }
  }
  .el-table__header-wrapper th.el-table__cell:last-child { border-radius: 0 12px 12px 0; }

  .el-table__body tr { height: 44px; }
  .el-table__body td.el-table__cell {
    height: 44px; padding: 0 14px !important;
    font-size: 13px; color: #264779; background: #fbfcfe !important;
  }
  .el-table__body tr.el-table__row--striped td.el-table__cell { background: #f1f7fe !important; }
  .el-table__body tr:hover > td.el-table__cell { background: #e6f2ff !important; }

  .el-table__body tr.lv-group-row td.el-table__cell {
    background: var(--cat-bg, linear-gradient(180deg, #f0f6ff 0%, #e4f0ff 100%)) !important;
    font-weight: 600; color: var(--cat-main, #166dfe) !important;
    border-top: 1px solid var(--cat-border, #cce0ff) !important;
    border-bottom: 1px solid var(--cat-border, #cce0ff) !important;
  }
  .el-table__body tr.lv-group-row:hover > td.el-table__cell {
    background: var(--cat-bg-hover, linear-gradient(180deg, #e4f0ff 0%, #d6e7ff 100%)) !important;
  }
  .cell { display: flex; align-items: center; min-height: 22px; }
  th .cell { justify-content: center; }
}

/* 列表视图局部类 */
.lv-toggle {
  font-size: 18px; cursor: pointer; transition: transform 0.2s;
}
.lv-group-icon {
  font-size: 18px; margin-right: 6px;
}
.lv-group-title {
  font-weight: 600; font-size: 14px;
  display: inline-flex; align-items: center; gap: 2px;
}
.lv-group-count { font-weight: 500; font-size: 13px; opacity: 0.85; }
.lv-val { font-weight: 500; color: #264779; }
.lv-unit { font-size: 12px; color: #7987a1; margin-left: 2px; }
.lv-off { color: #c0c8d4; }
.lv-source { color: #4a6a9a; font-size: 12px; }
.lv-tag {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px; color: #6b7a8f;
  background: #f4f8fc; padding: 2px 6px; border-radius: 4px;
}

.dd-alarm-wrap {
  min-height: 120px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.dd-profile {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.dd-alarm-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #eef1f5;
  border-radius: 10px;
  margin-bottom: 8px;
  &.link { cursor: pointer; &:hover { border-color: #bcd8f6; background: #f7faff; } }
  &.item-focus {
    border-color: #0e7ff0;
    background: linear-gradient(90deg, #0e7ff018 0%, #0e7ff008 100%);
    box-shadow: 0 0 0 2px #0e7ff022;
    animation: alarmFocusPulse 2s ease-in-out infinite;
  }
}
@keyframes alarmFocusPulse {
  0%, 100% { box-shadow: 0 0 0 2px #0e7ff022; }
  50%      { box-shadow: 0 0 0 4px #0e7ff038; }
}
.dd-alarm-go { flex: none; color: #a8b3c0; }
.dd-ops-open.link { cursor: pointer; &:hover { background: #eef4ff; } }
.dd-alarm-level { flex: none; font-size: 11px; padding: 2px 8px; border-radius: 6px; }
.dd-alarm-main { flex: 1; min-width: 0; }
.dd-alarm-name { font-size: 13px; color: #1d2b3a; }
.dd-alarm-sub { font-size: 11px; color: #a8b3c0; margin-top: 2px; }
.dd-alarm-status {
  flex: none;
  font-size: 11px;
  color: #8a97a8;
  &.st-pending { color: #ff3b5c; }
  &.st-processing { color: #f08a24; }
  &.st-closed { color: #10b981; }
}

.dd-profile-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.dd-pf-item {
  border: 1px solid #eef1f5;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  span { display: block; font-size: 11px; color: #8a97a8; margin-bottom: 4px; }
  b { font-size: 13px; font-weight: 500; color: #1d2b3a; word-break: break-all; }
  &.is-full { grid-column: 1 / -1; }
}

@media (max-width: 1200px) {
  /* 堆叠后外层需要能纵向滚动，否则下方"设备概况/运维概况"会被 overflow:hidden 裁掉 */
  .dd-body { flex-direction: column; overflow-y: auto; overflow-x: hidden; }
  .dd-main { flex: 0 0 auto; overflow: visible; }
  .dd-side { width: 100%; flex: none; flex-direction: row; flex-wrap: wrap; overflow: visible; }
  .dd-side-sec { flex: 1 1 calc(50% - 12px); min-width: 200px; }
  .dd-kpis { grid-template-columns: repeat(2, 1fr); }
  .dd-grid { grid-template-columns: repeat(2, 1fr); }
  .dd-profile-grid { grid-template-columns: repeat(2, 1fr); }
}

/* ===== 响应式布局（三档） ===== */

/* 1600px 以下：隐藏右侧「设备概况 / 运维概况」，主区占满 */
@media (max-width: 1600px) {
  .dd-detail { grid-template-columns: minmax(0, 1fr); }
  .dd-side { display: none; }
}

/* 短视口（高度 < 900px）：固定为最小高度，由外层 #app-main 出现整页滚动条，不再压缩内容 */
@media (max-height: 899px) {
  .asset-layout { height: 620px; min-height: 620px; }
  /* 解开外层高度链，避免 flex 收缩把内容再压回视口高度 */
  .page-fill,
  .page-fill > .el-tabs,
  .page-fill > .el-tabs > .el-tabs__content,
  .page-fill > .el-tabs > .el-tabs__content > .el-tab-pane {
    min-height: auto;
    overflow: visible;
  }
}

/* 1201~1440px：下属设备按可用宽度自适应，避免固定 6 列把文字压成竖排 */
@media (min-width: 1201px) and (max-width: 1440px) {
}

/* 中屏：1200px 以下，侧栏变窄，卡片变小 */
@media (max-width: 1200px) {
  /* .asset-layout 是 flex 布局，这里改树卡片宽度（原 grid-template-columns 无效） */
  .tree-card { flex: 0 0 260px; }
  .dd-detail {
    grid-template-columns: minmax(0, 1fr) 240px;
  }
  .dd-sec-bar-r { gap: 8px; }
  .dd-refresh-btn {
    height: 30px !important;
    padding: 0 14px !important;
    font-size: 14px !important;
    .art-svg-icon { font-size: 15px; margin-right: 4px; }
  }
  .dd-chips { gap: 6px; }
  .dd-chip { padding: 4px 10px; font-size: 12px; }
}

/* 小桌面：1440px 以下，顶部操作按钮收成纯图标按钮（保留 title 悬浮提示） */
@media (max-width: 1440px) {
  .dd-actions {
    .btn-edit,
    .btn-repair,
    .btn-del {
      width: 34px;
      height: 34px;
      padding: 0;
      font-size: 17px;
    }
    .btn-ico { margin-right: 0; }
    .btn-label { display: none; }
  }
}

/* 平板/小桌面：992px 以下，侧栏堆叠，卡片更小 */
@media (max-width: 992px) {
  .tree-card { flex: 0 0 220px; }
  .dd-detail {
    grid-template-columns: minmax(0, 1fr);
  }
  .dd-side { flex-direction: row; flex-wrap: wrap; gap: 12px; }
  .dd-side-sec { flex: 1 1 calc(50% - 12px); min-width: 200px; }
  .dd-visual { max-width: 120px; }
  .dd-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .kpi-panel { padding: 14px; }
  .dd-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dd-main { padding: 14px; }

  /* el-table 列收窄 */
  :deep(.dd-main .el-table), :deep(.dd-sec-table.el-table) {
    .el-table__body tr { height: 40px !important; }
    .el-table__body td.el-table__cell { height: 40px !important; padding: 0 10px !important; font-size: 12px; }
    .el-table__header-wrapper th.el-table__cell { height: 42px !important; font-size: 12px !important; }
  }
}

/* 小屏：720px 以下，单列、头部按钮换行、侧栏纵向堆叠 */
@media (max-width: 720px) {
  .asset-layout { flex-direction: column; height: auto; }
  .tree-card { display: none; } /* 小屏隐藏左侧设备目录，专注详情 */
  .dd-header { flex-wrap: wrap; }
  .dd-actions { width: 100%; justify-content: flex-end; }
  .dd-grid { grid-template-columns: 1fr; }
  .dd-kpis { grid-template-columns: 1fr 1fr; }
  .dd-profile-grid { grid-template-columns: 1fr; }
  .dd-side { flex-direction: column; }
  .dd-sec-bar { flex-direction: column; align-items: flex-start; gap: 8px; }
  .dd-sec-bar-r { flex-wrap: wrap; }
  .dd-mon-foot { flex-direction: column; align-items: flex-start; gap: 8px; }
  .dd-kpis { grid-template-columns: 1fr; }
}
</style>
