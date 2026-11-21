import { ElNotification } from 'element-plus'

/**
 * 闭环轻庆祝：验收通过/告警闭环等"完成时刻"的正向反馈
 * 比 ElMessage 稍强、比全屏动画弱，克制不打扰
 */
export function celebrateClosedLoop(title: string, message?: string) {
  ElNotification({
    title,
    message,
    type: 'success',
    duration: 3200,
    position: 'top-right',
  })
}
