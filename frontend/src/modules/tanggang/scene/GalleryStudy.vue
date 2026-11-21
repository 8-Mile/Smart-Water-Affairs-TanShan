<script setup lang="ts">
import { onMounted,onBeforeUnmount,ref } from 'vue'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
const emit=defineEmits<{close:[]}>()
const dialog=ref<HTMLDialogElement|null>(null),host=ref<HTMLDivElement|null>(null)
const loaded=ref(false),failure=ref(''),cut=ref(false)
const scene=new T.Scene()
const camera=new T.PerspectiveCamera(31,1,.05,85)
const removable:T.Mesh[]=[]
const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>()
let active=true,renderer:T.WebGLRenderer|undefined,orbit:OrbitControls|undefined,resize:ResizeObserver|undefined
function draw(){if(active&&renderer)renderer.render(scene,camera)}
function frame(){
  if(!orbit)return
  const narrow=camera.aspect<1
  const distanceScale=narrow?1.48/Math.max(.62,camera.aspect):1
  const direction=new T.Vector3(6.2,3.1,8.7)
  orbit.target.set(0,1.48,0)
  camera.position.copy(orbit.target).addScaledVector(direction,distanceScale)
  orbit.update();draw()
}
function showCut(value:boolean){
  cut.value=value
  removable.forEach(mesh=>{mesh.visible=!value})
  draw()
}
onMounted(async()=>{
  const holder=host.value
  if(!holder||!dialog.value)return
  dialog.value.showModal()
  try{
    renderer=new T.WebGLRenderer({antialias:true,alpha:false})
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6))
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04
    holder.append(renderer.domElement)
    renderer.domElement.setAttribute('aria-label','输送廊道典型双跨，可拖动旋转')
    scene.background=new T.Color('#e5ecf1')
    scene.add(new T.HemisphereLight(0xffffff,0x8a9ba7,2.05))
    const sun=new T.DirectionalLight(0xffefd8,3.2)
    sun.position.set(-5,9,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024)
    Object.assign(sun.shadow.camera,{left:-7,right:7,top:6,bottom:-6,near:.1,far:24})
    sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.009;scene.add(sun)
    const rim=new T.DirectionalLight(0xc8e9ff,1.25);rim.position.set(2,4,-6);scene.add(rim)
    const floorGeo=new T.PlaneGeometry(120,120)
    const floorMat=new T.MeshStandardMaterial({color:'#e4ebee',roughness:1})
    const floor=new T.Mesh(floorGeo,floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true
    scene.add(floor);geometries.add(floorGeo);materials.add(floorMat)
    orbit=new OrbitControls(camera,renderer.domElement);orbit.enablePan=true;orbit.minDistance=3;orbit.maxDistance=32
    orbit.maxPolarAngle=Math.PI*.487;orbit.addEventListener('change',draw)
    const fit=()=>{
      if(!renderer)return
      const w=holder.clientWidth,h=holder.clientHeight
      if(w&&h){camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);frame()}
    }
    resize=new ResizeObserver(fit);resize.observe(holder);fit()
    const {scene:asset}=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'tanggang/models/harbor/gallery-study.glb')
    asset.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
    if(!active){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());return}
    for(const offset of [-4,0]){
      const bay=asset.clone(true);bay.position.x=offset
      bay.traverse(o=>{if(o instanceof T.Mesh){
        o.castShadow=o.receiveShadow=true
        if(/^(Roof|WallNear)/.test(o.name))removable.push(o)
      }})
      scene.add(bay)
    }
    loaded.value=true
    showCut(false)
  }catch(e){failure.value=e instanceof Error?e.message:'模型资源读取失败'}
})
onBeforeUnmount(()=>{
  active=false;resize?.disconnect();orbit?.removeEventListener('change',draw);orbit?.dispose()
  scene.traverse(o=>{if(o instanceof T.DirectionalLight)o.shadow.dispose()})
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.clear()
  renderer?.dispose();renderer?.domElement.remove()
  dialog.value?.close()
})
</script>
<template>
  <dialog ref="dialog" class="gallery-dialog" @cancel.prevent="emit('close')" aria-labelledby="gallery-heading">
    <header><div><h2 id="gallery-heading">输送廊道典型跨</h2><p>BM、BX 封闭廊道 · 外观与内部构造示意</p></div>
      <button class="close" type="button" autofocus aria-label="关闭廊架样板" @click="emit('close')">×</button></header>
    <div ref="host" class="viewport" :data-study-loaded="loaded" :data-cutaway="cut">
      <span v-if="!loaded||failure" class="feedback">{{failure || '正在加载 Blender 模型…'}}</span>
    </div>
    <footer>
      <div class="toolbar" role="group" aria-label="廊架模型视图">
        <button type="button" :aria-pressed="!cut" :disabled="!loaded" @click="showCut(false)">完整外观</button>
        <button type="button" data-cutaway-toggle :aria-pressed="cut" :disabled="!loaded" @click="showCut(true)">局部剖视</button>
        <button type="button" :disabled="!loaded" @click="frame">复位</button>
      </div>
      <p>{{cut?'剖开近侧围护和屋面，可查看承载带、回程带、托辊与检修走道。':'拖动旋转，滚轮缩放。围护形式与结构尺度待典型断面核准。'}}</p>
    </footer>
  </dialog>
</template>
<style scoped>
.gallery-dialog{width:min(940px,94vw);padding:0;max-width:94vw;border:1px solid #cedce6;border-radius:14px;background:#f4f8fa;color:#1c384b;box-shadow:0 22px 80px #17334840;margin:auto;overflow:hidden}
.gallery-dialog::backdrop{background:#1c344969}.gallery-dialog header,.gallery-dialog footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 19px;background:#fbfdff}
.gallery-dialog h2{font-size:20px;line-height:1.3;margin:0}.gallery-dialog p{margin:3px 0 0;color:#596f7d;font-size:13px}
.viewport{position:relative;width:100%;height:clamp(200px,52dvh,560px);border-block:1px solid #d1dee5}.viewport :deep(canvas){width:100%;height:100%;display:block;touch-action:none}
.feedback{position:absolute;top:45%;left:10%;right:10%;text-align:center}.toolbar{display:flex;align-items:center;gap:4px;flex:none}
.gallery-dialog button{cursor:pointer;padding:7px 10px;background:#edf3f7;border:0;border-radius:5px;color:#385369;font-size:13px}.gallery-dialog button[aria-pressed=true]{color:white;background:#226b93}.gallery-dialog button:focus-visible{outline:2px solid #1a8cc2}.gallery-dialog .close{font-size:24px;line-height:1;padding:5px 10px}
@media(max-width:620px){.gallery-dialog footer{align-items:flex-start;flex-direction:column}.gallery-dialog header,.gallery-dialog footer{padding:10px 12px}.viewport{height:42dvh}}
@media(max-height:510px){.viewport{height:42dvh}}
</style>
