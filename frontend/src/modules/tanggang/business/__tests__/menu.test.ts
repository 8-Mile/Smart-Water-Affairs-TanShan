import { describe, expect, it } from 'vitest'
import router from '@/router'
import { tanggangMenus, tanggangGroupForPath } from '../menu'

describe('唐港首页/侧边栏统一菜单契约', () => {
  it('统一七个一级模块', () => {
    expect(tanggangMenus.map((x) => x.title)).toEqual([
      '综合总览', '运行监测', '水资源管理', '运行处置', '设备运维', '分析中心', '系统管理',
    ])
  })
  it('所有子菜单路由在5190存在且无重复路径', () => {
    const seen = new Set<string>()
    for (const group of tanggangMenus) {
      const childPaths = group.children?.map((x) => x.path) || [group.path]
      for (const path of childPaths) {
        expect(router.resolve(path).matched.length, path).toBeGreaterThan(0)
        expect(seen.has(path), 'duplicate menu leaf ' + path).toBe(false)
        seen.add(path)
      }
    }
  })
  it('删除废弃工作台及无用跳转，保留原有整合Tab路由', () => {
    for (const oldPath of [
      '/dashboard/workbench', '/energy/records', '/dispatch/audit',
      '/dispatch/tasks', '/repair/approve', '/repair/process', '/repair/accept',
      '/equipment/running-status', '/equipment/run-log', '/equipment/manufacturers',
    ]) {
      expect(router.resolve(oldPath).name, oldPath).toBe('exception-404')
    }
    for (const preserved of [
      '/water/plans', '/inspection/records', '/alarm/rules',
      '/alarm/history', '/system/menus', '/energy/fee',
    ]) {
      expect(router.resolve(preserved).name, preserved).not.toBe('exception-404')
    }
  })
  it('所有一级业务菜单直接进入有功能的页面，不再展示二级总览', () => {
    const expected:Record<string,string> = {
      monitor:'/port/process/fog',
      water:'/water/stats',
      operations:'/alarm/realtime',
      assets:'/equipment/list',
      analysis:'/ai/chat',
    }
    for (const m of tanggangMenus) {
      expect(m.children?.every(x=>!x.title.includes('总览'))??true,m.title).toBe(true)
      if (expected[m.id]) expect(m.path).toBe(expected[m.id])
    }
    expect(tanggangMenus.find(x=>x.id==='overview')?.path).toBe('/dashboard')
  })
  it('已删除的总览页面地址只做兼容跳转，不再挂载旧组件', () => {
    const redirects:Record<string,string> = {
      '/port/monitor':'/port/process/fog',
      '/port/water':'/water/stats',
      '/port/operations':'/alarm/realtime',
      '/port/assets':'/equipment/list',
      '/port/analysis':'/ai/chat',
    }
    for (const [from,to] of Object.entries(redirects)) {
      expect(router.resolve(from).matched[router.resolve(from).matched.length - 1]?.redirect,from).toEqual(to)
    }
  })
  it('六套工艺复用固定SystemId及父模块', () => {
    expect(tanggangMenus.find((x) => x.id === 'monitor')?.children?.map((x) => x.id))
      .toEqual(['fog', 'middle', 'mineral', 'rain', 'pool', 'domestic'])
    for (const id of ['fog', 'middle', 'mineral', 'rain', 'pool', 'domestic']) {
      expect(tanggangGroupForPath('/port/process/' + id)).toBe('monitor')
    }
  })
})
