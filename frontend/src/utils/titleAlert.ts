/** 浏览器标签页告警角标：标题前缀「(N)」+ favicon 红色数字角标。
 *  值班员切到其他窗口/标签页时仍能感知新告警。计数清零后恢复原样。 */

let baseTitle = ''
let originIconHref = ''
let badgeIcon: HTMLLinkElement | null = null

function faviconLink(): HTMLLinkElement | null {
  let el = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!el && document.head) {
    el = document.createElement('link')
    el.rel = 'icon'
    document.head.appendChild(el)
  }
  return el
}

function drawBadge(n: number) {
  const link = faviconLink()
  if (!link) return
  if (!originIconHref) originIconHref = link.getAttribute('href') || '/favicon.ico'

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const paintBadge = () => {
    const text = n > 99 ? '99+' : String(n)
    ctx.beginPath()
    ctx.arc(size - 20, 20, 20, 0, Math.PI * 2)
    ctx.fillStyle = '#ef4444'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${text.length > 2 ? 20 : 26}px -apple-system, "PingFang SC", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, size - 20, 21)
    if (!badgeIcon) {
      badgeIcon = document.createElement('link')
      badgeIcon.rel = 'icon'
      document.head.appendChild(badgeIcon)
    }
    badgeIcon.href = canvas.toDataURL('image/png')
  }

  // 在原 favicon 上叠角标；取不到原图（跨域/不存在）时只画角标
  const img = new Image()
  img.onload = () => {
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    paintBadge()
  }
  img.onerror = () => {
    ctx.clearRect(0, 0, size, size)
    paintBadge()
  }
  img.src = originIconHref
}

function restore() {
  if (baseTitle) document.title = baseTitle
  if (badgeIcon) {
    badgeIcon.remove()
    badgeIcon = null
  }
}

/** 设置告警角标数量；传 0 清除。可重复调用。 */
export function setAlertBadge(count: number) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (!baseTitle) baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '')
  if (n <= 0) {
    restore()
    return
  }
  document.title = `(${n > 99 ? '99+' : n}) ${baseTitle}`
  drawBadge(n)
}
