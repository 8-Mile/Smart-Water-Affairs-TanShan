import type { PortIconName } from '../components/PortIcon.vue'

export interface PortWeather {
  temperature: number
  humidity: number
  windSpeed: number
  code: number
  isDay: boolean
  observedAt: string
  description: string
  icon: PortIconName
}

/**
 * Approximate JingTang port area — NOT surveyed berth 51/52 coordinates.
 * This geographic point is for the header weather preview only.
 */
export const portWeatherPoint = { latitude: 39.21, longitude: 119.02 } as const

export const weatherAccessMode = import.meta.env.VITE_PORT_WEATHER_URL
  ? 'configured'
  : import.meta.env.DEV ? 'development-preview' : 'not-configured'

export function weatherCondition(code: number, isDay: boolean): { description: string; icon: PortIconName } {
  if (code === 0) return isDay ? {description:'晴',icon:'sunny'} : {description:'晴夜',icon:'night'}
  if (code === 1 || code === 2)
    return {description:code === 1 ? '少云' : '多云', icon:isDay ? 'partly-cloudy':'night-cloudy'}
  if (code === 3) return {description:'阴',icon:'cloudy'}
  if ([45,48].includes(code)) return {description:'雾',icon:'fog'}
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))
    return {description:'降雨',icon:code>=80?'pouring':'rainy'}
  if ([71,73,75,77,85,86].includes(code)) return {description:'降雪',icon:'snowy'}
  if ([95,96,99].includes(code)) return {description:'雷暴',icon:'lightning'}
  return {description:'天气变化',icon:'cloudy'}
}

interface OpenMeteoCurrent {
  time?: string
  temperature_2m?: number
  relative_humidity_2m?: number
  wind_speed_10m?: number
  weather_code?: number
  is_day?: number
}
interface OpenMeteoResponse { current?: OpenMeteoCurrent }

/**
 * Local DEV preview: Open-Meteo free non-commercial endpoint; it is not a
 * licensed commercial API or a live on-site weather station.
 * Production must configure VITE_PORT_WEATHER_URL with an authorized
 * Open-Meteo-compatible backend endpoint.
 */
export async function fetchPortWeather(signal: AbortSignal): Promise<PortWeather> {
  const configured = import.meta.env.VITE_PORT_WEATHER_URL as string | undefined
  if (!configured && !import.meta.env.DEV) throw new Error('正式部署需配置已授权的天气数据接口')

  const address = configured || 'https://api.open-meteo.com/v1/forecast'
  const url = new URL(address, window.location.origin)
  url.searchParams.set('latitude', String(portWeatherPoint.latitude))
  url.searchParams.set('longitude', String(portWeatherPoint.longitude))
  url.searchParams.set('current','temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day')
  url.searchParams.set('timezone','Asia/Shanghai')

  const res = await fetch(url.toString(), {signal,cache:'no-store',headers:{Accept:'application/json'}})
  if (!res.ok) throw new Error('气象服务暂不可用 (HTTP '+res.status+')')
  const result = await res.json() as OpenMeteoResponse
  const v = result.current
  if (!v || !Number.isFinite(v.temperature_2m) || !Number.isFinite(v.weather_code) ||
    !Number.isFinite(v.wind_speed_10m) || !Number.isFinite(v.relative_humidity_2m) ||
    typeof v.time!=='string') throw new Error('气象接口返回数据不完整')
  const status=weatherCondition(v.weather_code!,v.is_day===1)
  return {
    temperature:v.temperature_2m!,
    humidity:v.relative_humidity_2m!,
    windSpeed:v.wind_speed_10m!,
    code:v.weather_code!,
    isDay:v.is_day===1,
    observedAt:v.time,
    ...status,
  }
}
