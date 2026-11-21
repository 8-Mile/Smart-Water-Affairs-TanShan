import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElLoading } from 'element-plus'
// element-plus 图标按需注册：全量 294 个图标会让首屏 chunk 多出 ~136KB，
// 经全仓扫描（模板标签 + JS 引用），实际仅使用以下 37 个：
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  ChatDotRound,
  Checked,
  CircleCheck,
  CircleCheckFilled,
  Clock,
  Close,
  Connection,
  CopyDocument,
  DataBoard,
  Delete,
  Drizzling,
  FolderOpened,
  FullScreen,
  HomeFilled,
  Lightning,
  List,
  Menu,
  Monitor,
  Odometer,
  OfficeBuilding,
  PieChart,
  Plus,
  Pointer,
  Promotion,
  RefreshRight,
  SetUp,
  Setting,
  Sunny,
  Tickets,
  Timer,
  User,
  Van,
  Warning
} from '@element-plus/icons-vue'
import disableDevtool from 'disable-devtool'

import App from './App.vue'
import router from './router'
// element-plus：JS 按需引入（unplugin），CSS 保持全量一次性加载。
// 原因：按需注入的组件样式跟随页面 chunk 晚加载，会覆盖项目自定义样式
// （菜单/卡片/主题），导致整体样式错乱；全量 CSS gzip 仅 ~34KB，成本可忽略。
import 'element-plus/dist/index.css'
import '@styles/core/tailwind.css'
import '@styles/index.scss'
import './styles/index.css'
import { applyTheme } from './themes/applyTheme'
import countUp from './directives/countUp'
import vPerm from './directives/perm'

// 生产环境反调试：检测到开发者工具打开即跳空白页、禁右键菜单（dev 环境不生效）。
// 运维排障豁免：URL 携带 ?dtk=<令牌> 且 md5 匹配时自动关闭防护（产物内仅存 md5，不留明文令牌），
// 当前令牌请妥善线下保管：dz0bcb0812c167-support
if (import.meta.env.PROD) {
  disableDevtool({
    md5: '8eb2a98f997772fad5e1df05c5e3a20f',
    tkName: 'dtk',
    url: 'about:blank',
    disableMenu: true,
    clearLog: true,
  })
}

applyTheme()

const app = createApp(App)

const usedIcons = {
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  ChatDotRound,
  Checked,
  CircleCheck,
  CircleCheckFilled,
  Clock,
  Close,
  Connection,
  CopyDocument,
  DataBoard,
  Delete,
  Drizzling,
  FolderOpened,
  FullScreen,
  HomeFilled,
  Lightning,
  List,
  Menu,
  Monitor,
  Odometer,
  OfficeBuilding,
  PieChart,
  Plus,
  Pointer,
  Promotion,
  RefreshRight,
  SetUp,
  Setting,
  Sunny,
  Tickets,
  Timer,
  User,
  Van,
  Warning,
}
for (const [key, component] of Object.entries(usedIcons)) {
  app.component(key, component)
}

app.directive('count-up', countUp)
app.directive('perm', vPerm)
app.use(createPinia())
app.use(router)
// 仅注册 v-loading 指令（模板组件由 unplugin 按需自动引入，locale 见 App.vue 的 el-config-provider）
app.use(ElLoading)
app.mount('#app')
