/**
 * echarts 按需注册入口。
 * 全量 `import * as echarts from 'echarts'` 约 2.8MB；
 * 这里只注册项目实际用到的图表与组件（line/bar/pie），体积大幅下降。
 * 所有视图统一从这里导入 echarts。
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

export default echarts
export * from 'echarts/core'
