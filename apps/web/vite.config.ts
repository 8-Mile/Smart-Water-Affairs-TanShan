import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
export default defineConfig({
  plugins: [vue(), UnoCSS()],
  // 用户要求全部路由异步：图表依赖独立分包，避免ECharts+ZRender共享大块。
  // 该分包只影响静态资源，不引入任何服务端依赖。
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const file=id.replaceAll("\\", "/");
          if(file.includes("/node_modules/zrender/")) return "vendor-zrender";
          if(file.includes("/node_modules/echarts/")) return "vendor-echarts";
          return undefined;
        },
      },
    },
  },
});
