<script setup lang="ts">
import {useRoute,RouterLink} from "vue-router";
defineProps<{
 label:string;
 items:{name:string;to:string}[];
}>();
const route=useRoute();
</script>
<template>
 <nav class="workspace-nav" :aria-label="label">
  <span class="workspace-nav-label">{{ label }}</span>
  <RouterLink v-for="item in items" :key="item.to" :to="item.to"
    :class="{active:route.path===item.to}" :aria-current="route.path===item.to?'page':undefined">
   {{ item.name }}
  </RouterLink>
 </nav>
</template>
<style scoped>
.workspace-nav{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;padding:8px 11px;border:1px solid #d8e8f0;background:#f4fafe;border-radius:8px;margin-bottom:12px}
.workspace-nav-label{font-size:11px;color:#7d9eb0;margin-right:7px;font-weight:700}
.workspace-nav a{font-size:12px;color:#587f93;border:1px solid transparent;border-radius:6px;padding:7px 11px;white-space:nowrap;text-decoration:none;min-height:31px;box-sizing:border-box}
.workspace-nav a:hover{color:#267d9d;background:#eaf6fc}
.workspace-nav a.active{color:#176c93;border-color:#b1d9e9;background:#fff;font-weight:700;box-shadow:inset 0 -2px 0 #3e9cc4}
@media(max-width:630px){.workspace-nav-label{flex:0 0 100%}.workspace-nav a{flex:1 1 auto;text-align:center}}
</style>
