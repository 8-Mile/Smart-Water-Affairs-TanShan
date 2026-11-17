<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import OverviewIcon from "../overview/OverviewIcon.vue";
import { can } from "../../demo/permissions";
import type { Action } from "../../demo/permissions";
import { useDemoStore } from "../../demo/store";
import { NAV_GROUPS } from "../../navigation";

const store = useDemoStore();
const route = useRoute();

const GROUP_ORDER = ["overview", "business", "process", "intelligent", "operations", "engineering", "water", "data", "admin"];
const navIcons: Record<string, string> = { overview: "home", business: "layers", process: "process", intelligent: "shield", engineering: "layers", operations: "layers", water: "water", data: "chart", admin: "settings" };
const groups = computed(() =>
  GROUP_ORDER.map((id) => NAV_GROUPS.find((group) => group.id === id)).filter(
    (group): group is (typeof NAV_GROUPS)[number] => Boolean(group),
  ),
);
const openGroups = ref<string[]>([]);

watch(
  () => route.path,
  (path) => {
    const group = NAV_GROUPS.find(
      (item) => item.to === path || item.children?.some((child) => child.to === path),
    );
    if (group?.children && !openGroups.value.includes(group.id)) {
      openGroups.value = [...openGroups.value, group.id];
    }
  },
  { immediate: true },
);

function allow(permission: Action): boolean {
  return can(store.role, permission);
}

function toggleGroup(id: string): void {
  openGroups.value = openGroups.value.includes(id)
    ? openGroups.value.filter((item) => item !== id)
    : [...openGroups.value, id];
}
</script>

<template>
  <aside id="primary-navigation" class="sidebar">
    <p class="nav-label">运营管理</p>
    <nav>
      <template v-for="group in groups" :key="group.id">
        <template v-if="allow(group.permission)">
          <RouterLink v-if="group.to" :to="group.to" class="nav-item" active-class="active">
            <OverviewIcon :name="navIcons[group.id]" class="overview-nav-icon" />{{ group.label }}
          </RouterLink>
          <template v-else>
            <button
              type="button"
              class="nav-group"
              :class="{ open: openGroups.includes(group.id) }"
              @click="toggleGroup(group.id)"
            >
              <span><OverviewIcon :name="navIcons[group.id]" class="overview-nav-icon" />{{ group.label }}</span>
              <span class="chevron">{{ openGroups.includes(group.id) ? "−" : "+" }}</span>
            </button>
            <div v-if="openGroups.includes(group.id)" class="nav-children">
              <RouterLink
                v-for="child in group.children?.filter((item) => allow(item.permission))"
                :key="child.to"
                :to="child.to"
                class="nav-item child"
                active-class="active"
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
