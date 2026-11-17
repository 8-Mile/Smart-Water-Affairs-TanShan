import type { Router, RouteLocationRaw } from "vue-router";
import { ref } from "vue";
import { defineStore } from "pinia";

export interface AiContext {
  assetId?: string;
  subsystemId?: string;
}

/**
 * 壳层级交互状态：全局设备抽屉与 AI 抽屉。
 * 所有页面共用同一份状态，保证跨页打开的是同一 assetId。
 */
export const useUiStore = defineStore("ui", () => {
  const drawerAssetId = ref<string | null>(null);
  const aiOpen = ref(false);
  const aiPrompt = ref("");
  const aiContext = ref<AiContext>({});

  const lastTask = ref<{ assetId?: string; workOrderId?: string; scenarioId: string; role: string } | null>(null);
  async function navigate(router: Router, destination: RouteLocationRaw): Promise<void> {
    const failure = await router.push(destination);
    if (failure) return;
    closeAsset();
    closeAi();
  }

  function openAsset(id: string): void {
    drawerAssetId.value = id;
  }

  function closeAsset(): void {
    drawerAssetId.value = null;
  }

  function openAi(context: AiContext = {}, prompt = ""): void {
    aiContext.value = { ...context };
    aiPrompt.value = prompt;
    aiOpen.value = true;
  }

  function closeAi(): void {
    aiOpen.value = false;
  }

  function setAiContext(context: AiContext): void {
    aiContext.value = { ...context };
  }

  return {
    drawerAssetId,
    lastTask,
    navigate,
    aiOpen,
    aiPrompt,
    aiContext,
    openAsset,
    closeAsset,
    openAi,
    closeAi,
    setAiContext,
  };
});
