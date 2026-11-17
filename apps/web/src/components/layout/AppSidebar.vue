<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import OverviewIcon from "../overview/OverviewIcon.vue";
import { can } from "../../demo/permissions";
import type { Action } from "../../demo/permissions";
import { useDemoStore } from "../../demo/store";
import { NAV_GROUPS, navGroupForPath, navChildForPath } from "../../navigation";

const store = useDemoStore();
const route = useRoute();

const GROUP_ORDER = ["overview", "running", "process", "operations", "water", "data", "admin"];
const navIcons: Record<string, string> = { overview: "home", running: "shield", process: "process", operations: "layers", water: "water", data: "chart", admin: "settings" };
const groups = computed(() =>
  GROUP_ORDER.map((id) => NAV_GROUPS.find((group) => group.id === id)).filter(
    (group): group is (typeof NAV_GROUPS)[number] => Boolean(group),
  ),
);
const openGroup = ref<string | null>(null);

watch(
  () => route.path,
  (path) => {
    const group = navGroupForPath(path);
    // Only one expanded group at a time: avoid 30-item menu overload.
    openGroup.value = group?.children ? group.id : null;
  },
  { immediate: true },
);
const activeChildTo = computed(() => navChildForPath(route.path)?.to);


function allow(permission: Action): boolean {
  return can(store.role, permission);
}

function toggleGroup(id: string): void {
  openGroup.value = openGroup.value === id ? null : id;
}

</script>

<template>
  <aside id="primary-navigation" class="sidebar">
    <p class="nav-label">运营管理</p>
    <nav>
      <template v-for="group in groups" :key="group.id">
        <template v-if="allow(group.permission)">
          <RouterLink v-if="group.to" :to="group.to" class="nav-item" active-class="active"
            :class="{active:navGroupForPath(route.path)?.id===group.id}">
            <OverviewIcon :name="navIcons[group.id]" class="overview-nav-icon" />{{ group.label }}
          </RouterLink>
          <template v-else>
            <button
              type="button"
              class="nav-group"
              :class="{ open: openGroup === group.id }"
              :aria-expanded="openGroup === group.id"
              :aria-controls="'nav-children-'+group.id"
              @click="toggleGroup(group.id)"
            >
              <span><OverviewIcon :name="navIcons[group.id]" class="overview-nav-icon" />{{ group.label }}</span>
              <span class="chevron">{{ openGroup === group.id ? "−" : "+" }}</span>
            </button>
            <div v-if="openGroup === group.id" :id="'nav-children-'+group.id" class="nav-children">
              <RouterLink
                v-for="child in group.children?.filter((item) => allow(item.permission))"
                :key="child.to"
                :to="child.to"
                class="nav-item child"
                active-class="active"
                :class="{active:activeChildTo===child.to}"
              >
                {{ child.label }}
              </RouterLink>
            </div>
          </template>
        </template>
      </template>
    </nav>
    <div class="nav-footer">
      <small>演示数据时间</small>
      <p>2026-11-14 08:00 · 固定参考时刻</p>
      <small>数据标签：MOCK / REFERENCE / USER_ENTRY / CALCULATED</small>
    </div>
  </aside>
</template>
