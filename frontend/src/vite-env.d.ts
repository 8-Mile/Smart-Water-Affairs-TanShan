/// <reference types="vite/client" />

declare module '*.glb' {
  const src: string
  export default src
}
declare module '*.glb?url' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
