<script setup lang="ts">
import { NDrawer, NDrawerContent } from "naive-ui";
import AiPanel from "./AiPanel.vue";
import { useUiStore } from "../demo/ui";

const ui=useUiStore();
</script>

<template>
  <NDrawer
    :show="ui.aiOpen"
    :width="460"
    placement="right"
    @update:show="(value:boolean)=>!value&&ui.closeAi()"
  >
    <NDrawerContent title="问 AI · 本地意图解析" closable>
      <AiPanel/>
    </NDrawerContent>
  </NDrawer>
</template>
