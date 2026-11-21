/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { fileURLToPath, URL } from 'node:url'

/**
 * 生产构建混淆（发布加密）：在 generateBundle 阶段（Rollup 已定稿所有 chunk 文件名）逐个混淆。
 * 必须用 generateBundle 而非 renderChunk —— renderChunk 阶段动态导入路径还是 `!~{hash}~`
 * 占位符，混淆进字符串数组后 Rollup 无法替换成真实文件名，运行时将 404。
 * - 仅处理业务代码 chunk；echarts/element-plus/vue-vendor 为开源公共库（无 IP、混淆纯损性能）跳过
 * - 默认关闭（产物膨胀 + 运行时解密拖慢加载）；需要加密发布时 OBFUSCATE=1 npm run build；sourcemap 全局关闭，杜绝还原源码
 */
function obfuscatePlugin(): Plugin {
  const SKIP_CHUNKS = ['echarts', 'element-plus', 'vue-vendor']
  return {
    name: 'build-obfuscator',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      // 性能优化：混淆会显著膨胀产物并拖慢浏览器解析执行（控制流平坦化 + RC4 字符串解密
      // 在运行时持续消耗 CPU），默认关闭；需要发布加密时显式 OBFUSCATE=1 npm run build
      if (process.env.OBFUSCATE !== '1') return
      for (const fileName of Object.keys(bundle)) {
        const file = bundle[fileName]
        if (file.type !== 'chunk' || !fileName.endsWith('.js')) continue
        if (SKIP_CHUNKS.some((n) => fileName.includes(n))) continue
        const out = JavaScriptObfuscator.obfuscate(file.code, {
          compact: true,
          // 自我保护：代码被格式化/美化后自动失效，防止 beautify 后分析
          selfDefending: true,
          // 控制流平坦化：打散 if/for 逻辑为状态机，大幅抬高逆向成本
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          // 死代码注入：混入大量不可达分支干扰阅读
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.4,
          // 标识符十六进制化 + 字符串数组 RC4 加密运行时解密
          identifierNamesGenerator: 'hexadecimal',
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayEncoding: ['rc4'],
          stringArrayIndexShift: true,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayWrappersCount: 2,
          stringArrayWrappersChainedCalls: true,
          stringArrayWrappersParametersMaxCount: 4,
          stringArrayWrappersType: 'function',
          splitStrings: true,
          splitStringsChunkLength: 5,
          // 不启用 renameGlobals / transformObjectKeys：与 ESM 模块互引、对象枚举顺序存在兼容风险
          unicodeEscapeSequence: false,
          target: 'browser',
        })
        file.code = out.getObfuscatedCode()
      }
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // element-plus 按需引入：模板组件与 ElMessage 系列 API 自动注入（JS 按需），
    // 不再全量打包（950KB JS → 按实际用量）；v-loading 指令在 main.ts 单独注册。
    // importStyle: false —— 样式由 main.ts 全量 index.css 统一加载，
    // 防止组件样式跟随 chunk 晚加载覆盖项目自定义样式
    AutoImport({ resolvers: [ElementPlusResolver({ importStyle: false })] }),
    Components({ resolvers: [ElementPlusResolver({ importStyle: false })] }),
    obfuscatePlugin(),
  ],
  resolve: {
    // 强制 echarts / zrender 单实例：它们内部用 `instanceof SourceImpl/DataStore` 判定数据源，
    // 若因依赖预构建分桶出现多份副本，判定失效会抛出 dev 断言 "Invalid data provider."
    dedupe: ['echarts', 'zrender'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/assets/styles', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {},
    },
  },
  build: {
    // 加密发布：关闭 sourcemap（混淆产物绝不附带源码映射）
    sourcemap: false,
    // 生产构建去掉 debugger 语句（console 保留，便于线上排障）
    esbuild: {
      drop: ['debugger'],
    },
    // M1：vendor 拆包 —— echarts/element-plus 等大依赖独立 chunk，
    // 业务代码更新时不强制用户重新下载稳定依赖，首屏缓存命中显著提升
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 动态按需加载的大依赖（xlsx 导出 / three+GLB 3D 形象）
            // three 独立命名 chunk：跟随异步的 RobotLive 组件按需加载，不进首屏
            if (id.includes('/xlsx/')) {
              return undefined
            }
            if (id.includes('/three/')) return 'three'
            if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
            if (id.includes('element-plus') || id.includes('@element-plus')) return 'element-plus'
            if (/\/(vue|@vue|vue-router|pinia|axios|dayjs)\//.test(id)) return 'vue-vendor'
            return 'vendor'
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{spec,test}.ts'],
  },
  server: {
    port: 5190,
    // 端口被占用时直接启动失败，避免 Vite 静默 +1 换端口导致页面仍访问旧地址、接口全部连不上
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // dist 预览（npm run preview）同样代理后端，便于对混淆产物做发布前冒烟验证
  preview: {
    port: 4190,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
