<script setup lang="ts">
import { useId } from "vue";
defineProps<{ name: string }>();
const id = useId().replace(/:/g, "");
</script>

<template>
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <defs>
      <linearGradient :id="id+'blue'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c0faff"/><stop offset=".45" stop-color="#009dff"/><stop offset="1" stop-color="#0055ef"/></linearGradient>
      <linearGradient :id="id+'green'" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#c4fa8e"/><stop offset=".5" stop-color="#20c932"/><stop offset="1" stop-color="#008825"/></linearGradient>
      <linearGradient :id="id+'amber'" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#ffe784"/><stop offset=".5" stop-color="#ffbc00"/><stop offset="1" stop-color="#ff8d00"/></linearGradient>
      <linearGradient :id="id+'metal'" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b1edff"/><stop offset=".3" stop-color="#008bbd"/><stop offset=".65" stop-color="#006592"/><stop offset="1" stop-color="#00304b"/></linearGradient>
    </defs>
    <g v-if="name === 'logo'" stroke="#0076ff" stroke-width="1.5">
      <path d="M3 36c12 8 26 6 39-3-3 8-20 16-36 7" :fill="`url(#${id}blue)`"/>
      <path d="M9 25h11v11H9zm5-6h8v6h-8m13-17v29m-6-25h18L25 5l-6 13h24M27 9l-7 18m8-15 6 14M6 31h35l-5 8H13"/>
      <path d="M4 43c8 3 12 2 18-1s11-3 20-2" stroke-width="2"/>
    </g>
    <g v-else-if="name === 'drop'">
      <path d="M24 4C21 13 10 21 10 30a14 14 0 0 0 28 0C38 21 27 13 24 4Z" :fill="`url(#${id}blue)`" stroke="#0089ff"/>
      <path d="M17 22c-5 7-3 13 3 15" stroke="#c7faff" stroke-width="3"/>
    </g>
    <g v-else-if="name === 'shield'">
      <path d="M24 3c-6 5-11 7-18 8v13c1 10 8 17 18 22 10-5 17-12 18-22V11c-7-1-12-3-18-8Z" :fill="`url(#${id}green)`" stroke="#f1fff3" stroke-width="1.5"/>
      <path d="m16 23 6 6 12-13" stroke="white" stroke-width="4"/>
    </g>
    <g v-else-if="name === 'leaf'">
      <path d="M7 35C2 12 23 9 42 3c1 19-5 37-28 35" :fill="`url(#${id}green)`" stroke="#ecffe8" stroke-width="1.4"/>
      <path d="M8 44c3-16 15-23 27-31" stroke="#149c2c"/><path d="m13 31 14-9" stroke="#d7ffc9" stroke-width="1.5"/>
    </g>
    <g v-else-if="name === 'risk'">
      <path d="M19 6c2-4 8-4 10 0l17 30c2 5-1 8-6 8H8c-5 0-8-3-6-8Z" :fill="`url(#${id}amber)`" stroke="#fff7db" stroke-width="1.5"/>
      <path d="M24 16v12m0 7v1" stroke="white" stroke-width="4.5"/>
    </g>
    <g v-else-if="name === 'pump'" stroke="#00577e" stroke-width=".8">
      <path d="M3 39h42v5H3z" :fill="`url(#${id}metal)`"/>
      <path d="M5 25h7v14H5zm7-4h13v18H12zm13 3h15v15H25zm15 1h5v14h-5zM17 10h6v12h-6zM15 7h10v4H15z" :fill="`url(#${id}metal)`"/>
      <ellipse cx="13" cy="30" rx="5" ry="10" :fill="`url(#${id}metal)`"/><ellipse cx="27" cy="31" rx="4" ry="9" :fill="`url(#${id}metal)`"/>
      <path d="M32 26v10m3-10v10m3-10v10M7 25v12" stroke="#66d8ff"/>
      <path d="M15 19h9M17 12h2" stroke="#b4f5ff"/>
    </g>
    <g v-else-if="name === 'weather'" stroke-width="1.5">
      <g stroke="#ffbd00"><circle cx="30" cy="16" r="8" fill="#ffd448"/><path d="M30 3v3m0 20v3M17 16h-3m29 0h3M21 7l-2-2m20 22 2 2m-2-22 2-2"/></g>
      <path d="M8 38a8 8 0 0 1-2-16 11 11 0 0 1 21-2 9 9 0 0 1 7 18Z" fill="#b6cddd" stroke="#eafaff"/>
    </g>
    <g v-else-if="name === 'user'"><circle cx="24" cy="24" r="21" :fill="`url(#${id}blue)`" stroke="white" stroke-width="1.5"/><circle cx="24" cy="18" r="6" fill="white" stroke="none"/><path d="M13 35c0-12 22-12 22 0" fill="white" stroke="none"/></g>
    <g v-else-if="name === 'home'"><path d="m5 22 19-17 19 17M10 19v24h11V29h7v14h10V19"/><path d="m3 19 21-18 21 18" opacity=".5"/></g>
    <g v-else-if="name === 'process'"><rect x="5" y="7" width="38" height="27" rx="2"/><path d="M18 42h12m-6-8v8"/></g>
    <g v-else-if="name === 'decision'"><path d="M5 10h38M5 24h38M5 38h38"/><circle cx="17" cy="10" r="4" fill="#e5f4ff"/><circle cx="32" cy="24" r="4" fill="#e5f4ff"/><circle cx="13" cy="38" r="4" fill="#e5f4ff"/></g>
    <g v-else-if="name === 'layers'"><path d="m24 4 20 10-20 10L4 14 24 4Zm-20 19 20 10 20-10M4 33l20 10 20-10"/></g>
    <g v-else-if="name === 'bell'"><path d="M8 34c5-5 5-8 5-17a11 11 0 0 1 22 0c0 9 0 12 5 17H8Zm12 5a4 4 0 0 0 8 0M24 3V1"/></g>
    <g v-else-if="name === 'water'"><path d="M24 3C19 13 7 23 7 31a17 17 0 0 0 34 0C41 23 29 13 24 3Zm-9 28c0 5 3 8 7 9m5-25c0 9-9 13-9 17"/></g>
    <g v-else-if="name === 'chart'"><path d="M3 43h42M8 36V22h6v14zm13 0V13h6v23zm13 0V4h6v32z" fill="currentColor" stroke-width="1.4"/></g>
    <g v-else-if="name === 'archive'"><path d="M3 13V7h16l5 6h21v30H3V13Zm0 6h42M20 28h8m-4 0v8"/></g>
    <g v-else-if="name === 'settings'"><path d="m19 4-2 6-5 2-6-1-4 8 5 4v5l-5 4 4 8 6-1 5 2 2 5h10l2-5 5-2 6 1 4-8-5-4v-5l5-4-4-8-6 1-5-2-2-6Z"/><circle cx="24" cy="25" r="8"/></g>
    <g v-else-if="name === 'spray'" fill="currentColor" stroke="none"><circle cx="24" cy="7" r="3"/><circle cx="16" cy="16" r="3"/><circle cx="32" cy="16" r="3"/><circle cx="9" cy="26" r="3"/><circle cx="24" cy="26" r="3"/><circle cx="39" cy="26" r="3"/><circle cx="4" cy="38" r="3"/><circle cx="17" cy="38" r="3"/><circle cx="31" cy="38" r="3"/><circle cx="44" cy="38" r="3"/></g>
    <g v-else-if="name === 'tap'"><path d="M16 7h16m-8-4v12m-9 0h18v7h9v20H32V30H16M4 23h7v19H4z"/><circle cx="20" cy="31" r="11"/><circle cx="20" cy="31" r="5"/></g>
    <g v-else-if="name === 'flask'"><path d="M17 4h14m-11 0v13L7 38c-2 4 0 6 4 6h26c4 0 6-2 4-6L28 17V4M13 30h22"/><path d="M19 24h1m9 13h1m-10 1h1" stroke-width="4"/></g>
    <g v-else-if="name === 'rain'"><path d="M12 30a9 9 0 0 1-1-18 12 12 0 0 1 23 1 9 9 0 0 1 2 17H12Zm0 7-2 5m14-5-2 5m14-5-2 5"/></g>
    <g v-else-if="name === 'tank'"><ellipse cx="24" cy="9" rx="16" ry="6"/><path d="M8 9v29c0 8 32 8 32 0V9M8 23c0 8 32 8 32 0"/></g>
    <g v-else-if="name === 'health'" fill="currentColor" stroke="none"><path d="m22 10 15 24-3 2-15-24ZM11 36l8-23 3 1-8 23Zm2-2h23v3H13Z"/><circle cx="22" cy="9" r="8"/><circle cx="8" cy="37" r="8"/><circle cx="39" cy="37" r="8"/></g>
    <g v-else-if="name === 'clipboard' || name === 'checklist'"><rect x="9" y="7" width="30" height="38" rx="3"/><rect x="18" y="2" width="12" height="9" rx="3" fill="#d7efff"/><path v-if="name === 'clipboard'" d="M16 20h16m-16 8h16m-16 8h12"/><path v-else d="m16 27 6 6 11-14"/></g>
    <g v-else-if="name === 'tools'"><path d="m6 4 9 9-2 5-5 2L1 12c-1 10 5 16 15 13l19 19 8-8-19-19C27 7 20 1 12 2l8 8-3 5-5 2-8-8M30 11l8-8 7 7-8 8m-9 11L9 45l-6-6 17-18"/></g>
    <g v-else-if="name === 'recycle'" stroke-width="5"><path d="m20 8 5-6 8 13m-2-7 2 7-8-1M39 22l5 6-8 13m5-5-5 5-3-7M22 42h-9L5 28m1 7-1-7 8 1M11 19l5-9"/></g>
  </svg>
</template>
