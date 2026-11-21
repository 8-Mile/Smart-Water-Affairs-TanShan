<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { registerLabels, type Register, type Entry } from '../data/demo'
import Icon from './Icon.vue'
const props = defineProps<{ page: Register; entries: Entry[]; date: string }>()
defineEmits<{ select: [id: string] }>()
const term = ref('')
const state = ref('')
function clear() {
  term.value = ''
  state.value = ''
}
watch(() => [props.page, props.date], clear)
const items = computed(() => props.entries.filter((e) => e.page === props.page))
const states = computed(() => [...new Set(items.value.map((e) => e.state))])
const matches = computed(() => {
  const text = term.value.trim().toLowerCase()
  return items.value.filter(
    (e) =>
      (!state.value || state.value === e.state) &&
      [e.id, e.name, e.location, e.state].some((v) => v.toLowerCase().includes(text)),
  )
})
</script>
<template>
  <section class="register-pane">
    <header class="register-title">
      <div>
        <p class="eyebrow">{{ registerLabels[page][1] }}</p>
        <h1>{{ registerLabels[page][0] }}</h1>
      </div>
      <span>{{ date }}　16:00 快照</span>
    </header>
    <div class="register-toolbar">
      <strong
        >{{ registerLabels[page][2] }}清单
        <small>{{ matches.length }} / {{ items.length }}</small></strong
      >
      <div class="filters">
        <label class="search"
          ><Icon name="search" /><input
            v-model="term"
            :aria-label="'搜索' + registerLabels[page][2]"
            placeholder="搜索编号、名称或位置"
        /></label>
        <select v-model="state" aria-label="状态筛选">
          <option value="">全部状态</option>
          <option v-for="s in states" :key="s">{{ s }}</option>
        </select>
      </div>
    </div>
    <div class="table-scroll">
      <table class="register-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>{{ registerLabels[page][2] }}名称</th>
            <th>位置</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in matches" :key="i.id">
            <td class="record-id">{{ i.id }}</td>
            <td>
              <b>{{ i.name }}</b>
            </td>
            <td>{{ i.location }}</td>
            <td>
              <span class="state-chip">{{ i.state }}</span>
            </td>
            <td>
              <button class="text-link" :aria-label="'查看 ' + i.id" @click="$emit('select', i.id)">
                查看详情 <Icon name="arrow" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!matches.length" class="empty">
      没有匹配的记录。<button class="text-link" @click="clear">清除筛选</button>
    </div>
  </section>
</template>
