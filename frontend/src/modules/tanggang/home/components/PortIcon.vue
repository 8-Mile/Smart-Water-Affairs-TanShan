<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import water from '@iconify-icons/mdi/water-circle'
import overview from '@iconify-icons/mdi/view-dashboard-outline'
import bell from '@iconify-icons/mdi/bell-outline'
import account from '@iconify-icons/mdi/account-circle-outline'
import manager from '@iconify-icons/mdi/account-tie-outline'
import operator from '@iconify-icons/mdi/shield-account-outline'
import engineer from '@iconify-icons/mdi/hard-hat'
import down from '@iconify-icons/mdi/chevron-down'
import clock from '@iconify-icons/mdi/clock-outline'
import sunny from '@iconify-icons/mdi/weather-sunny'
import partlyCloudy from '@iconify-icons/mdi/weather-partly-cloudy'
import cloudy from '@iconify-icons/mdi/weather-cloudy'
import rainy from '@iconify-icons/mdi/weather-rainy'
import pouring from '@iconify-icons/mdi/weather-pouring'
import snowy from '@iconify-icons/mdi/weather-snowy'
import lightning from '@iconify-icons/mdi/weather-lightning'
import fog from '@iconify-icons/mdi/weather-fog'
import night from '@iconify-icons/mdi/weather-night'
import nightCloudy from '@iconify-icons/mdi/weather-night-partly-cloudy'
import windy from '@iconify-icons/mdi/weather-windy'
import refresh from '@iconify-icons/mdi/refresh'
import info from '@iconify-icons/mdi/information-outline'
import close from '@iconify-icons/mdi/close'
import check from '@iconify-icons/mdi/check'
import thermometer from '@iconify-icons/mdi/thermometer'
import mapPin from '@iconify-icons/mdi/map-marker-outline'
import humidity from '@iconify-icons/mdi/water-percent'
import inbox from '@iconify-icons/mdi/inbox-outline'

/**
 * Iconify: thousands of locally installable icon definitions can be imported
 * individually from @iconify-icons/mdi and @iconify-icons/lucide.
 * This registry only bundles what the current screen actually uses.
 */
const icons = {
  water, overview, bell, account, manager, operator, engineer, down, clock,
  sunny, 'partly-cloudy': partlyCloudy, cloudy, rainy, pouring, snowy,
  lightning, fog, night, 'night-cloudy': nightCloudy, windy,
  refresh, info, close, check, thermometer, 'map-pin':mapPin, humidity, inbox,
}
export type PortIconName = keyof typeof icons
const props = withDefaults(defineProps<{name:PortIconName;size?:string|number}>(),{size:'1em'})
const source = computed(()=>icons[props.name])
</script>
<template>
  <Icon :icon="source" :width="size" :height="size" aria-hidden="true" focusable="false" />
</template>
