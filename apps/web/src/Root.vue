<script setup lang="ts">
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  zhCN,
  dateZhCN,
} from "naive-ui";
import App from "./App.vue";
</script>
<template>
  <NConfigProvider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="{
      common: {
        primaryColor: '#247ba8',
        primaryColorHover: '#3591be',
        borderRadius: '6px',
      },
    }"
    ><NMessageProvider
      ><NDialogProvider><App /></NDialogProvider></NMessageProvider
  ></NConfigProvider>
</template>
