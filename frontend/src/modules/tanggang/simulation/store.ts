import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { SCENARIOS, calculateScenario, type ScenarioId } from './engine'
/**
 * 情景推演与生产源数据严格隔离：仅当前浏览器内存有效，不写localStorage、后台API或PLC。
 * 路由切换不会重置；刷新、退出登录、关闭页面即消失。
 */
export const useScenarioStore=defineStore('tanggang-scenario',()=>{
  const activeId=ref<ScenarioId|null>(null)
  const runNumber=ref(0)
  const startedAt=ref('')
  const consoleOpen=ref(false)
  const activeScenario=computed(()=>activeId.value?SCENARIOS[activeId.value]:null)
  const result=computed(()=>activeScenario.value?calculateScenario(activeScenario.value):null)
  const running=computed(()=>activeId.value!==null)
  function start(id:ScenarioId){
    if(!SCENARIOS[id])throw Error('未授权的演示情景')
    activeId.value=id
    runNumber.value+=1
    startedAt.value=new Date().toISOString()
    // 只用于未来可选的三维展示订阅，不是工控事件、不包含真实测点。
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual', {
      detail:{scenarioId:id,runNumber:runNumber.value,dataMode:'SIM',simulationOnly:true},
    }))
  }
  function stop(){
    activeId.value=null
    startedAt.value=''
    window.dispatchEvent(new CustomEvent('tanggang:scenario-visual',{
      detail:{scenarioId:null,runNumber:runNumber.value,dataMode:'MEASURED_OR_UNAVAILABLE',simulationOnly:false},
    }))
  }
  function openConsole(){consoleOpen.value=true}
  function closeConsole(){consoleOpen.value=false}
  return {activeId,runNumber,startedAt,consoleOpen,activeScenario,result,running,
    start,stop,openConsole,closeConsole}
})
