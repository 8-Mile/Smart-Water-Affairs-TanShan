/**
 * 表格状态管理（对齐 art-design-pro 的 useTableStore）
 * 表格尺寸、斑马纹、边框、表头背景、全屏模式，localStorage 持久化
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'sys-table-pref'

export type TableSize = 'small' | 'default' | 'large'

interface TablePref {
  tableSize: TableSize
  isZebra: boolean
  isBorder: boolean
  isHeaderBackground: boolean
  isFullScreen: boolean
}

function readPref(): Partial<TablePref> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

export const useTableStore = defineStore('tableStore', () => {
  const saved = readPref()
  const tableSize = ref<TableSize>(saved.tableSize || 'default')
  const isZebra = ref(saved.isZebra ?? false)
  const isBorder = ref(saved.isBorder ?? false)
  const isHeaderBackground = ref(saved.isHeaderBackground ?? false)
  const isFullScreen = ref(false)

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tableSize: tableSize.value,
        isZebra: isZebra.value,
        isBorder: isBorder.value,
        isHeaderBackground: isHeaderBackground.value,
      } satisfies Omit<TablePref, 'isFullScreen'>),
    )
  }

  function setTableSize(size: TableSize) {
    tableSize.value = size
    persist()
  }
  function setIsZebra(v: boolean) {
    isZebra.value = v
    persist()
  }
  function setIsBorder(v: boolean) {
    isBorder.value = v
    persist()
  }
  function setIsHeaderBackground(v: boolean) {
    isHeaderBackground.value = v
    persist()
  }
  function setIsFullScreen(v: boolean) {
    isFullScreen.value = v
  }

  return {
    tableSize,
    isZebra,
    isBorder,
    isHeaderBackground,
    isFullScreen,
    setTableSize,
    setIsZebra,
    setIsBorder,
    setIsHeaderBackground,
    setIsFullScreen,
  }
})
