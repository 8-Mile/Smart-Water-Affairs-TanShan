/**
 * 设备示意图：按设备名称关键词匹配 info 目录图片，供详情概况与下属设备缩略图共用。
 */
import type { EquipmentItem } from '@/api/equipment'

import infoBeng from '@/assets/img/equipment/info/beng.webp'
import infoJizu from '@/assets/img/equipment/info/jizu.webp'
import infoDianji from '@/assets/img/equipment/info/dianji.webp'
import infoKaiguangui from '@/assets/img/equipment/info/kaiguangui.webp'
import infoLici from '@/assets/img/equipment/info/lici.webp'
import infoYepian from '@/assets/img/equipment/info/yepian.webp'
import infoZhoucheng from '@/assets/img/equipment/info/zhoucheng.webp'
import infoQianchi from '@/assets/img/equipment/info/qianchi.webp'
import infoHouchi from '@/assets/img/equipment/info/houchi.webp'
import infoZhamen from '@/assets/img/equipment/info/zhamen.webp'
import infoZhenkong from '@/assets/img/equipment/info/zhenkong.webp'
import infoGongshui from '@/assets/img/equipment/info/gongshui.webp'
import infoPaishui from '@/assets/img/equipment/info/paishui.webp'
import infoJingshui from '@/assets/img/equipment/info/jingshui.webp'
import infoPeidian from '@/assets/img/equipment/info/peidian.webp'
import infoJiance from '@/assets/img/equipment/info/jiance.webp'

/** 设备名称关键词 → 示意图（顺序即优先级，先匹配先命中） */
const INFO_IMG_RULES: [RegExp, string][] = [
  [/闸门|zhamen/i, infoZhamen],
  [/真空|zhenkong/i, infoZhenkong],
  [/技术供水|供水系统|gongshui/i, infoGongshui],
  [/排水系统|paishui/i, infoPaishui],
  [/净水系统|jingshui/i, infoJingshui],
  [/供配电|配电系统|peidian/i, infoPeidian],
  [/监测仪表|监测系统|jiance/i, infoJiance],
  [/前池/, infoQianchi],
  [/后池/, infoHouchi],
  [/叶片/, infoYepian],
  [/轴承/, infoZhoucheng],
  [/励磁/, infoLici],
  [/开关柜|配电|直流屏|UPS|出线柜|电源柜|控制柜/i, infoKaiguangui],
  [/电机(?!出线)/, infoDianji],
  [/泵/, infoBeng],
  [/机组/, infoJizu],
]

/** 按设备名称取示意图，无匹配返回空串（调用方回退图标） */
export function equipmentImageByName(name: string): string {
  return INFO_IMG_RULES.find(([re]) => re.test(name))?.[1] || ''
}

/** 设备对象取示意图 */
export function equipmentImage(eq: EquipmentItem | null | undefined): string {
  return equipmentImageByName(eq?.name || '')
}
