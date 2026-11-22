import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { landmarks, landmarksSource, lakeDisplayOffset } from './harborLandmarks'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type XY = [number, number]
type Path = { displayPoints: XY[]; layer: string; handle: string }
type Band = { id: string; displayXZ: XY[] }
type SceneData = { sourceDWGSHA256:string; anchors: { x:number; z:number; id:string; modelType:string; sourceHandle?:string|null }[]; lines: Path[]; extentXZ: number[]; yardBands: Band[];
  cadClosedContourCandidates: { handle: string; outline: XY[]; layer: string; volumeHeightDisplayOnly: number }[]
  matchedFacilityContours: { handle: string; labels: string[] }[] }
type Spatial = { yardSideCandidates: { id: string; label?: string; side: string; bandId: string; sceneXZ: XY; sourceTextHandle: string }[]
  poolContourCandidates: { id: string; displayXZ: XY[]; sourceGeometryHandles: string[] }[] }

// Relief dimensions are graphic conventions. All plan coordinates stay in displayXZ.
function prism(path: XY[], height: number, y: number) {
  const shape = new T.Shape(path.map(([x,z]) => new T.Vector2(x,z)))
  const geometry = new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:1})
  return geometry.rotateX(-Math.PI/2).translate(0,y,0)
}
const distance = (a: XY,b: XY) => Math.hypot(a[0]-b[0],a[1]-b[1])
// Sutherland–Hodgman clip against one vertical cut. Used to carve a road corridor
// out of a hardened yard pad instead of stacking two coplanar surfaces.
function clipHalfX(poly: XY[],cut:number,keepEast:boolean): XY[] {
  const out:XY[]=[]
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length]
    const ain=keepEast?a[0]>=cut:a[0]<=cut, bin=keepEast?b[0]>=cut:b[0]<=cut
    if(ain)out.push(a)
    if(ain!==bin){
      const t=(cut-a[0])/(b[0]-a[0])
      out.push([cut,a[1]+(b[1]-a[1])*t])
    }
  }
  return out
}
// Scale a closed polygon about its centroid. Used for a modest roof eave over the walls.
function inflate(poly: XY[], k: number): XY[] {
  const cx=poly.reduce((s,v)=>s+v[0],0)/poly.length
  const cz=poly.reduce((s,v)=>s+v[1],0)/poly.length
  return poly.map(([x,z])=>[cx+(x-cx)*k,cz+(z-cz)*k] as XY)
}
function strip(a: XY,b: XY,width:number,height:number,y:number) {
  const dx=b[0]-a[0], dz=b[1]-a[1]
  return new T.BoxGeometry(width,height,Math.hypot(dx,dz))
    .rotateY(Math.atan2(dx,-dz)).translate((a[0]+b[0])/2,y+height/2,-(a[1]+b[1])/2)
}
// 道路/场坪贴图按世界坐标铺：长路段不再把一张图拉成整条色带。
function worldUv(g:T.BufferGeometry,tile:number){
  const pos=g.getAttribute('position'),nor=g.getAttribute('normal'),uv=g.getAttribute('uv') as T.BufferAttribute
  if(!pos||!nor||!uv)return g
  for(let i=0;i<pos.count;i++){
    if(Math.abs(nor.getY(i))>.9)uv.setXY(i,pos.getX(i)/tile,pos.getZ(i)/tile)
  }
  uv.needsUpdate=true;return g
}
// 只沿长度重复、横向保持 0..1：用于车道磨痕、汇水带等条带贴图。
function stripUv(g:T.BufferGeometry,tile:number){
  const pos=g.getAttribute('position'),nor=g.getAttribute('normal'),uv=g.getAttribute('uv') as T.BufferAttribute
  if(!pos||!nor||!uv)return g
  for(let i=0;i<pos.count;i++)if(Math.abs(nor.getY(i))>.9)uv.setY(i,pos.getZ(i)/tile)
  uv.needsUpdate=true;return g
}
// Levelled coal stockpile: flat crest, steep planar flanks and sharply cut ends.
// Down-slope dozer streaks are baked into vertex colour so the pile reads as coal
// rather than a smooth dune. All dimensions are graphic presentation only.
function stockpile(left:number,right:number,length:number,height:number,seed:number) {
  const vertices:number[]=[],colors:number[]=[],uv:number[]=[],indices:number[]=[]
  const rows=168,cols=48
  const hash=(v:number)=>{const n=Math.sin(v*127.1+seed*311.7)*43758.5453;return n-Math.floor(n)}
  const base=new T.Color('#ffffff')
  // 平顶宽度（占半宽比例）与肩部收折宽度：设计图是窄平台 + 折线肩，不是圆丘。
  const crest=.38
  const shoulder=.07
  for(let j=0;j<=rows;j++){
    const t=j/rows,zc=(t-.5)*length
    // 端部推土机切面：比早期版本拉长，读出设计图里明显的斜端面。
    const endF=Math.min(1,Math.min(t,1-t)*length/9.0)
    // 脊线沿长度轻微起伏，只保留毫米级不平整。
    const ridge=1+.030*Math.sin(t*6.1+seed*.9)+.018*Math.sin(t*15.3+seed*2.3)
    for(let i=0;i<=cols;i++){
      const u=i/cols*2-1,k=j*(cols+1)+i,d=Math.abs(u)
      // 平台→折肩→直坡：肩部只占 5% 半宽，保留一条清楚的堆顶棱线。
      let face:number
      if(d<=crest)face=1
      else if(d<=crest+shoulder)face=1-(d-crest)/shoulder*.22
      else face=.78*(1-(d-crest-shoulder)/(1-crest-shoulder))
      // 坡面碎石起伏：只在坡面中部生效，避免整行或整列条带。
      const rough=(hash(i*1.7+j*.31)*2-1)*.018*face*(1-face)*4
      const x=u*(u<0?left:right)*(1-.008*(1-Math.cos(t*6+seed)))
      const y=.02+height*endF*Math.max(0,face)*ridge+rough*height
      vertices.push(x,Math.max(.02,y),zc)
      uv.push((x+y*.45)*.34,zc*.34)
      // 顺坡向的推土纹：按列固定、沿长度低频变化，形成竖向条纹而不是横条。
      const streak=.92+.08*hash(i*3.7+seed*1.9)+.03*Math.sin(t*6.3+i*.43+seed)
      // 顶部浮灰明显偏亮、坡脚煤体压暗；端部略压暗。阴面下限抬高，
      // 避免默认机位把堆体读成纯黑剪影（设计稿为深炭灰并保留坡面层次）。
      const topLight=.72+.32*Math.pow(Math.max(0,face),.65)
      const endShade=.90+.10*Math.min(1,Math.min(t,1-t)*length/3.0)
      const channel=streak*topLight*endShade
      colors.push(base.r*channel,base.g*channel,base.b*channel)
      if(j<rows&&i<cols){const n=k+cols+1;indices.push(k,n,k+1,k+1,n,n+1)}
    }
  }
  const g=new T.BufferGeometry()
  g.setAttribute('position',new T.Float32BufferAttribute(vertices,3))
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2))
  g.setIndex(indices);g.computeVertexNormals()
  return g
}
export function buildHarborRelief(data:SceneData, spatial:Spatial) {
  const group=new T.Group(), picks:T.Mesh[]=[]
  group.name='唐港 · CAD场景表现层'
  const materials:T.Material[]=[], geometries:T.BufferGeometry[]=[]
  const palette=(color:string,roughness=.8,metalness=.06)=>{
    const m=new T.MeshStandardMaterial({color,roughness,metalness})
    materials.push(m);return m
  }
  const deck=palette('#8f978f',.93,0), edge=palette('#525f62',.95,0), road=palette('#9ea69e',.94,0)
  const stripe=palette('#f4efdd',.82,0), soil=palette('#3d4547',.97,0), leaf=palette('#457e2f',.98,0)
  const wall=palette('#eef2ef',.62,.04), roof=palette('#8f948e',.66,.10), steel=palette('#677e86',.5,.42)
  const accent=palette('#cf7628',.52,.3), pool=palette('#2c8fa9',.16,.18), coping=palette('#dbe6e1',.7,.05)
  pool.emissive=new T.Color('#124a5c');pool.emissiveIntensity=.5
  const poolRim=palette('#cfd8d4',.62,.05), poolInner=palette('#35606a',.86,.05)
  const glint=palette('#dcf4f2',.3)
  // 海面：多方向重力波的解析法线 + Fresnel 天空反射 + 太阳高光/闪点。
  // 不再依赖可平铺法线贴图，避免近景重复纹理与远景整片镜面。
  const seaFog=new T.Color();new T.Color('#d5e5e5').getRGB(seaFog,T.SRGBColorSpace)
  const sea=new T.ShaderMaterial({
    uniforms:{
      uTime:{value:0},
      // 与场景主光一致：DirectionalLight position (64,104,-44)，阴影朝屏幕右下。
      uSunDir:{value:new T.Vector3(64,104,-44).normalize()},
      uDeepColor:{value:new T.Color('#0d6070')},
      uShallowColor:{value:new T.Color('#4ab8bd')},
      uSkyZenith:{value:new T.Color('#4c8cba')},
      uSkyHorizon:{value:new T.Color('#c3d9dd')},
      uSunColor:{value:new T.Color('#ffe9c4')},
      // 与 scene.fog 同步；fog 在色彩空间转换后混合，和标准材质一致。
      uFogColor:{value:seaFog},
      uFogNear:{value:190},
      uFogFar:{value:680},
      uShoreOrigin:{value:new T.Vector2(0,0)},
      uShoreNormal:{value:new T.Vector2(0,1)},
      uShoreWidth:{value:14},
      // 平面反射：由 L1WaterScene 每帧写入镜像相机的纹理矩阵与 RTT。
      uReflection:{value:null as T.Texture|null},
      uHasReflection:{value:0},
      uReflectMatrix:{value:new T.Matrix4()},
    },
    vertexShader:`
      uniform mat4 uReflectMatrix;
      varying vec3 vWorldPos;
      varying vec3 vViewDirW;
      varying vec4 vReflectCoord;
      varying float vFogDepth;
      void main(){
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vViewDirW = cameraPosition - world.xyz;
        vReflectCoord = uReflectMatrix * world;
        vec4 mv = viewMatrix * world;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader:`
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uSkyZenith;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec2 uShoreOrigin;
      uniform vec2 uShoreNormal;
      uniform float uShoreWidth;
      uniform sampler2D uReflection;
      uniform float uHasReflection;
      varying vec3 vWorldPos;
      varying vec3 vViewDirW;
      varying vec4 vReflectCoord;
      varying float vFogDepth;

      // 单向重力波：斜率 = A·k·dir·cos(phase)，多组叠加成非重复水面。
      vec2 waveSlope(vec2 p, vec2 dir, float wavelength, float amp, float speed, float t){
        float k = 6.28318530718 / wavelength;
        return dir * (amp * k) * cos(dot(p, dir) * k + t * speed);
      }

      vec3 skyReflection(vec3 dir){
        float y = clamp(dir.y, 0.0, 1.0);
        // 贴近地平线的反射压暗一档，避免整片水读成白色镜面。
        float up = smoothstep(0.015, 0.62, y);
        vec3 col = mix(uSkyHorizon, uSkyZenith, up);
        // 云影与湿空气带：让反射天空有横向明暗层次。
        float band = sin(dir.x * 5.3 + dir.z * 3.7) * sin(dir.z * 7.1 - dir.x * 2.9);
        col *= 0.88 + 0.12 * band;
        float sd = max(dot(dir, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 1500.0) * 2.0 + pow(sd, 30.0) * 0.10);
        return col;
      }

      void main(){
        vec3 V = normalize(vViewDirW);
        float dist = length(vViewDirW);
        // 细节随距离衰减，防止远处短波在像素尺度下闪烁；
        // 默认机位水面在数百单位外，衰减阈值放宽以保留可读的波浪层次。
        float nearFull = 1.0 - smoothstep(600.0, 2800.0, dist);
        float nearMid  = 1.0 - smoothstep(400.0, 2000.0, dist);
        float nearFine = 1.0 - smoothstep(180.0, 1400.0, dist);

        vec2 p = vWorldPos.xz;
        // 低频域扭曲，让长涌浪不成平行条纹。
        vec2 warp = vec2(
          sin(p.y * 0.0121 + uTime * 0.07) + 0.5 * sin(p.y * 0.031 - p.x * 0.017),
          cos(p.x * 0.0113 - uTime * 0.05) + 0.5 * cos(p.x * 0.027 + p.y * 0.019)
        ) * 9.0;
        vec2 w = p + warp;

        vec2 slope = vec2(0.0);
        slope += waveSlope(w, normalize(vec2( 0.92,  0.39)), 190.0, 2.10, 0.85, uTime);
        slope += waveSlope(w, normalize(vec2( 0.63, -0.78)), 118.0, 1.25, 1.15, uTime);
        slope += waveSlope(w, normalize(vec2(-0.86, -0.51)), 260.0, 1.10, 0.62, uTime);
        slope += waveSlope(w, normalize(vec2( 0.35, -0.94)),  64.0, 0.55, 1.45, uTime) * nearFull;
        slope += waveSlope(w, normalize(vec2( 0.99,  0.14)),  47.0, 0.40, 1.75, uTime) * nearFull;
        slope += waveSlope(w, normalize(vec2(-0.48,  0.88)),  22.0, 0.17, 2.45, uTime) * nearMid;
        slope += waveSlope(w, normalize(vec2( 0.10,  1.00)),  13.0, 0.075, 2.90, uTime) * nearFine;
        slope += waveSlope(w, normalize(vec2( 0.78,  0.63)),   9.2, 0.062, 3.30, uTime) * nearFine;
        slope += waveSlope(w, normalize(vec2(-0.94,  0.34)),   7.5, 0.045, 3.60, uTime) * nearFine;
        slope += waveSlope(w, normalize(vec2(-0.19,  0.98)),   4.1, 0.026, 4.10, uTime) * nearFine;

        // 码头宽约 80 个场景单位。把可辨认的风纹放到该尺度，按屏幕像素衰减。
        float footprint = max(length(dFdx(w)), length(dFdy(w)));
        // 风场缓变让相邻波峰转向、长短不一，打散交叉正弦产生的规则菱格。
        vec2 gust = vec2(sin(w.y*.18+w.x*.052+.31*uTime), sin(w.x*.14-w.y*.075-.24*uTime));
        vec2 finePos = w + gust*1.62 + vec2(sin(w.x*.32+w.y*.23),cos(w.y*.27-w.x*.18))*.53;
        vec2 ripples = waveSlope(finePos, normalize(vec2(.80,.60)), 2.7, .040, .88, uTime)
                     * (1.0-smoothstep(.50,1.10,footprint));
        ripples += waveSlope(finePos, normalize(vec2(.64,.77)), 1.3, .016, 1.17, uTime)
                 * (1.0-smoothstep(.26,.62,footprint));
        ripples += waveSlope(finePos, normalize(vec2(.18,.98)), .67, .007, 1.45, uTime)
                 * (1.0-smoothstep(.13,.34,footprint));
        slope += ripples;
        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        // 水的 F0 ≈ 0.02
        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

        // 近岸浅水偏青绿，离岸过渡到深水色；贴墙处压暗成湿岸阴影。
        float shore = dot(vWorldPos.xz - uShoreOrigin, uShoreNormal);
        float shelf = 1.0 - smoothstep(0.0, uShoreWidth, max(shore, 0.0));
        vec3 body = mix(uDeepColor, uShallowColor, shelf * 0.9);
        float offshore = smoothstep(20.0, 160.0, max(shore, 0.0));
        body = mix(body, uDeepColor * 0.85, offshore * 0.55);
        float contact = 1.0 - smoothstep(0.0, 3.0, max(shore, 0.0));
        body *= 1.0 - contact * 0.34;

        // 大尺度风生明暗带，避免整片水色均匀。
        float streaks = sin(dot(p, vec2(0.021, 0.013)) + uTime * 0.05)
                      * sin(dot(p, vec2(-0.009, 0.028)) - uTime * 0.04);
        body *= 1.0 + streaks * 0.06;

        vec3 R = reflect(-V, N);
        R.y = max(R.y, 0.0);
        vec3 sky = skyReflection(R);
        // 真实平面反射：倒映船、码头、岸线与天空；远景退回解析天空避免噪点。
        if(uHasReflection > 0.5){
          vec2 ruv = vReflectCoord.xy / max(vReflectCoord.w, 0.0001);
          // 扰动随距离增强，打破镜面倒影；三次采样模拟水面模糊。
          vec2 duv = vec2(N.x, N.z) * (0.07 + 0.11 / (1.0 + dist * 0.006));
          vec3 mirrored = texture2D(uReflection, clamp(ruv + duv, vec2(0.002), vec2(0.998))).rgb * 0.5
                        + texture2D(uReflection, clamp(ruv + duv * 0.45 + vec2(0.0035, 0.0015), vec2(0.002), vec2(0.998))).rgb * 0.25
                        + texture2D(uReflection, clamp(ruv + duv * 0.45 - vec2(0.0035, 0.0015), vec2(0.002), vec2(0.998))).rgb * 0.25;
          float reflFade = 1.0 - smoothstep(220.0, 820.0, dist);
          sky = mix(sky, mirrored, 0.68 * reflFade);
        }
        // 波面起伏让反射明暗随坡度变化，避免掠射角读成一整片均匀亮面。
        sky *= 1.0 - 0.28 * clamp(length(slope) * 1.8, 0.0, 1.0);
        // 长涌浪的明暗交替：波峰迎光偏亮，波谷偏暗。
        float swellH = sin(dot(w, normalize(vec2( 0.92,  0.39))) * 0.033 + uTime * 0.32)
                     + 0.55 * sin(dot(w, normalize(vec2( 0.63, -0.78))) * 0.053 + uTime * 0.45);
        sky *= 1.0 + swellH * 0.045;
        vec3 color = mix(body, sky, clamp(fresnel * 0.62 + 0.02, 0.0, 1.0));

        // 太阳高光：宽光泽 + 紧高光 + 近景碎闪。
        vec3 H = normalize(uSunDir + V);
        float nh = max(dot(N, H), 0.0);
        float sheen = pow(nh, 80.0);
        float spec = pow(nh, 700.0);
        float glitter = pow(nh, 1400.0);
        float sparkleMask = 0.55 + 0.45 * sin(dot(p * 1.9, vec2(3.1, 2.3)) + uTime * 6.0)
                                 * sin(dot(p * 2.7, vec2(-2.2, 3.7)) - uTime * 4.3);
        color += uSunColor * (sheen * 0.20 + spec * 0.70) * (0.55 + 0.45 * nearFine);
        color += uSunColor * glitter * (0.8 + sparkleMask) * 1.6 * nearFine;
        color *= 1.0 + .40 * dot(ripples, vec2(.82,.57));
        // 近岸：白沫带 + 湿痕 + 细碎风浪白点，避免水岸交界是一条硬边。
        float lap = .09 + .10 * sin(dot(p,vec2(1.5,.7)) + .6*uTime);
        float fringe = 1.0-smoothstep(.03,.24+footprint,abs(shore-lap));
        vec3 foamColor = vec3(.83,.89,.90);
        color = mix(color, foamColor, fringe*.72);
        float foamLine = 1.0-smoothstep(0.0,.06+footprint,abs(shore-lap-1.05));
        color = mix(color, foamColor, foamLine*.42);
        float chop = smoothstep(.55,.95,length(ripples));
        color = mix(color, vec3(.72,.80,.82), chop*.10*nearFine);
        color += uSkyHorizon * 0.04;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
      }
    `,
  })
  materials.push(sea)
  const hull=palette('#1d2c37',.45,.3), red=palette('#9b5a46',.6,.1), hatch=palette('#456a7a',.45,.3)
  const canopy=palette('#375b3d',.97,0), canopyLight=palette('#566f47',.97,0)
  const concrete=palette('#b9bdb4',.95,0), coalPad=palette('#474f4d',.95,0)
  const orangeMetal=palette('#d2762f',.5,.38), silver=palette('#c3ced2',.3,.78)
  const clarifier=palette('#9fb0b3',.46,.42), fence=palette('#3f93c8',.55,.25)
  const grass=palette('#5d8a4c',.99,0), grassAlt=palette('#527d42',.99,0), grassDry=palette('#6d9155',.99,0)
  const galleryBody=palette('#b7c2c7',.62,.14)
  const forestFloor=palette('#2c4524',.99,0)
  // L1 池体示意材质：浅色池沿、暗内壁、下沉水面；不是实测池壁构造。
  const basinWall=palette('#ccd7d2',.74,.03)
  const basinInner=palette('#2b4149',.9,.03)
  const basinWater=palette('#0b3d4a',.32,.04)
  basinWater.envMapIntensity=.15
  basinWater.emissive=new T.Color('#061f27');basinWater.emissiveIntensity=.15
  const walkway=palette('#c3cbc4',.93,0)
  const grating=palette('#8b9999',.52,.56)
  const glazing=palette('#5d90a7',.30,.20)
  const doorMat=palette('#3d5660',.62,.16)
  const plinthMat=palette('#aab4ae',.95,0)
  const pondBank=palette('#9db98a',.96,0)
  const pondWater=new T.MeshStandardMaterial({color:'#3f9e91',roughness:.20,metalness:.08,
    emissive:'#1b6058',emissiveIntensity:.34,bumpMap:undefined})
  materials.push(pondWater)
  // 池体拾取代理：不可见但参与射线拾取，避免为水面/池壁重复建可点击面。
  const poolPick=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false})
  materials.push(poolPick)
  // 地面贴片与场坪只差几厘米：统一给压在地面上的薄层做深度偏移，
  // 避免远机位转动时与基层共面竞争产生闪斑（不修改 CAD 位置）。
  for(const m of [deck,edge,road,stripe,soil,leaf,grass,grassAlt,grassDry,coalPad,
    walkway,forestFloor,concrete,plinthMat,pondBank,poolRim,basinWall]){
    m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-4
  }
  const ore=palette('#aaada5',.99,.02);ore.vertexColors=true
  ore.envMapIntensity=.45
  // 矿料阴面只补极弱环境色；过强会把煤堆洗成灰蓝色块。
  ore.emissive=new T.Color('#1c1e1f');ore.emissiveIntensity=.34
  const textures:T.Texture[]=[]
  function waterRipples(){
    const size=128, pixels=new Uint8Array(size*size*4)
    let state=5961
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      state=(Math.imul(state,1664525)+1013904223)>>>0
      const angle=(x+2*y)*Math.PI*2/size,noise=state/4294967296
      const value=Math.floor(128+42*Math.sin(angle*5+1.6*Math.sin(x*2*Math.PI/size))+20*noise)
      const i=4*(y*size+x);pixels.set([value,value,value,255],i)
    }
    const t=new T.DataTexture(pixels,size,size);t.wrapS=t.wrapT=T.RepeatWrapping
    t.generateMipmaps=true;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.needsUpdate=true
    textures.push(t);return t
  }
  function mineralMap(file:string,srgb=false){
    const map=new T.TextureLoader().load(import.meta.env.BASE_URL+'tanggang/textures/harbor/'+file)
    map.wrapS=map.wrapT=T.RepeatWrapping
    map.anisotropy=4
    if(srgb)map.colorSpace=T.SRGBColorSpace
    textures.push(map)
    return map
  }
  ore.map=mineralMap('ore-grain.jpg',true)
  ore.normalMap=mineralMap('ore-normal.jpg');ore.normalScale.set(1.0,1.0)
  // 堆场三套离线烘焙材质：煤、褐矿、灰矿。颜色与法线由
  // modeling/harbor/bake_stockpile_materials.py 生成，按世界 UV 平铺。
  const pileKinds=['coal','brown','grey'] as const
  type PileKind=typeof pileKinds[number]
  const pileMaterials=Object.fromEntries(pileKinds.map(kind=>{
    // 煤/褐矿/灰矿：深色基色 + 顶点色明暗，完全不挂任何平铺贴图。
    // 之前照片色图和法线在 150 单位外会重复成“鱼鳞/瓦楞”纹，是“一看就是贴图”的主因。
    // 现在只靠 Blender 烘焙的顶点色（顶亮坡暗 + 颗粒）和几何本身表现体积。
    const tint={coal:'#3c434a',brown:'#6f5940',grey:'#7c8285'}[kind]
    const m=new T.MeshStandardMaterial({color:tint,roughness:1,metalness:.02,vertexColors:true})
    m.envMapIntensity=.5
    materials.push(m)
    return [kind,m]
  })) as Record<PileKind,T.MeshStandardMaterial>
  // CC0 PBR 地面：沥青道路、混凝土场坪、草地。UV 已按世界单位生成（prism）。
  const asphalt=mineralMap('pbr/asphalt/color.jpg',true)
  const asphaltN=mineralMap('pbr/asphalt/normal.jpg')
  const asphaltR=mineralMap('pbr/asphalt/rough.jpg')
  asphalt.repeat.set(1,1);asphaltN.repeat.set(1,1);asphaltR.repeat.set(1,1)
  const roadPbr=palette('#969c94',.94,0)
  roadPbr.polygonOffset=true;roadPbr.polygonOffsetFactor=-3;roadPbr.polygonOffsetUnits=-6
  roadPbr.map=asphalt;roadPbr.normalMap=asphaltN;roadPbr.roughnessMap=asphaltR
  roadPbr.normalScale.set(.55,.55)
  const concreteMap=mineralMap('pbr/concrete/color.jpg',true)
  const concreteN=mineralMap('pbr/concrete/normal.jpg')
  const concreteR=mineralMap('pbr/concrete/rough.jpg')
  deck.map=concreteMap;deck.normalMap=concreteN;deck.roughnessMap=concreteR
  deck.color.set('#7e857c')
  concreteMap.repeat.set(.30,.30);concreteN.repeat.set(.30,.30);concreteR.repeat.set(.30,.30)
  const grassMap=mineralMap('pbr/grass/color.jpg',true)
  const grassN=mineralMap('pbr/grass/normal.jpg')
  const grassR=mineralMap('pbr/grass/rough.jpg')
  leaf.map=grassMap;leaf.normalMap=grassN;leaf.roughnessMap=grassR
  leaf.color.set('#a9c489')
  grassMap.repeat.set(.18,.18);grassN.repeat.set(.18,.18);grassR.repeat.set(.18,.18)
  const lakeRipple=waterRipples();lakeRipple.repeat.set(2,2)
  // 车道磨痕：两条低频深色带 + 斑驳污渍，避免沥青读成纯色条。
  function tyreTracks(){
    const size=128,cv=document.createElement('canvas');cv.width=cv.height=size
    const c2=cv.getContext('2d')
    if(c2){
      c2.clearRect(0,0,size,size)
      for(const u of [.30,.70]){
        const g=c2.createLinearGradient((u-.10)*size,0,(u+.10)*size,0)
        g.addColorStop(0,'rgba(26,29,27,0)');g.addColorStop(.5,'rgba(26,29,27,.52)');g.addColorStop(1,'rgba(26,29,27,0)')
        c2.fillStyle=g;c2.fillRect((u-.10)*size,0,.20*size,size)
      }
      let state=7919
      const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
      for(let k=0;k<46;k++){
        const x=rand()*size,y=rand()*size,r=3+rand()*9
        const g2=c2.createRadialGradient(x,y,0,x,y,r)
        g2.addColorStop(0,'rgba(24,26,24,.20)');g2.addColorStop(1,'rgba(24,26,24,0)')
        c2.fillStyle=g2;c2.fillRect(x-r,y-r,r*2,r*2)
      }
    }
    const t=new T.CanvasTexture(cv);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace
    textures.push(t);return t
  }
  // 堆脚积煤/尘土：不规则暗斑，贴在堆体两侧与端部，弱化“干净场坪上的色块”感。
  function coalDust(){
    const size=128,cv=document.createElement('canvas');cv.width=cv.height=size
    const c2=cv.getContext('2d')
    if(c2){
      c2.clearRect(0,0,size,size)
      let state=3301
      const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
      for(let k=0;k<90;k++){
        const x=rand()*size,y=rand()*size
        const rx=6+rand()*22,ry=4+rand()*14,rr=Math.max(rx,ry)
        const alpha=.05+rand()*.16
        const g=c2.createRadialGradient(x,y,0,x,y,rr)
        g.addColorStop(0,`rgba(24,22,20,${alpha})`);g.addColorStop(1,'rgba(24,22,20,0)')
        c2.save();c2.translate(x,y);c2.scale(rx/rr,ry/rr)
        c2.fillStyle=g;c2.beginPath();c2.arc(0,0,rr,0,Math.PI*2);c2.fill();c2.restore()
      }
    }
    const t=new T.CanvasTexture(cv);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace
    textures.push(t);return t
  }
  const tyreMat=new T.MeshBasicMaterial({map:tyreTracks(),transparent:true,depthWrite:false,opacity:.85})
  const dustMat=new T.MeshBasicMaterial({map:coalDust(),transparent:true,depthWrite:false,opacity:.75})
  materials.push(tyreMat,dustMat)
  const batches=new Map<T.Material,T.BufferGeometry[]>()
  function add(g:T.BufferGeometry,m:T.Material){
    const batch=batches.get(m)||[];batch.push(g);batches.set(m,batch)
  }
  // 道路网：CAD「00-总图01推荐 道路中心线」按 7m 车行道生成，补路缘与中心虚线。
  const buildRoads=()=>{
    for(const line of data.lines){
      if(line.layer!=='00-总图01推荐 道路中心线')continue
      const p=line.displayPoints
      for(let i=0;i<p.length-1;i++){
        const a=p[i],b=p[i+1],len=distance(a,b)
        if(len<5)continue
        add(strip(a,b,7,.05,.02),road)
        const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len
        for(const side of [-1,1]){
          const ox=-dz*side*3.62,oz=dx*side*3.62
          add(strip([a[0]+ox,a[1]+oz],[b[0]+ox,b[1]+oz],.3,.12,.02),coping)
        }
        const n=Math.max(1,Math.floor(len/6))
        for(let k=0;k<n;k++){
          const t0=(k+.12)/n,t1=(k+.62)/n
          add(strip([a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0],
                    [a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1],.12,.02,.075),stripe)
        }
      }
    }
  }
  // 异步模型加载完成后追加的静态构件：直接入组，并纳入统一几何释放。
  function addNow(g:T.BufferGeometry,m:T.Material){
    const mesh=new T.Mesh(g,m);mesh.castShadow=true;mesh.receiveShadow=true
    group.add(mesh);geometries.push(g);return mesh
  }
  function interactive(g:T.BufferGeometry,m:T.Material,source:Record<string,string>){
    const mesh=new T.Mesh(g,m);mesh.userData=source;mesh.castShadow=true;mesh.receiveShadow=true
    group.add(mesh);picks.push(mesh);geometries.push(g);return mesh
  }
  // 精细建筑的材质参数统一覆盖：GLB 只存几何与材质名，PBR 数值由前端控制。
  function tuneBuildingMaterials(root:T.Object3D){
    root.traverse(o=>{
      if(!(o instanceof T.Mesh))return
      for(const m of Array.isArray(o.material)?o.material:[o.material]){
        const std=m as T.MeshStandardMaterial
        if(!std.isMeshStandardMaterial)continue
        const n=(std.name||'').toLowerCase()
        if(n.includes('glass')){std.color.set('#3a5a66');std.roughness=.10;std.metalness=.18;std.envMapIntensity=.80}
        else if(n.includes('metal')){std.roughness=.52;std.metalness=.35;std.envMapIntensity=.65}
        else if(n.includes('dark')){std.roughness=.6;std.metalness=.25}
        else if(n.includes('orange')){std.roughness=.48;std.metalness=.25}
        else if(n.includes('concrete')){std.color.set('#8d918b');std.roughness=.92;std.metalness=0;std.envMapIntensity=.4}
        else if(n.includes('paint')){std.color.set('#d2d6d0');std.roughness=.70;std.metalness=.02;std.envMapIntensity=.6}
        else if(n.includes('corrugation')){std.color.set('#c3c7c1');std.roughness=.78;std.metalness=.08;std.envMapIntensity=.45}
        else if(n.includes('roof')){std.color.set('#9ba09a');std.roughness=.72;std.metalness=.06;std.envMapIntensity=.5}
      }
    })
  }
  // 矩形池体 L1 示意：外挑池沿、暗色内壁、低于池沿的水面、分格墙与检修梯。
  // 尺度取地标显示尺寸，不代表实测池壁厚度或有效水深。
  function basin(x:number,z:number,w:number,d:number,raised=0){
    // 集水池按设计图做成半地上池：池沿高出场坪，避免被堆场南端管架与场坪遮住。
    const tw=.13,wallH=.26+raised,y0=.055
    // 池外散水与巡检通道
    add(new T.BoxGeometry(w+1.15,.055,d+1.15).translate(x,y0-.005,-z),concrete)
    add(new T.BoxGeometry(w+.70,.045,.46).translate(x,y0+.02,-(z-d/2-.48)),walkway)
    // 四面池壁
    add(new T.BoxGeometry(w,wallH,tw).translate(x,y0+wallH/2,-(z-d/2+tw/2)),basinWall)
    add(new T.BoxGeometry(w,wallH,tw).translate(x,y0+wallH/2,-(z+d/2-tw/2)),basinWall)
    add(new T.BoxGeometry(tw,wallH,d-2*tw).translate(x-w/2+tw/2,y0+wallH/2,-z),basinWall)
    add(new T.BoxGeometry(tw,wallH,d-2*tw).translate(x+w/2-tw/2,y0+wallH/2,-z),basinWall)
    // 浅色压顶，比池壁略宽，远景能读出池沿
    add(new T.BoxGeometry(w+.24,.05,tw+.14).translate(x,y0+wallH+.025,-(z-d/2+tw/2)),poolRim)
    add(new T.BoxGeometry(w+.24,.05,tw+.14).translate(x,y0+wallH+.025,-(z+d/2-tw/2)),poolRim)
    add(new T.BoxGeometry(tw+.14,.05,d-2*tw+.24).translate(x-w/2+tw/2,y0+wallH+.025,-z),poolRim)
    add(new T.BoxGeometry(tw+.14,.05,d-2*tw+.24).translate(x+w/2-tw/2,y0+wallH+.025,-z),poolRim)
    // 暗内壁：水面以上的窄带，明确“池沿高于水面”
    add(new T.BoxGeometry(w-2*tw-.02,.09,.025).translate(x,y0+wallH-.05,-(z-d/2+tw+.012)),basinInner)
    add(new T.BoxGeometry(w-2*tw-.02,.09,.025).translate(x,y0+wallH-.05,-(z+d/2-tw-.012)),basinInner)
    add(new T.BoxGeometry(.025,.09,d-2*tw-.02).translate(x-w/2+tw+.012,y0+wallH-.05,-z),basinInner)
    add(new T.BoxGeometry(.025,.09,d-2*tw-.02).translate(x+w/2-tw-.012,y0+wallH-.05,-z),basinInner)
    // 下沉水面：低于压顶和池壁顶，读作有池壁的水池而不是平铺色块
    add(new T.BoxGeometry(w-2*tw-.08,.03,d-2*tw-.08).translate(x,y0+wallH*.55,-z),basinWater)
    // 超长池才加分格墙，避免把南侧五池读成十个格子
    if(w>9){
      add(new T.BoxGeometry(.10,wallH*.8,d-2*tw).translate(x,y0+wallH*.4,-z),basinWall)
      add(new T.BoxGeometry(.46,.04,d-2*tw).translate(x,y0+wallH*.8+.02,-z),walkway)
    }
    // 检修梯与池沿栏杆（只做远景观感所需的三面）
    add(new T.BoxGeometry(.05,wallH+.34,.05).translate(x+w/2-.30,y0+(wallH+.34)/2,-(z-d/2+.30)),steel)
    add(new T.BoxGeometry(.05,wallH+.34,.05).translate(x+w/2-.30,y0+(wallH+.34)/2,-(z-d/2+.68)),steel)
    for(let i=1;i<=3;i++)
      add(new T.BoxGeometry(.05,.03,.42).translate(x+w/2-.30,y0+wallH*.30+i*.09,-(z-d/2+.49)),steel)
    for(const [xa,xb,za,zb] of [[x-w/2,x+w/2,z-d/2,z-d/2],[x-w/2,x+w/2,z+d/2,z+d/2]] as number[][]){
      add(strip([xa,za],[xb,zb],.04,.04,y0+wallH+.34),fence)
      for(let t=.05;t<1;t+=.18)
        add(new T.BoxGeometry(.04,.30,.04).translate(xa+(xb-xa)*t,y0+wallH+.19,-(za+(zb-za)*t)),fence)
    }
    // 格栅盖板：沿巡检通道断续铺开
    for(let t=.12;t<.92;t+=.20)
      add(new T.BoxGeometry(.42,.03,.34).translate(x-w/2+(w)*t,y0+.052,-(z-d/2-.62)),grating)
  }
  // 建筑立面构成：基座、勒脚、檐口、成组窗带与门洞。只在外包盒范围附加，
  // 不改动 CAD 基底轮廓；层数、窗格与门位均为表现参数。
  function facade(cx:number,cz:number,w:number,d:number,H:number,style:'industrial'|'office'|'workshop'){
    // 基座与散水
    add(new T.BoxGeometry(w+.55,.16,d+.55).translate(cx,.08,-cz),plinthMat)
    // 檐口压顶，厚度大于墙面，形成可见屋檐
    add(new T.BoxGeometry(w+.42,.16,d+.42).translate(cx,H-.01,-cz),coping)
    const levels=style==='office'?2:1
    const sides:[[number,number],[number,number]][] = [
      [[cx-w/2,cz-d/2],[cx+w/2,cz-d/2]],
      [[cx-w/2,cz+d/2],[cx+w/2,cz+d/2]],
      [[cx-w/2,cz-d/2],[cx-w/2,cz+d/2]],
      [[cx+w/2,cz-d/2],[cx+w/2,cz+d/2]],
    ]
    sides.forEach(([a,b],si)=>{
      const len=Math.hypot(b[0]-a[0],b[1]-a[1])
      if(len<1.2)return
      const cells=Math.min(12,Math.max(2,Math.floor(len/1.55)))
      for(let lv=0;lv<levels;lv++){
        const y=H*(lv+.45)/(levels+ (style==='office'?0.35:0.9))
        for(let j=0;j<cells;j++){
          const t0=(j+.20)/cells,t1=(j+.80)/cells
          // 门洞位置在朝码头一侧留空
          if(si===0&&lv===0&&j===Math.floor(cells/2))continue
          add(strip([a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0],
            [a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1],
            .035,H>2.4?.14:.11,y),glazing)
        }
      }
      if(style==='office')for(let lv=1;lv<levels;lv++)
        add(strip(a,b,.06,.045,H*lv/levels+.02),coping)
    })
    // 门洞：深色凹口 + 雨棚（朝南/码头侧）
    add(new T.BoxGeometry(1.05,H*.36,.10).translate(cx,H*.18,-(cz-d/2-.06)),doorMat)
    add(new T.BoxGeometry(1.55,.10,.62).translate(cx,H*.40,-(cz-d/2-.28)),coping)
    // 屋顶设备：通风/空调机组，按体量比例布置
    if(w>3.2&&d>1.8){
      add(new T.BoxGeometry(1.0,.28,.7).translate(cx-w*.18,H+.14,-cz),steel)
      add(new T.BoxGeometry(.7,.20,.55).translate(cx+w*.20,H+.10,-(cz+d*.16)),steel)
    }
  }
  function pond(x:number,z:number,w:number,d:number,token:Record<string,string>){
    add(new T.CylinderGeometry(1,1,.05,32).scale(w*.60,1,d*.62).translate(x,.035,-z),pondBank)
    add(new T.RingGeometry(.86,1,32).rotateX(-Math.PI/2).scale(w*.52,.1,d*.54).translate(x,.075,-z),coping)
    interactive(new T.CylinderGeometry(1,1,.04,32).scale(w*.50,1,d*.52).translate(x,.085,-z),pondWater,token)
    for(let k=0;k<10;k++){
      const a=k/10*Math.PI*2+.4
      if(Math.sin(a)<-.25)continue
      add(new T.ConeGeometry(.05,.22,5).translate(x+Math.cos(a)*w*.49,.20,-(z+Math.sin(a)*d*.51)),reed)
    }
  }
  const [xmin,zmin,xmax,zmax]=data.extentXZ
  const site:XY[]=[[xmin,zmin],[xmax,zmin],[xmax,zmax],[xmin,zmax]]
  add(prism(site,1.7,-1.89),edge);add(prism(site,.2,-.20),deck)
  // Quay apron and yard working pads are surface finishes. They add no CAD footprint.
  add(prism([[xmin,zmin],[xmax,zmin],[xmax,zmin+5.4],[xmin,zmin+5.4]],.215,-.185),concrete)
  // Crane rails and quay edge line. Presentation detail on the source quay apron.
  for(const z of [zmin+1.55,zmin+3.45])
    add(prism([[xmin,z],[xmax,z],[xmax,z+.10],[xmin,z+.10]],.015,.034),steel)
  add(prism([[xmin,zmin+.42],[xmax,zmin+.42],[xmax,zmin+.56],[xmin,zmin+.56]],.012,.034),stripe)
  // Landscape verge inside the fence: finished surface, not a CAD footprint.
  add(prism([[xmin,zmin],[xmin+2,zmin],[xmin+2,zmax],[xmin,zmax]],.07,.008),leaf)
  add(prism([[xmax-2,zmin],[xmax,zmin],[xmax,zmax],[xmax-2,zmax]],.07,.008),leaf)
  add(prism([[xmin,zmax-2],[xmax,zmax-2],[xmax,zmax],[xmin,zmax]],.07,.008),leaf)
  // Open lawn in areas without a CAD facility footprint. Low enough that CAD roads stay on top.
  add(prism([[-66,50],[58,50],[58,63.4],[-66,63.4]],.03,.004),grass)
  add(prism([[46,-46],[63.4,-46],[63.4,49],[46,49]],.03,.004),grassAlt)
  add(prism([[-66,-47],[-58,-47],[-58,33],[-66,33]],.03,.004),grassAlt)
  // Park setting around the east service buildings, as in the reference composition.
  add(prism([[22.5,-43],[47,-43],[47,7],[22.5,7]],.028,.004),grassDry)
  add(prism([[-49,33],[-20,33],[-20,47.5],[-49,47.5]],.028,.004),grass)
  add(prism([[-48,-43],[-6,-43],[-6,-36.5],[-48,-36.5]],.028,.004),grassDry)
  add(prism([[-66,-50],[-49,-50],[-49,-37],[-66,-37]],.028,.004),grassAlt)
  // Hardened yard pads. A road whose centreline runs within 2.4 units of a pad edge
  // gets a real corridor cut here (FB499 along the east edge of YB-04), so the road
  // surface is not buried under the 0.108-high pad top.
  const roadLines=data.lines.filter(l=>l.layer.includes('道路中心线')&&l.displayPoints.length>=2)
  // 植树最终坐标写入前的道路硬判定：所有树源（林带、路树、CAD 绿化散点、旧冠层）
  // 都按最近可绘制道路中心折线求平面距离，低值即位于车道面内。
  const roadSegments=roadLines.flatMap(l=>{
    const pts=l.displayPoints
    return pts.slice(1).map((p,i)=>({ax:pts[i][0],az:pts[i][1],bx:p[0],bz:p[1],handle:l.handle}))
  })
  const ROAD_HALF_WIDTH=.66
  function distanceToRoad(x:number,z:number){
    let best=Infinity
    for(const s of roadSegments){
      const dx=s.bx-s.ax,dz=s.bz-s.az
      const len2=dx*dx+dz*dz
      const t=len2>0?Math.max(0,Math.min(1,((x-s.ax)*dx+(z-s.az)*dz)/len2)):0
      const px=s.ax+dx*t-x,pz=s.az+dz*t-z
      const d=Math.hypot(px,pz)
      if(d<best)best=d
    }
    return best
  }
  const yardPads=data.yardBands.map(b=>{
    const xs=b.displayXZ.map(p=>p[0]), zs=b.displayXZ.map(p=>p[1])
    const bx0=Math.min(...xs),bx1=Math.max(...xs),bz0=Math.min(...zs),bz1=Math.max(...zs)
    let poly=b.displayXZ
    for(const road of roadLines){
      const rx=road.displayPoints.map(p=>p[0]), rz=road.displayPoints.map(p=>p[1])
      if(Math.max(...rx)-Math.min(...rx)>.6)continue
      const x=(Math.min(...rx)+Math.max(...rx))/2
      if(x<=bx0||x>=bx1)continue
      if(Math.max(...rz)<bz0||Math.min(...rz)>bz1)continue
      if(x-bx0<2.4)poly=clipHalfX(poly,x+.80,true)
      else if(bx1-x<2.4)poly=clipHalfX(poly,x-.80,false)
    }
    return poly
  })
  for(const pad of yardPads)if(pad.length>=3)add(prism(pad,.10,.008),coalPad)
  // CAD 只给出 8 个纵向堆场编号，每个编号带 A/B 两个文字锚点。
  // 设计图把每列读成南北两堆，因此在带中点切分；这是表现层推定，
  // 原图没有中间横向分割线（spatial-candidates-v2.6 已注明）。
  type YardColumn={key:string;bandId:string;x:number;anchors:{side:string;id:string;handle:string;z:number}[]}
  const yardColumns=new Map<string,YardColumn>()
  for(const yard of spatial.yardSideCandidates){
    const key=(yard.label||yard.id).replace(/^[AB]侧\s*/,'')||yard.id
    const c=yardColumns.get(key)||{key,bandId:yard.bandId,x:0,anchors:[]}
    const count=c.anchors.length
    c.x=(c.x*count+yard.sceneXZ[0])/(count+1)
    c.anchors.push({side:yard.side,id:yard.id,handle:yard.sourceTextHandle,z:yard.sceneXZ[1]})
    yardColumns.set(key,c)
  }
  const columnsByBand=new Map<string,YardColumn[]>()
  for(const c of yardColumns.values()){
    const list=columnsByBand.get(c.bandId)||[]
    list.push(c);columnsByBand.set(c.bandId,list)
  }
  for(const list of columnsByBand.values())list.sort((a,b)=>a.x-b.x)
  const yardBandsById=new Map(data.yardBands.map(b=>[b.id,b]))
  // Contact shadow texture: soft AO under piles and buildings, no measured shading data.
  function contactShadow(){
    const size=128,cv=document.createElement('canvas');cv.width=cv.height=size
    const c2=cv.getContext('2d')
    if(c2){
      const grd=c2.createRadialGradient(size/2,size/2,size*.05,size/2,size/2,size*.5)
      grd.addColorStop(0,'rgba(18,26,30,.62)');grd.addColorStop(.62,'rgba(18,26,30,.30)');grd.addColorStop(1,'rgba(18,26,30,0)')
      c2.fillStyle=grd;c2.fillRect(0,0,size,size)
    }
    const t=new T.CanvasTexture(cv);t.colorSpace=T.SRGBColorSpace;textures.push(t);return t
  }
  const shadowTex=contactShadow()
  const shadowMat=new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,opacity:.72})
  const softShadowMat=new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,opacity:.42})
  materials.push(shadowMat,softShadowMat)
  const splitGap=4.2
  // 程序化堆体先保证首屏可读；Blender GLB 加载完成后隐藏并由精细资产接管。
  const proceduralPiles:T.Mesh[]=[]
  // 南北端各留 2 单位道路，避开 CAD 集水池轮廓：北池 z≥38.2，南池 z≤-45.5。
  const poolZ=spatial.poolContourCandidates.flatMap(p=>p.displayXZ.map(v=>v[1]))
  const northPoolEdge=Math.min(...poolZ.filter(z=>z>0))
  const southPoolEdge=Math.max(...poolZ.filter(z=>z<0))
  for(const columns of columnsByBand.values()){
    const band=yardBandsById.get(columns[0].bandId)
    if(!band)continue
    const bx=band.displayXZ.map(p=>p[0]),bz=band.displayXZ.map(p=>p[1])
    const bMinX=Math.min(...bx),bMaxX=Math.max(...bx)
    const zMin=Math.min(...bz),zMax=Math.max(...bz)
    const mid=(zMin+zMax)/2
    const yardNorth=Math.min(zMax,northPoolEdge-2)
    const yardSouth=Math.max(zMin,southPoolEdge+2)
    columns.forEach((c,ci)=>{
      const left=ci>0?(c.x-columns[ci-1].x)/2-.4:c.x-bMinX-.22
      const right=ci<columns.length-1?(columns[ci+1].x-c.x)/2-.4:bMaxX-c.x-.22
      if(Math.min(left,right)<.65)return
      const width=left+right,footX=c.x+(right-left)/2
      const n=Number(c.key.replace(/\D/g,''))||1
      for(const north of [true,false]){
        const anchor=c.anchors.find(a=>north?a.side==='A':a.side==='B')||c.anchors[0]
        if(!anchor)continue
        const z0=north?mid+splitGap/2:yardSouth
        const z1=north?yardNorth:mid-splitGap/2
        const length=z1-z0
        if(length<3)continue
        const cz=(z0+z1)/2
        const seed=n*2+(north?0:1)
        const h=2.70+.15*((n+(north?0:1))%3)
        const kind=pileKinds[(n-1+(north?0:1))%pileKinds.length]
        const geo=stockpile(left,right,length,h,seed)
        geo.translate(c.x,.112,-cz)
        // 北堆绑 A 侧锚点、南堆绑 B 侧锚点；拾取详情仍回到原 CAD 候选。
        const pileMesh=interactive(geo,pileMaterials[kind],{pick:'reliefPoint',pointId:anchor.id,sourceHandle:anchor.handle})
        proceduralPiles.push(pileMesh)
        // Soft contact shadow keeps the pile visually planted on the pad.
        const sh=new T.PlaneGeometry(width+1.2,length+1.2).rotateX(-Math.PI/2).translate(footX,.1115,-cz)
        add(sh,shadowMat)
        // 堆脚积煤/尘土：沿两侧与端部铺不规则暗斑，让堆体与场坪之间有过浆脏边。
        for(const s of [-1,1]){
          const dx=footX+s*(width/2+.62)
          add(stripUv(strip([dx,cz-length/2-.6],[dx,cz+length/2+.6],1.45,.0016,.1104),3.6),dustMat)
        }
        for(const z of [cz-length/2-.55,cz+length/2+.55])
          add(stripUv(strip([footX-width/2-.9,z],[footX+width/2+.9,z],1.35,.0016,.1104),3.6),dustMat)
      }
    })
    // 同一堆场带内两列之间铺浅色检修带；带间是道路，不跨带铺。
    for(let i=1;i<columns.length;i++){
      const gap=columns[i].x-columns[i-1].x
      if(gap<4.6)continue
      add(new T.BoxGeometry(Math.min(1.6,gap-3.2),.02,zMax-zMin)
        .translate((columns[i].x+columns[i-1].x)/2,.115,-(zMin+zMax)/2),walkway)
    }
  }
  for(const l of data.lines){
    const path=l.displayPoints
    if(path.length<2)continue
    if(l.layer.includes('道路中心线')){
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],len=distance(a,b)
        if(len<.3)continue
        // 沥青路面按世界坐标铺贴，长路段不再被拉成一条均匀色带。
        add(worldUv(strip(a,b,1.32,.055,.018),2.2),roadPbr)
        // 车轮磨痕：两条低频深色带，远景读作长期行车的旧沥青。
        add(stripUv(strip(a,b,1.06,.002,.0734),6.5),tyreMat)
        const nx=-(b[1]-a[1])/len,nz=(b[0]-a[0])/len
        // 双侧路缘石与沟槽：深灰窄条压住路面边缘，避免道路浮在场坪上。
        for(const s of [-.66,.66])
          add(strip([a[0]+nx*s,a[1]+nz*s],[b[0]+nx*s,b[1]+nz*s],.10,.016,.072),edge)
        // Crisp white kerb lines define the carriageway as in the reference render.
        for(const s of [-.5,.5])
          add(strip([a[0]+nx*s,a[1]+nz*s],[b[0]+nx*s,b[1]+nz*s],.06,.010,.077),stripe)
        const lerp=(f:number):XY=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]
        for(let d=.5;d+1.0<len;d+=2.6)add(strip(lerp(d/len),lerp((d+1.0)/len),.085,.012,.076),stripe)
        // 沿沟槽间隔布置雨水篦子，近景能读出“有排水设施”而不是一道灰边。
        for(let d=1.6;d<len-1;d+=6.4)add(strip(lerp(d/len),lerp((d+.55)/len),.115,.012,.0745),grating)
      }
    }
    if(l.layer==='--绿化'&&path.length>=4&&distance(path[0],path[path.length-1])<.009){
      const area=Math.abs(T.ShapeUtils.area(path.map(([x,z])=>new T.Vector2(x,z))))
      if(area>.04)add(prism(path,.13,.04),leaf)
      // Canopies represent planted areas. No tree inventory is inferred.
      if(area>1.8){
        const contour=path.slice(0,-1),xs=contour.map(p=>p[0]),zs=contour.map(p=>p[1])
        const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2
        const inside=contour.reduce((yes,a,i)=>{
          const b=contour[(i+1)%contour.length]
          return (a[1]>cz)!==(b[1]>cz) && cx<(b[0]-a[0])*(cz-a[1])/(b[1]-a[1])+a[0]?!yes:yes
        },false)
        if(inside){
          const r=Math.min(.82,Math.sqrt(area)*.34)
          add(new T.IcosahedronGeometry(r,1).scale(1,.83,1).translate(cx,r*.86,-cz),canopy)
          add(new T.IcosahedronGeometry(r*.66,0).translate(cx+.18,r*1.11,-cz-.12),canopyLight)
        }
      }
    }
    if(l.layer==='皮带机中心线'){
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],len=distance(a,b)
        if(len<.2)continue
        // Enclosed blue gallery: body, white band and a glazing strip. Section is illustrative.
        add(strip(a,b,.46,.60,1.00),galleryBody);add(strip(a,b,.50,.10,1.30),roof)
        add(strip(a,b,.052,.16,1.12),glint)
        for(let d=1;d<len;d+=3.8){
          const t=d/len
          add(new T.BoxGeometry(.17,1.0,.17).translate(a[0]+(b[0]-a[0])*t,.5,-a[1]-(b[1]-a[1])*t),steel)
        }
      }
    }
  }
  // 北侧厂前路边明沟：按 CAD“排水沟”三条 1.16×3.7 的双线沟槽
  // （x≈−20.5 / −3.9 / 12.5，z≈45.8–49.5）建开口沟；沟底、沟壁为截面示意。
  {
    const vertical=data.lines.filter(l=>l.layer==='排水沟'&&l.displayPoints.length===2
      &&Math.abs(l.displayPoints[0][0]-l.displayPoints[1][0])<.05
      &&Math.abs(l.displayPoints[0][1]-l.displayPoints[1][1])>3
      &&Math.min(l.displayPoints[0][1],l.displayPoints[1][1])>45
      &&Math.max(l.displayPoints[0][1],l.displayPoints[1][1])<50)
    const edges:{x:number;z0:number;z1:number}[]=[]
    for(const l of vertical){
      const [p,q]=l.displayPoints
      if(edges.some(e=>Math.abs(e.x-p[0])<.1))continue
      edges.push({x:p[0],z0:Math.min(p[1],q[1]),z1:Math.max(p[1],q[1])})
    }
    edges.sort((a,b)=>a.x-b.x)
    for(let i=0;i<edges.length-1;i++){
      const a=edges[i],b=edges[i+1],gap=b.x-a.x
      if(gap<.4||gap>2)continue
      const z0=Math.max(a.z0,b.z0),z1=Math.min(a.z1,b.z1)
      if(z1-z0<2)continue
      const cx=(a.x+b.x)/2
      add(strip([cx,z0],[cx,z1],gap-.20,.05,.042),basinInner)
      add(strip([a.x+.07,z0],[a.x+.07,z1],.14,.17,.032),coping)
      add(strip([b.x-.07,z0],[b.x-.07,z1],.14,.17,.032),coping)
      // 路缘进水口格栅：沿沟口 0.8 长铺横条，表达“过路/进水”而不是一条光沟。
      for(let z=z0+.08;z<z0+.78;z+=.12)
        add(new T.BoxGeometry(gap-.24,.024,.06).translate(cx,.207,-z),grating)
      add(new T.BoxGeometry(gap-.18,.05,.05).translate(cx,.21,-(z0+.82)),coping)
      // 北横路硬路肩一侧的进水口：沟体被厂前墙挡住时，仍能顺着路面找到沟。
      const gz0=44.92,gz1=45.62
      add(new T.BoxGeometry(gap,.04,.06).translate(cx,.086,-gz0),coping)
      add(new T.BoxGeometry(gap,.04,.06).translate(cx,.086,-gz1),coping)
      for(let x=a.x+.08;x<b.x-.04;x+=.13)
        add(new T.BoxGeometry(.05,.03,gz1-gz0).translate(x,.09,-((gz0+gz1)/2)),grating)
    }
  }
  // The display water strip follows the longest straight quay line. Its outside edge is scenic.
  const quay=data.lines.filter(l=>l.layer==='00-码头布置（东侧）'&&l.displayPoints.length===2)
    .sort((a,b)=>distance(b.displayPoints[0],b.displayPoints[1])-distance(a.displayPoints[0],a.displayPoints[1]))[0]
  let quayInfo:{a:XY;b:XY;dx:number;dz:number;nx:number;nz:number;len:number}|null=null
  if(quay){
    const [a,b]=quay.displayPoints,len=distance(a,b),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len
    let nx=-dz,nz=dx
    if(nx*((a[0]+b[0]-xmin-xmax)/2)+nz*((a[1]+b[1]-zmin-zmax)/2)<0){nx=-nx;nz=-nz}
    quayInfo={a,b,dx,dz,nx,nz,len}
    const offset=(p:XY,n:number):XY=>[p[0]+nx*n,p[1]+nz*n]
    const coastline=(t:number,n:number):XY=>[a[0]+dx*t+nx*n,a[1]+dz*t+nz*n]
    add(prism([coastline(-140,0),coastline(len+140,0),coastline(len+140,142),coastline(-140,142)],.12,-.065),sea)
    // 单一连续水面：近岸浅水色、湿岸阴影由海面着色器按离岸距离混合，
    // 不再叠加独立的浅水板，避免共面分层与前景色带。
    sea.uniforms.uShoreOrigin.value.set(a[0],-a[1])
    sea.uniforms.uShoreNormal.value.set(nx,-nz)
    const seaEdge=palette('#06344d',.4,.2)
    add(strip(offset(a,.62),offset(b,.62),.30,.010,.069),seaEdge)
    add(strip(a,b,.56,.30,.04),wall)
    // Quay apron safety markings: white edge line and a yellow restraint line.
    const safety=palette('#e6c145',.7,0)
    add(strip(offset(a,-1.02),offset(b,-1.02),.11,.012,.032),safety)
    add(strip(offset(a,-1.95),offset(b,-1.95),.13,.012,.032),stripe)
    // Quay furniture: blue railing, bollards and fenders. Presentation detail only.
    add(strip(a,b,.055,.05,.55),fence)
    for(let d=1.4;d<len;d+=3.2){
      const px=a[0]+dx*d,pz=a[1]+dz*d
      add(new T.BoxGeometry(.09,.40,.09).translate(px,.34,-pz),fence)
      if(Math.round(d/3.2)%2===0){
        add(new T.CylinderGeometry(.10,.13,.16,8).translate(px+dx*.02,.19,-(pz+dz*.02)),steel)
        add(new T.BoxGeometry(.34,.42,.13).translate(px-nx*.35,.02,-(pz-nz*.35)),hull)
      }
    }

  }
  // Yard lighting masts: presentation furniture along the service roads that frame
  // the stockyard. No pole position or luminaire schedule is present in the source DWG.
  {
    const mastSteel=palette('#4d5e64',.5,.48), lamp=palette('#dfe8e4',.34,.28)
    const mast=(x:number,z:number,h=3.9)=>{
      add(new T.CylinderGeometry(.30,.38,.18,10).translate(x,.10,-z),concrete)
      add(new T.CylinderGeometry(.075,.12,h,8).translate(x,h/2,-z),mastSteel)
      add(new T.BoxGeometry(1.05,.06,.06).translate(x,h+.02,-z),mastSteel)
      for(const dx of [-.44,.44])add(new T.BoxGeometry(.30,.10,.19).translate(x+dx,h-.04,-z),lamp)
    }
    for(const z of [-28,-16,-4,8,20])mast(20.9,z)
    for(const z of [-31,-19,10,22])mast(-47.6,z)
    for(const x of [-37,-17,3,23])mast(x,33.4)
  }
  const sites=data.sourceDWGSHA256===landmarksSource?landmarks:[]
  // Detailed Blender building models generated by modeling/harbor/create_buildings.py.
  // Each GLB is authored at the landmark's display size with its base at the origin.
  const buildingFiles:Record<string,string>={
    'F9BEE':'wisdomcenter.glb','8D367':'steeloffice.glb','8D368':'canteen.glb','8D36A':'inspection.glb',
    '139AAA':'integratedtreatment.glb','1AFB89':'ecopump.glb','F9BFB':'workshop.glb','F9BF9':'warehouse.glb'
  }
  function contains(poly:XY[],x:number,z:number){
    let yes=false
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j]
      if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes
    }
    return yes
  }
  const landmarkFootprints=new Set(sites.map(s=>s.footprintHandle).filter(Boolean) as string[])
  // 两处已由 Blender 精修 GLB 表达（loadProcessBuildings）；跳过同位置的旧程序化体量，避免重墙与闪烁。
  const processGlbContours=new Set(['217737','2E23D7'])
  for(const c of data.cadClosedContourCandidates){
    if(c.layer==='水池'||c.outline.length<4)continue
    if(landmarkFootprints.has(c.handle))continue
    if(processGlbContours.has(c.handle))continue
    const match=data.matchedFacilityContours.find(f=>f.handle===c.handle)
    // Use the original polygon for named structures when it contains their CAD text.
    // Its attribution remains a candidate; no duplicate placeholder is drawn on top.
    if(!match && sites.some(s=>(s.kind==='office'||s.kind==='workshop') && contains(c.outline,s.x,s.z)))continue
    const isPump=match?.labels.some(v=>v.includes('泵房'))
    const h=isPump?2.95:c.volumeHeightDisplayOnly*(c.layer==='$pm单体'?1.95:1.25)
    const g=prism(c.outline,h,.10)
    if(match)interactive(g,wall,{pick:'matchedContour',sourceHandle:c.handle})
    else add(g,wall)
    {
      const xs=c.outline.map(p=>p[0]),zs=c.outline.map(p=>p[1])
      const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs)
      const cw=x1-x0,cd=z1-z0
      if(cw>1.1&&cd>1.1){
        const style:string=(match?.labels.join(' ')||'')+(c.layer==='$pm单体'?'':'辅建')
        facade((x0+x1)/2,(z0+z1)/2,cw,cd,h,
          /办公|楼/.test(style)?'office':isPump||/泵房|处理|厂房/.test(style)?'industrial':'workshop')
      }
    }
    add(prism(c.outline,.13,h+.1),match?roof:steel)
    if(c.layer==='$pm单体' && !isPump){
      // Roof seams follow the actual polygon; no equipment is inserted inside the envelope.
      const poly=c.outline, zs=poly.map(p=>p[1])
      for(let z=Math.min(...zs)+.22;z<Math.max(...zs);z+=.43){
        const hits:number[]=[]
        for(let j=1;j<poly.length;j++){
          const [a,b]=[poly[j-1],poly[j]]
          if((a[1]>z)!==(b[1]>z))hits.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]))
        }
        hits.sort((a,b)=>a-b)
        for(let j=1;j<hits.length;j+=2)if(hits[j]-hits[j-1]>.19)
          add(strip([hits[j-1]+.06,z],[hits[j]-.06,z],.042,.04,h+.23),coping)
      }
    }
    if(isPump){
      const xs=c.outline.map(p=>p[0]),zs=c.outline.map(p=>p[1])
      const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs)
      for(let z=z0+.2;z<z1-.1;z+=.35)add(strip([x0+.08,z],[x1-.08,z],.05,.055,h+.23),steel)
      for(let z=z0+.39;z<z1-.27;z+=.72)
        add(new T.BoxGeometry(.05,.53,.49).translate(x1+.012,1.53,-z),roof)
      add(strip([x1,z0],[x1,z1],.075,.12,1.1),accent)
    }
  }
  // 池体只保留七处地标锚点对应的 basin()（见 facilities 分支）。spatial 里的
  // poolContourCandidates 是同一批池口的嵌套候选描边，逐条起板会在水面之上叠出
  // 重复的浅蓝平台与栏杆，故不再单独生成；候选 handle 仍保留在数据与详情中。

  // ---------------------------------------------------------------- process equipment
  // Circular clarifiers near the CAD text of 污水处理场 (TG-CAD-11). The tanks are
  // presentation geometry: this DWG has no verified tank outline or diameter.
  const clarifierWater=palette('#117899',.23,.06)
  clarifierWater.envMapIntensity=.3
  clarifierWater.emissive=new T.Color('#1a6480');clarifierWater.emissiveIntensity=.21
  const clarifierRim=palette('#eef6f7',.48,.05)
  // 开口筒壁：池壁必须是环状开口，不能用带封盖的圆柱，否则顶盖会把下沉水面整片挡住。
  const clarifierOuter=palette('#ccd7d2',.74,.03);clarifierOuter.side=T.DoubleSide
  const clarifierInner=palette('#31525c',.85,.04);clarifierInner.side=T.DoubleSide
  for(const [cx,cz] of [[-36.4,34.4],[-30.6,34.4],[-36.4,40.2],[-30.6,40.2]] as XY[]){
    // 池外散水
    add(new T.CylinderGeometry(2.95,2.95,.055,44).translate(cx,.03,-cz),concrete)
    // 池壁：外壁与暗色内壁均为开口筒壁，水面从池口可见
    add(new T.CylinderGeometry(2.56,2.56,.36,44,1,true).translate(cx,.18,-cz),clarifierOuter)
    add(new T.CylinderGeometry(2.42,2.42,.34,44,1,true).translate(cx,.17,-cz),clarifierInner)
    // 下沉水面：低于压顶，远端也能读出“池沿高于水面”
    interactive(new T.CylinderGeometry(2.38,2.38,.05,44).translate(cx,.235,-cz),clarifierWater,{pick:'reliefPoint',pointId:'TG-CAD-11',sourceHandle:'FAC62'})
    // 浅色压顶，盖住内外壁的顶缘
    add(new T.TorusGeometry(2.48,.11,10,48).rotateX(Math.PI/2).translate(cx,.355,-cz),clarifierRim)
    // 中心驱动、跨池走道与栏杆
    add(new T.CylinderGeometry(.18,.21,.98,12).translate(cx,.49,-cz),steel)
    add(new T.BoxGeometry(4.6,.10,.32).translate(cx,.99,-cz),steel)
    for(const side of [-1,1]){
      add(new T.BoxGeometry(4.6,.035,.03).translate(cx,1.15,-cz+side*.17),clarifierRim)
      for(let t=-2.2;t<=2.21;t+=.62)
        add(new T.BoxGeometry(.035,.18,.035).translate(cx+t,1.06,-cz+side*.17),fence)
    }
    // 出水堰与浮渣挡板
    add(new T.TorusGeometry(2.10,.05,8,40).rotateX(Math.PI/2).translate(cx,.305,-cz),coping)
    add(new T.TorusGeometry(2.50,.03,6,40).rotateX(Math.PI/2).translate(cx,.44,-cz),fence)
  }
  // 澄清池之间的进水渠：表现层，连接关系未核。
  add(new T.BoxGeometry(5.6,.22,.46).translate(-33.5,.20,-34.4),concrete)
  add(new T.BoxGeometry(5.4,.05,.34).translate(-33.5,.30,-34.4),clarifierWater)
  // 北部处理设施混凝土场坪：把处理场、泵房与集水池从堆场铺面中分离出来。
  add(prism([[-41.5,32.2],[14.5,32.2],[14.5,45.6],[-41.5,45.6]],.022,.012),concrete)
  // Silver spherical pressure tanks west of the 除尘泵房 contour (217737, x -2.3..1.2).
  for(let i=0;i<4;i++){
    const sx=-9.0+i*2.2, sz=40.7
    add(new T.SphereGeometry(1.08,20,14).translate(sx,1.86,-sz),silver)
    add(new T.CylinderGeometry(.15,.15,.65,8).translate(sx,1.02,-sz),steel)
    for(let k=0;k<4;k++){
      const a=k/4*Math.PI*2+.4
      add(new T.BoxGeometry(.07,1.05,.07).translate(sx+Math.cos(a)*.62,.52,-(sz+Math.sin(a)*.62)),steel)
    }
    add(new T.CylinderGeometry(.10,.10,.10,6).translate(sx,2.72,-sz),steel)
  }
  // Blue-grey silos beside the spheres; massing only, no verified tank schedule.
  const silo=palette('#7e97a3',.44,.46)
  for(let i=0;i<3;i++){
    const sx=-12.9+i*1.62, sz=41.3
    add(new T.CylinderGeometry(.76,.76,1.6,20).translate(sx,1.0,-sz),silo)
    add(new T.SphereGeometry(.76,20,10,0,Math.PI*2,0,Math.PI/2).translate(sx,1.8,-sz),silo)
    add(new T.CylinderGeometry(.07,.07,.55,6).translate(sx,2.55,-sz),steel)
    add(new T.CylinderGeometry(.09,.09,.16,8).translate(sx,2.86,-sz),coping)
  }
  // 洗车台区（CAD 文字 TG-CAD-13 / FAE1D）改由 modeling/harbor 导出的
  // wash-station-l1.glb 表现，旧程序化棚板与重复场坪已移除，避免共面闪烁。
  // 位置仍取 CAD 文字点 x≈−45.48、z≈−6.27；拾取复用原锚点 ID。
  // ---------------------------------------------------------------- planting
  // Perimeter forest belts and trees inside closed --绿化 outlines. Trees are
  // landscape presentation; there is no tree inventory in the source DWG.
  const rng=(()=>{let s=20261121>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}})()
  const treeSites:{x:number;z:number;r:number;h:number;tone:number;detail:boolean}[]=[]
  // `detail` marks trees near the working area that use the Blender tree models.
  // The dense perimeter belts keep the low-poly instanced crowns.
  const pushTree=(x:number,z:number,scale=1,detail=false)=>{
    treeSites.push({x,z,r:(.36+.54*rng())*scale,h:(.52+1.60*rng())*scale,tone:Math.floor(rng()*6),detail})
  }
  const blocks=(data.sourceDWGSHA256===landmarksSource?landmarks:[])
    .filter(f=>f.kind!=='lake')
    .map(f=>({x:f.x,z:f.z,rx:f.width*.72+1.8,rz:f.depth*.72+1.8}))
  // 湖面范围内不种树，保证水面、步道与树丛之间留出间隔。
  const lakeSite=(data.sourceDWGSHA256===landmarksSource?landmarks:[]).find(f=>f.kind==='lake')
  // 设施正面的树丛会挡住默认机位识别；按地标外包尺寸清出可视走廊。
  const blocked=(x:number,z:number)=>{
    // 洗车台棚架范围内不种树，避免树冠穿出棚顶。
    if(Math.abs(x+45.5)<7.6&&Math.abs(z+6.3)<10.6)return true
    // 车道面内不种树：树干为硬碰撞，冠幅也要退出车道与转弯扫掠带。
    if(distanceToRoad(x,z)<ROAD_HALF_WIDTH+.62)return true
    if(lakeSite){
      const dx=(x-(lakeSite.x+lakeDisplayOffset.x))/(lakeSite.width*1.55),dz=(z-(lakeSite.z+lakeDisplayOffset.z))/(lakeSite.depth*1.30)
      if(dx*dx+dz*dz<1)return true
    }
    return blocks.some(b=>{
      const dx=(x-b.x)/b.rx,dz=(z-b.z)/b.rz
      return dx*dx+dz*dz<1
    })
  }
  // Woodland belt now starts right behind the north facility row and along the east
  // boundary, as in the reference composition. Tree spacing is presentation only.
  // 树带收窄 5–6 单位，把画面留给场地；林带靠疏密噪声与空地制造自然缺口。
  // 只保留北侧远景林带；东西两侧按设计图改为厂区道路与稀疏行道树，避免整圈密林。
  const belts:number[][]=[[xmin-12,xmax+13,47.2,zmax+13]]
  for(const [x0,x1,z0,z1] of belts){
    // Dark forest floor under the belts so the edge reads as woodland, not lawn.
    add(prism([[x0,z0],[x1,z0],[x1,z1],[x0,z1]],.045,.004),forestFloor)
    for(let z=z0;z<z1;z+=4.2)for(let x=x0;x<x1;x+=4.2){
      // 低频密度场 + 少量林间空地，避免等距网格感。
      const density=.20+.18*Math.sin(x*.16+z*.11)
      if(rng()>density||Math.sin(x*.11-z*.07+1.7)>.84)continue
      const px=x+(rng()-.5)*1.45,pz=z+(rng()-.5)*1.45
      if(blocked(px,pz))continue
      pushTree(px,pz,.72+rng()*.52)
    }
  }
  // Taller back row so the far forest edge reads as a treeline, not a low hedge.
  // 间距放宽、疏密更随机、高矮跨度加大：树线出现参差缺口而不是连续绿墙。
  for(let x=xmin-10;x<xmax+10;x+=3.8)for(let z=zmax+4;z<zmax+13;z+=3.9){
    if(rng()<.26)continue
    pushTree(x+(rng()-.5)*2.2,z+(rng()-.5)*1.8,.85+rng()*.78)
  }
  let internalTrees=0
  // Street trees along the open north band and the east/west service roads.
  for(let x=-62;x<58;){
    const step=3.6+rng()*5.4
    if(rng()>.30){
      const px=x+(rng()-.5)*.7,pz=46.6+(rng()-.5)*1.1
      if(distanceToRoad(px,pz)>=ROAD_HALF_WIDTH+.62)pushTree(px,pz,.62+rng()*.42,true)
    }
    x+=step
  }
  for(let z=-40;z<32;){
    const step=4.0+rng()*6.0
    const ex=44.4+(rng()-.5)*.8,ez=z+(rng()-.5)*.8,wx=-49.6+(rng()-.5)*.8,wz=z+(rng()-.5)*.8
    if(rng()>.32&&!blocked(ex,ez))pushTree(ex,ez,.55+rng()*.45,true)
    if(rng()>.32&&!blocked(wx,wz))pushTree(wx,wz,.55+rng()*.45,true)
    z+=step
  }
  // Grove on the west service lawn so the quay approach does not read as empty turf.
  for(let x=-64;x<-50;x+=3.2)for(let z=-58;z<-38;z+=3.2){
    if(rng()<.42)continue
    pushTree(x+(rng()-.5)*1.8,z+(rng()-.5)*1.8,1.0+rng()*.45,true)
  }
  // Park trees between the yard roads and the east service buildings, plus the north-east corner.
  for(let z=-40;z<30;z+=2.7)for(const x of [21.6,-46.9])
    if(rng()>.12){const px=x+(rng()-.5)*1.2,pz=z+(rng()-.5)*1.5;if(!blocked(px,pz))pushTree(px,pz,1.0+rng()*.40,true)}
  for(let x=30;x<63;x+=3.0)for(let z=11;z<48;z+=3.0){
    if(rng()<.38)continue
    if(x>44&&z<7)continue
    const px=x+(rng()-.5)*1.7,pz=z+(rng()-.5)*1.7
    if(!blocked(px,pz))pushTree(px,pz,1.05+rng()*.5,true)
  }
  // Second row along the east yard fence and loose park planting on the service lawn.
  for(let z=-36;z<9;z+=3.4)if(rng()>.18){const px=24.9+(rng()-.5)*1.0,pz=z+(rng()-.5)*1.4;if(!blocked(px,pz))pushTree(px,pz,.95+rng()*.35,true)}
  for(let x=26;x<46;x+=4.9)for(let z=-12;z<9;z+=4.9){
    if(rng()<.62)continue
    const px=x+(rng()-.5)*1.6,pz=z+(rng()-.5)*1.6
    if(!blocked(px,pz))pushTree(px,pz,.95+rng()*.4,true)
  }
  // Shoreline trees around the artificial lake; the north bank is left clear for
  // the pump station and treatment buildings.
  for(let i=0;i<9;i++){
    const a=i/9*Math.PI*2
    if(Math.sin(a)>.2)continue
    const r=8.8+rng()*1.2
    pushTree(34.3+Math.cos(a)*r,-41.05+Math.sin(a)*r*.42,.85+rng()*.35,true)
  }
  for(const l of data.lines){
    if(l.layer!=='--绿化'||l.displayPoints.length<4)continue
    const path=l.displayPoints
    if(distance(path[0],path[path.length-1])>=.009)continue
    const area=Math.abs(T.ShapeUtils.area(path.map(([x,z])=>new T.Vector2(x,z))))
    if(area<1.1||internalTrees>360)continue
    const xs=path.map(p=>p[0]),zs=path.map(p=>p[1])
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs)
    for(let z=z0+.5;z<z1-.4;z+=1.7)for(let x=x0+.5;x<x1-.4;x+=1.7){
      if(internalTrees>360)break
      if(!contains(path,x,z))continue
      if(blocked(x,z))continue
      pushTree(x+(rng()-.5)*1.1,z+(rng()-.5)*1.1,.75+rng()*.5,true);internalTrees++
    }
  }
  const simpleSites=treeSites.filter(t=>!t.detail)
  if(simpleSites.length){
    // Smoother belt crowns: one extra subdivision removes the faceted silhouette
    // that read as low-poly blocks against the reference treeline.
    const crownGeo=new T.IcosahedronGeometry(1,1),lobeGeo=new T.IcosahedronGeometry(1,0),trunkGeo=new T.CylinderGeometry(.05,.065,1,5)
    // 共用树冠几何按局部方向起伏，下层枝叶较暗；实例数量与网格细分保持原值。
    for(const geometry of [crownGeo,lobeGeo]){
      const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal')
      const colors=new Float32Array(positions.count*3)
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i)
        const ripple=.15*Math.sin(4*x+3*y)*Math.cos(4*z-2*y)+.11*Math.sin(7*z+2*x)
        const r=1+ripple,light=.58+.30*(y+1)/2+.18*ripple
        positions.setXYZ(i,x*r,y*r*(.85-.16*Math.max(0,y)),z*r)
        const len=Math.hypot(x,1.15*y,z)
        normals.setXYZ(i,x/len,1.15*y/len,z/len)
        colors.set([light*(1+.06*Math.max(0,y)),light,light*.86],i*3)
      }
      geometry.setAttribute('color',new T.BufferAttribute(colors,3))
      geometry.computeBoundingSphere()
    }
    const crownMat=new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.97,metalness:0})
    const trunkMat=new T.MeshStandardMaterial({color:'#5a4a3c',roughness:1,metalness:0})
    materials.push(crownMat,trunkMat);geometries.push(crownGeo,lobeGeo,trunkGeo)
    const crown=new T.InstancedMesh(crownGeo,crownMat,simpleSites.length)
    const crown2=new T.InstancedMesh(lobeGeo,crownMat,simpleSites.length)
    const crown3=new T.InstancedMesh(lobeGeo,crownMat,simpleSites.length)
    const trunk=new T.InstancedMesh(trunkGeo,trunkMat,simpleSites.length)
    crown.name='林带树冠';crown2.name='林带树冠二层';crown3.name='林带树冠三层';trunk.name='林带树干'
    const tones=['#3f5033','#45593a','#35462d','#4c5c3f','#2e3f29','#566644'].map(c=>new T.Color(c))
    const m=new T.Matrix4(),q=new T.Quaternion(),Y=new T.Vector3(0,1,0)
    simpleSites.forEach((t,i)=>{
      const trunkH=t.h*1.2
      // Per-tree rotation and lobe offsets break the repeated identical clump silhouette.
      q.setFromAxisAngle(Y,(t.tone*1.31+i*.53)%(Math.PI*2))
      m.compose(new T.Vector3(t.x,trunkH*.5,-t.z),q,new T.Vector3(1,trunkH,1))
      trunk.setMatrixAt(i,m)
      // 树冠高矮/宽窄拉开跨度：从矮阔冠到高瘦冠都有，避免整齐的绿色球墙。
      const shapeK=((i*13+t.tone)%9)/9
      const sy=.56+.98*shapeK
      const rx=t.r*(.78+.44*((i*11+t.tone*2)%7)/7)
      m.compose(new T.Vector3(t.x,trunkH+t.r*.72*sy,-t.z),q,new T.Vector3(rx,t.r*.92*sy,rx))
      crown.setMatrixAt(i,m)
      crown.setColorAt(i,tones[t.tone%tones.length])
      // Second, smaller crown lobe fills the silhouette instead of a single spike.
      const j1=.18+.10*((i*7+t.tone)%8)/8, j2=.26+.12*((i*5+t.tone*3)%7)/7
      m.compose(new T.Vector3(t.x+t.r*j1,trunkH+t.r*1.06*sy,-t.z-t.r*j1*.82),q,
        new T.Vector3(rx*.66,rx*.60*sy,rx*.66))
      crown2.setMatrixAt(i,m)
      crown2.setColorAt(i,tones[(t.tone+1)%tones.length])
      m.compose(new T.Vector3(t.x-t.r*j2,trunkH+t.r*.86*sy,-t.z+t.r*j2*.66),q,
        new T.Vector3(rx*.52,rx*.48*sy,rx*.52))
      crown3.setMatrixAt(i,m)
      crown3.setColorAt(i,tones[(t.tone+2)%tones.length])
    })
    crown.instanceMatrix.needsUpdate=true;trunk.instanceMatrix.needsUpdate=true
    crown2.instanceMatrix.needsUpdate=true;crown3.instanceMatrix.needsUpdate=true
    if(crown.instanceColor)crown.instanceColor.needsUpdate=true
    if(crown2.instanceColor)crown2.instanceColor.needsUpdate=true
    if(crown3.instanceColor)crown3.instanceColor.needsUpdate=true
    crown.receiveShadow=true;trunk.receiveShadow=true;crown.castShadow=true
    crown2.receiveShadow=true;crown2.castShadow=true
    crown3.receiveShadow=true;crown3.castShadow=true
    crown.computeBoundingSphere();trunk.computeBoundingSphere();crown2.computeBoundingSphere()
    crown3.computeBoundingSphere()
    group.add(crown,trunk,crown2,crown3)
    // 林下灌木层：只保留约 2/3，遮住树干但不在林带前缘堆成连续绿墙。
    const underSites=simpleSites.filter((t,i)=>(i+t.tone)%3!==0)
    if(underSites.length){
      const under=new T.InstancedMesh(lobeGeo,crownMat,underSites.length)
      under.name='林下灌木'
      const underTones=['#354b32','#3d5438','#2f4430'].map(c=>new T.Color(c))
      underSites.forEach((t,i)=>{
        const r=.32+t.r*.52
        m.compose(new T.Vector3(t.x+.22*Math.sin(i*1.7),r*.58,-t.z+.22*Math.cos(i*1.3)),
          q,new T.Vector3(r,r*.74,r))
        under.setMatrixAt(i,m)
        under.setColorAt(i,underTones[i%3])
      })
      under.instanceMatrix.needsUpdate=true
      if(under.instanceColor)under.instanceColor.needsUpdate=true
      under.receiveShadow=true;under.castShadow=true
      under.computeBoundingSphere()
      group.add(under)
    }
    // Far canopy mass behind the perimeter belts: overlapping low-poly crowns that
    // read as continuous woodland from the default camera. Presentation only.
    const blobGeo=new T.IcosahedronGeometry(1,1)
    const blobMat=new T.MeshStandardMaterial({color:'#ffffff',roughness:.98,metalness:0})
    materials.push(blobMat)
    const blobSites:[number,number][]=[]
    for(let x=xmin-16;x<xmax+16;x+=3.0)for(let z=zmax+3;z<zmax+13;z+=3.4)
      if(rng()>.42)blobSites.push([x,z])
    for(let z=zmin+4;z<zmax+8;z+=3.6)for(let x=xmax+3;x<xmax+14;x+=3.3)
      if(rng()>.50)blobSites.push([x,z])
    for(let z=zmin+4;z<zmax+8;z+=3.6)for(let x=xmin-14;x<xmin-3;x+=3.3)
      if(rng()>.50)blobSites.push([x,z])
    const mass=new T.InstancedMesh(blobGeo,blobMat,blobSites.length)
    mass.name='远景林冠体块'
    const massTones=['#3c5a3c','#446345','#35503a','#4d7050','#2f4732','#537a55'].map(c=>new T.Color(c))
    blobSites.forEach(([x,z],i)=>{
      const r=1.32+rng()*.86
      // Deeper (north, higher z) crowns read darker, giving the far woodland a shaded rear edge.
      const depth=z>zmax?Math.min(1,(z-zmax)/20):0
      const tone=Math.min(massTones.length-1,Math.max(0,Math.floor(i%4+depth*2)))
      m.compose(new T.Vector3(x,1.05+r*.32,-z),q,new T.Vector3(r,.72+r*.18,r))
      mass.setMatrixAt(i,m)
      mass.setColorAt(i,massTones[tone])
    })
    mass.receiveShadow=true;mass.castShadow=true
    mass.instanceMatrix.needsUpdate=true
    if(mass.instanceColor)mass.instanceColor.needsUpdate=true
    mass.computeBoundingSphere()
    group.add(mass)
  }
  const glass=palette('#618caa',.34,.16), slate=palette('#8099aa'), lakeside=palette('#a7b88c')
  const lakeWater=new T.MeshStandardMaterial({color:'#2b93ac',roughness:.14,metalness:.10,emissive:'#155a70',emissiveIntensity:.5,
    bumpMap:lakeRipple,bumpScale:.085})
  materials.push(lakeWater)
  const lakeDeep=palette('#1b7285',.22,.04)
  const shallow=palette('#57c1c6',.28,.05), shoreStone=palette('#d9d6ca')
  const shoreShadow=palette('#9c988f',.95,0), reed=palette('#7c9a6d')
  const lakeBank=palette('#a9c091',.96,0)
  const sgGround=palette('#ddd5c5',.96,0), sgWall=palette('#d8d1c4'), sgRoof=palette('#a97a58')
  const clay=palette('#c7c9c7',.94,0)
  let isGray=false,disposed=false
  const originals=new Map<T.Mesh,T.Material|T.Material[]>()
  function assignGray(mesh:T.Mesh){originals.set(mesh,mesh.material);if(isGray)mesh.material=clay}
  // 首钢矿石码头参照区：三栋只有文字锚点，场坪范围仅用于区分参照区与主港区。
  const sgHandles=new Set(['8D367','8D368','8D36A'])
  const sgSites=sites.filter(s=>sgHandles.has(s.handle))
  if(sgSites.length){
    const xs=sgSites.map(s=>s.x),zs=sgSites.map(s=>s.z),pad=2.6
    add(prism([[Math.min(...xs)-pad,Math.min(...zs)-pad],[Math.max(...xs)+pad,Math.min(...zs)-pad],
      [Math.max(...xs)+pad,Math.max(...zs)+pad],[Math.min(...xs)-pad,Math.max(...zs)+pad]],.03,.004),sgGround)
  }
  function landmarkPointId(handle:string,x:number,z:number){
    if(handle==='1058D8')return 'TG-CHAIN-1058D8'
    if(handle==='103415'||handle==='10340E')return 'TG-CAD-14'
    const anchor=data.anchors.find(a=>a.sourceHandle===handle)??data.anchors.find(a=>a.x===x&&a.z===z)
    return anchor?.id??'HOME-'+handle
  }
  for(const f of sites){
    const {x,z,width,depth,height,kind}=f
    // 补水管只有 CAD 文字点、没有设施体量：只保留标签，不生成建筑。
    if(kind==='pipe-note')continue
    const token={pick:'reliefPoint',pointId:landmarkPointId(f.handle,x,z),sourceHandle:f.handle}
    // Soft ground contact shading under every facility mass.
    if(kind!=='lake'&&kind!=='pool'&&kind!=='parking')
      add(new T.PlaneGeometry(width+2.4,depth+2.4).rotateX(-Math.PI/2).translate(x,.094,-z),softShadowMat)
    if(buildingFiles[f.handle]){
      // Detailed GLB replaces the massing box; the low plinth keeps it grounded.
      add(new T.BoxGeometry(width+.7,.05,depth+.7).translate(x,.055,-z),concrete)
      continue
    }
    function box(dx:number,dz:number,w:number,d:number,h:number,base:number,m:T.Material){
      add(new T.BoxGeometry(w,h,d).translate(x+dx,base+h/2,-z-dz),m)
    }
    if(kind==='lake'){
      // 岸线为表现层构造：源图仅有人工湖文字锚点，未见闭合岸线、水面填充或护岸线。
      // 湖体落在文字点东侧、码头皮带机与管廊之间的空地；首页标牌引线绑定可见湖岸，
      // 源 CAD 文字点仍用于追溯与详情。岸线形状与放大倍数为表现参数，不是实测水面范围。
      const lx=x+lakeDisplayOffset.x,lz=z+lakeDisplayOffset.z
      const LW=width*1.34,LD=depth*1.02
      const ring=(k:number):XY[]=>Array.from({length:72},(_,i)=>{
        const a=i/72*Math.PI*2
        const r=1+.118*Math.sin(3*a+.35)+.056*Math.sin(5*a+.9)+.024*Math.sin(9*a+1.1)+.015*Math.cos(13*a+2.3)
        return [lx+Math.cos(a)*LW*.5*k*r,lz+Math.sin(a)*LD*.5*k*r] as XY
      })
      add(prism(ring(1.45),.03,.008),lakeBank)
      add(prism(ring(1.26),.05,.012),shoreShadow)
      add(prism(ring(1.17),.10,.03),lakeside)
      add(prism(ring(1.10),.06,.085),coping)
      const edge=ring(1.04)
      for(let i=1;i<edge.length;i++)if(distance(edge[i-1],edge[i])>.02)add(strip(edge[i-1],edge[i],.20,.28,.09),shoreStone)
      interactive(prism(ring(.99),.045,.115),lakeWater,token)
      add(prism(ring(.80),.03,.121),shallow)
      add(prism(ring(.50),.028,.124),lakeDeep)
      // Ornamental island: scenic planting only, no shoreline or survey evidence.
      const ix=lx+LW*.08,iz=lz-LD*.10
      add(new T.CylinderGeometry(2.1,2.4,.14,.32).translate(ix,.15,-iz),shoreStone)
      add(new T.IcosahedronGeometry(1.75,1).scale(1,.28,.72).translate(ix,.24,-iz),lakeside)
      for(let k=0;k<7;k++){
        const a=k/7*Math.PI*2
        add(new T.IcosahedronGeometry(.32+(k%3)*.05,0).translate(ix+Math.cos(a)*1.05,.52,-(iz+Math.sin(a)*.65)),k%2?canopy:canopyLight)
      }
      for(let i=0;i<edge.length;i+=8)add(new T.ConeGeometry(.05,.2,5).translate(edge[i][0],.22,-edge[i][1]),reed)
    }else if(kind==='pool'){
      if(f.handle==='103415'||f.handle==='10340E'){
        // 两处同名“生态蓄水池”文字点：只保留来源记录与低矮自然水面，不表示两座已建水池。
        pond(x,z,width,depth,token)
      }else{
        basin(x,z,width,depth,.65)
        // 池体本身可拾取；水面与池壁随池体一起选中，不额外生成重复标牌面。
        const hitGeo=new T.BoxGeometry(width+.2,1.25,depth+.2).translate(x,.62,-z)
        interactive(hitGeo,poolPick,token)
      }
    }else if(kind==='parking'){
      interactive(new T.BoxGeometry(width,.08,depth).translate(x,.08,-z),road,token)
      for(let dx=-width/2+.25;dx<width/2;dx+=.67)for(const side of [-1,1])box(dx,side*depth*.30,.045,depth*.27,.012,.124,coping)
    }else if(f.handle==='F9BEE'){
      // 智慧中心：按原图 $pm单体 轮廓落位（文字点落在该轮廓内）；层数与高度为示意图。
      const foot=data.cadClosedContourCandidates.find(c=>c.handle===f.footprintHandle)?.outline
        ||[[x-width/2,z-depth/2],[x+width/2,z-depth/2],[x+width/2,z+depth/2],[x-width/2,z+depth/2]] as XY[]
      const H=height
      interactive(prism(foot,H,.06),wall,token)
      add(prism(inflate(foot,1.03),.12,H+.05),slate)
      // 退台上层、蓝色檐带与入口雨棚：立面构成示意，不改 CAD 基底。
      const fb=foot.map(p=>p[0]),fz=foot.map(p=>p[1])
      const fx=(Math.min(...fb)+Math.max(...fb))/2,fzc=(Math.min(...fz)+Math.max(...fz))/2
      const upper=foot.map(([px,pz])=>[fx+(px-fx)*.62,fzc+(pz-fzc)*.62] as XY)
      add(prism(upper,H*.34,H+.06),wall)
      add(prism(upper,.10,H*1.34+.06),slate)
      for(let lv=0;lv<2;lv++)for(let i=0;i<upper.length;i++){
        const ua=upper[i],ub=upper[(i+1)%upper.length],ulen=distance(ua,ub)
        if(ulen<.8)continue
        const lerp=(t:number):XY=>[ua[0]+(ub[0]-ua[0])*t,ua[1]+(ub[1]-ua[1])*t]
        const cells=Math.max(2,Math.floor(ulen/.5))
        for(let j=0;j<cells;j++)
          add(strip(lerp((j+.15)/cells),lerp((j+.85)/cells),.035,H*.10,H+.06+H*.34*(lv+.4)/2),glass)
      }
      for(let i=0;i<foot.length;i++){
        const a=foot[i],b=foot[(i+1)%foot.length]
        if(distance(a,b)<.9)continue
        add(strip(a,b,.06,.10,H*.985),roof)
      }
      const southZ=Math.min(...fz)
      add(new T.BoxGeometry(2.6,.10,.92).translate(fx,H*.28,-(southZ-.46)),coping)
      add(new T.BoxGeometry(.10,H*.28,.10).translate(fx-1.15,H*.14,-(southZ-.86)),steel)
      add(new T.BoxGeometry(.10,H*.28,.10).translate(fx+1.15,H*.14,-(southZ-.86)),steel)
      for(let i=0;i<foot.length;i++){
        const a=foot[i],b=foot[(i+1)%foot.length],len=distance(a,b)
        if(len<.8)continue
        const lerp=(t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
        const cells=Math.max(2,Math.floor(len/.52))
        for(let lv=0;lv<3;lv++)for(let j=0;j<cells;j++)
          add(strip(lerp((j+.14)/cells),lerp((j+.86)/cells),.04,H*.115,.06+H*(lv+.42)/3),glass)
        for(let lv=1;lv<3;lv++)add(strip(a,b,.075,.045,.06+H*lv/3),coping)
      }
      const bx=foot.map(p=>p[0]),bz=foot.map(p=>p[1])
      const cx=(Math.min(...bx)+Math.max(...bx))/2,cz=(Math.min(...bz)+Math.max(...bz))/2
      add(new T.BoxGeometry(1.5,H*.13,1.1).translate(cx,H*1.02,-cz),steel)
      add(new T.BoxGeometry(.06,H*.42,.06).translate(cx+1.7,H*1.2,-cz-.4),accent)
      add(new T.BoxGeometry(1.2,.06,1.0).translate(cx-3.2,H*.42,-cz),accent)
    }else{
      const isSG=sgHandles.has(f.handle)
      const poly=data.cadClosedContourCandidates.filter(c=>c.layer==='$pm单体' && contains(c.outline,x,z))
        .sort((a,b)=>Math.abs(T.ShapeUtils.area(a.outline.map(i=>new T.Vector2(...i))))-Math.abs(T.ShapeUtils.area(b.outline.map(i=>new T.Vector2(...i)))))[0]
      const footprint:XY[]=poly?.outline||[[x-width/2,z-depth/2],[x+width/2,z-depth/2],[x+width/2,z+depth/2],[x-width/2,z+depth/2]]
      interactive(prism(footprint,height,.06),isSG?sgWall:wall,token)
      add(prism(inflate(footprint,1.04),.12,height+.05),isSG?sgRoof:(kind==='office'?slate:roof))
      for(let i=0;i<footprint.length;i++){
        const a=footprint[i],b=footprint[(i+1)%footprint.length],len=distance(a,b)
        if(len<1)continue
        const floors=kind==='office'?3:1
        const lerp=(t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
        for(let level=0;level<floors;level++){
          const cells=Math.max(2,Math.floor(len/.64))
          for(let j=0;j<cells;j++)add(strip(lerp((j+.12)/cells),lerp((j+.86)/cells),.045,height/(floors*2.9),height*(level+.46)/floors),glass)
        }
      }
      if(kind==='treatment')for(let i=0;i<2;i++)add(new T.CylinderGeometry(.28,.28,.82,12).translate(x-width*.2+i*.63,height+.57,-z),steel)
    }
  }
  // 蓝色封闭皮带廊与黄色转运站已按业务要求移除：界面以管网流向为主，
  // 纵向廊道无 CAD 依据，横廊也会遮挡堆场与集水池。
  // ---------------------------------------------------------------- Blender assets
  // Ships, ship loaders, stacker-reclaimers and the enclosed belt gallery are authored
  // in modeling/harbor/create_port_assets.py. Placement follows CAD berth anchors and
  // yard band centres; the asset form itself is presentation geometry.
  const stockpileResources=new Set<T.Material|T.BufferGeometry>()
  const pileContact=new T.MeshBasicMaterial({color:'#0b0e11',transparent:true,opacity:.34,depthWrite:false})
  materials.push(pileContact)
  // 16 堆精细资产：Blender 按 CAD 平面生成多峰堆体，几何与顶点色随 GLB 载入；
  // 材质仍复用前端三套 PBR，保证颜色与贴图统一。
  async function loadStockpiles(){
    const gltf=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'tanggang/models/harbor/stockpiles-16.glb?v=15')
    if(disposed)return false
    const model=gltf.scene
    const shadows:T.Mesh[]=[]
    model.traverse(part=>{
      if(!(part instanceof T.Mesh))return
      const kind=String(part.userData.kind||'coal') as PileKind
      const anchorId=String(part.userData.anchorId||'')
      const handle=String(part.userData.handle||'')
      const base=pileMaterials[kind]||pileMaterials.coal
      // 每堆克隆材质并按锚点做确定性明度差，避免 16 堆像同一张贴图复制。
      let h=0
      for(const ch of anchorId)h=(h*31+ch.charCodeAt(0))>>>0
      const tinted=base.clone()
      tinted.color=base.color.clone().multiplyScalar(.72+.46*(h%100)/100)
      materials.push(tinted)
      part.material=tinted
      // Blender 导出的法线在共享顶点上不连续，远景会读成迷宫状亮暗斑；
      // 用索引几何重算平滑法线，保证坡面是一整块连续明暗。
      part.geometry.computeVertexNormals()
      part.castShadow=part.receiveShadow=true
      part.userData={pick:'reliefPoint',pointId:anchorId,sourceHandle:handle}
      stockpileResources.add(part.geometry)
      // 堆脚接触暗带：让堆体压住地面，而不是悬浮的黑条。
      const box=new T.Box3().setFromObject(part)
      const size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3())
      const shadowGeo=new T.PlaneGeometry(size.x*1.18,size.z*1.03)
        .rotateX(-Math.PI/2).translate(center.x,.035,center.z)
      const shadowMesh=new T.Mesh(shadowGeo,pileContact)
      shadowMesh.renderOrder=1
      shadows.push(shadowMesh)
      stockpileResources.add(shadowGeo)
      picks.push(part)
    })
    // 放在 traverse 之后加入，避免接触暗带被当成堆体再次处理。
    for(const shadowMesh of shadows)model.add(shadowMesh)
    group.add(model)
    // 隐藏程序化长条，避免与精细堆体叠在一起。
    for(const mesh of proceduralPiles){
      mesh.visible=false
      const index=picks.indexOf(mesh)
      if(index>=0)picks.splice(index,1)
    }
    return true
  }
  const portResources=new Set<T.Material|T.BufferGeometry>()
  const portInstances:T.Object3D[]=[]
  function registerPort(root:T.Object3D){
    root.traverse(o=>{
      if(!(o instanceof T.Mesh))return
      portResources.add(o.geometry)
      for(const m of Array.isArray(o.material)?o.material:[o.material])portResources.add(m)
      o.castShadow=true;o.receiveShadow=true;assignGray(o)
    })
  }
  function placeAsset(tpl:T.Object3D,pos:T.Vector3,rotY:number,scale:number,name:string){
    const obj=tpl.clone(true)
    obj.position.copy(pos);obj.rotation.y=rotY;obj.scale.setScalar(scale);obj.name=name
    registerPort(obj);group.add(obj);portInstances.push(obj);return obj
  }
  async function loadPortAssets(){
    if(!quayInfo)return false
    const base=import.meta.env.BASE_URL+'tanggang/models/harbor/'
    const loader=new GLTFLoader()
    const load=(file:string)=>loader.loadAsync(base+file).catch(()=>null)
    // 各资产独立返回：单个 GLB 失败只降级该资产，不连带移除其余已成功模型。
    const [shipTpl,loaderTpl,stackTpl,galleryTpl]=await Promise.all([
      load('bulk-carrier.glb'),load('ship-loader.glb'),
      load('stacker-reclaimer.glb'),load('belt-gallery.glb')
    ])
    if(disposed)return false
    // Presentation tint: dark maroon hull, charcoal-brown hatch covers, light deck.
    const tint:Record<string,string>={'deck-grey':'#9a978d','hatch-blue':'#493224','hull-navy':'#5c2b22'}
    shipTpl?.scene.traverse(o=>{
      if(!(o instanceof T.Mesh))return
      for(const m of Array.isArray(o.material)?o.material:[o.material])
        if(m instanceof T.MeshStandardMaterial && tint[m.name])m.color.set(tint[m.name])
    })
    const q=quayInfo, theta=Math.atan2(q.dz,q.dx)
    // 船尾尾迹：柔边椭圆贴片，贴着水面随泊位朝向旋转；只做近景暗示，不参与拾取。
    const wakeCanvas=document.createElement('canvas');wakeCanvas.width=256;wakeCanvas.height=128
    const wc=wakeCanvas.getContext('2d')
    if(wc){
      const g=wc.createRadialGradient(128,64,4,128,64,124)
      g.addColorStop(0,'rgba(234,242,242,.55)');g.addColorStop(.45,'rgba(226,238,239,.24)')
      g.addColorStop(1,'rgba(222,236,237,0)')
      wc.fillStyle=g;wc.save();wc.translate(128,64);wc.scale(1,.40)
      wc.beginPath();wc.arc(0,0,124,0,Math.PI*2);wc.fill();wc.restore()
    }
    const wakeTex=new T.CanvasTexture(wakeCanvas);wakeTex.colorSpace=T.SRGBColorSpace
    const wakeMat=new T.MeshBasicMaterial({map:wakeTex,transparent:true,depthWrite:false,opacity:.5})
    // 船体接触水面的暗带与湿痕：略大于船体的深色贴片，压在船底。
    const hullShadowMat=new T.MeshBasicMaterial({color:'#0a2c33',transparent:true,depthWrite:false,opacity:.42})
    materials.push(wakeMat)
    const berths=data.anchors.filter(p=>p.modelType==='berth_anchor')
    berths.forEach((berth,berthIndex)=>{
      if(!shipTpl)return
      const t=(berth.x-q.a[0])*q.dx+(berth.z-q.a[1])*q.dz
      // 52# 泊位在 1672 画幅下船首被右边界裁切：仅调整展示船长与沿码头位移，
      // CAD 泊位文字点保留，展示船和装船机共同沿岸平移。
      const east=berth.id==='TG-CAD-20'
      const shipLength=east?22:Math.min(27,Math.max(22,q.len*.30))
      const displayShift=east?7.5:0
      const cx=q.a[0]+q.dx*t+q.nx*3.6-q.dx*displayShift
      const cz=q.a[1]+q.dz*t+q.nz*3.6-q.dz*displayShift
      // 相邻泊位镜像靠泊：船首朝外、船尾相对，参考图即为此关系。
      const shipRot=theta+(berthIndex%2?Math.PI:0)
      const ship=placeAsset(shipTpl.scene,new T.Vector3(cx,.04,-cz),shipRot,shipLength/20,'散货船 · 泊位表现模型')
      // 船尾轻微尾迹，贴在船体后方的水面上。
      const aftX=cx-Math.cos(shipRot)*shipLength*.62
      const aftZ=-cz+Math.sin(shipRot)*shipLength*.62
      const wakeGeo=new T.PlaneGeometry(shipLength*.95,5.2).rotateX(-Math.PI/2).rotateY(shipRot)
        .translate(aftX,.075,aftZ)
      const wake=new T.Mesh(wakeGeo,wakeMat)
      wake.name='船尾尾迹'
      wake.renderOrder=2
      group.add(wake);portResources.add(wakeGeo)
      const hullGeo=new T.PlaneGeometry(shipLength*.92,4.6).rotateX(-Math.PI/2).rotateY(shipRot)
        .translate(cx,.065,-cz)
      const hull=new T.Mesh(hullGeo,hullShadowMat)
      hull.name='船体接触暗带';hull.renderOrder=1
      group.add(hull);portResources.add(hullGeo)
      // Fixed berth draft; vessel identity and berth status are not simulated.
      ship.userData.bobBase=.04
      // 船体在首页代表泊位，只打开所属泊位详情。
      ship.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        o.userData={...o.userData,pick:'reliefPoint',pointId:berth.id,sourceHandle:berth.sourceHandle}
        picks.push(o)
      })
      const lx=q.a[0]+q.dx*(t-displayShift)+q.nx*1.0, lz=q.a[1]+q.dz*(t-displayShift)+q.nz*1.0
      // The GLB boom points +Z; add PI so it reaches over the vessel.
      if(loaderTpl)placeAsset(loaderTpl.scene,new T.Vector3(lx,.06,-lz),theta,1.35,'装船机 · 表现模型')
    })
    if(stackTpl)for(const columns of columnsByBand.values()){
      const band=yardBandsById.get(columns[0].bandId)
      if(!band)continue
      const bz=band.displayXZ.map(p=>p[1])
      const cz=(Math.min(...bz)+Math.max(...bz))/2
      // 每列一台门式堆取料机，跨南北两堆；支腿落在带内通道，桥架高于堆顶。
      for(const c of columns)
        placeAsset(stackTpl.scene,new T.Vector3(c.x,.02,-cz),0,1,
          '堆取料机 · 表现模型')
    }
    return !disposed
  }
  // Detailed buildings are placed at their CAD text anchors (智慧中心 uses its
  // matched footprint centre). Scale 1 because each GLB is authored at display size.
  async function loadBuildings(){
    const base=import.meta.env.BASE_URL+'tanggang/models/harbor/'
    const loader=new GLTFLoader()
    const entries=Object.entries(buildingFiles)
    const models=await Promise.all(entries.map(([,file])=>loader.loadAsync(base+file)))
    if(disposed)return false
    entries.forEach(([handle],i)=>{
      const f=sites.find(s=>s.handle===handle)
      if(!f)return
      let px=f.x,pz=f.z
      if(handle==='F9BEE'){
        const c=data.cadClosedContourCandidates.find(c=>c.handle==='2AA962')?.outline
        if(c&&c.length){
          px=(Math.min(...c.map(p=>p[0]))+Math.max(...c.map(p=>p[0])))/2
          pz=(Math.min(...c.map(p=>p[1]))+Math.max(...c.map(p=>p[1])))/2
        }
      }
      const token={pick:'reliefPoint',pointId:landmarkPointId(handle,f.x,f.z),sourceHandle:handle}
      const obj=models[i].scene
      obj.position.set(px,.10,-pz)
      tuneBuildingMaterials(obj)
      obj.name='精细建筑 · '+handle
      obj.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        portResources.add(o.geometry)
        for(const m of Array.isArray(o.material)?o.material:[o.material])portResources.add(m)
        o.castShadow=true;o.receiveShadow=true;o.userData=token
        picks.push(o);assignGray(o)
      })
      group.add(obj)
      // 精细模型加一圈浅色檐口，远景可读出屋檐与体量分层；不改模型本体与拾取映射。
      const box=new T.Box3().setFromObject(obj)
      const size=new T.Vector3();box.getSize(size)
      const centre=new T.Vector3();box.getCenter(centre)
      if(size.x>1.4&&size.z>1.4){
        for(const sx of [-1,1])
          addNow(new T.BoxGeometry(.15,.14,size.z+.30).translate(centre.x+sx*(size.x/2+.07),box.max.y-.03,centre.z),coping)
        for(const sz of [-1,1])
          addNow(new T.BoxGeometry(size.x+.30,.14,.15).translate(centre.x,box.max.y-.03,centre.z+sz*(size.z/2+.07)),coping)
      }
      // 智慧中心采用 GLB 自身的建筑高度，避免二次堆叠上层遮挡后方水务设施。
      if(handle==='F9BFB'&&size.x>2){
        // 维修车间：屋面采光带 + 屋脊，区分于生活污水设施。
        const alongX=size.x>size.z
        for(let k=0;k<4;k++){
          const t=(k+.5)/4-.5
          addNow(new T.BoxGeometry(alongX?size.x*.72:.55,.05,alongX?.55:size.z*.72)
            .translate(centre.x+(alongX?0:t*size.x),box.max.y+.03,centre.z+(alongX?t*size.z:0)),glazing)
        }
        addNow(new T.BoxGeometry(alongX?size.x*.94:.18,.12,alongX?.18:size.z*.94)
          .translate(centre.x,box.max.y+.08,centre.z),coping)
      }
      if(handle==='139AAA'&&size.x>1.6){
        // 一体化生活污水处理设施：蓝色屋面与检修机组。
        addNow(new T.BoxGeometry(size.x*.96,.07,size.z*.96).translate(centre.x,box.max.y+.02,centre.z),roof)
        addNow(new T.BoxGeometry(.8,.22,.6).translate(centre.x+size.x*.2,box.max.y+.14,centre.z),steel)
      }
    })
    return !disposed
  }
  // Process buildings authored inside the two verified text contours. The CAD review
  // only proves the label falls inside each outline; the building form is presentation.
  async function loadProcessBuildings(){
    const base=import.meta.env.BASE_URL+'tanggang/models/harbor/'
    const loader=new GLTFLoader()
    const defs:[string,number,number,number,string,string,string][]=[
      ['pumphouse.glb',-0.55,40.55,0,'除尘泵房 · 轮廓内表现建筑','TG-CAD-12','217737'],
      ['treatmenthouse.glb',-18.05,40.6,Math.PI/2,'污水处理场 · 轮廓内表现建筑','TG-CAD-11','2E23D7']
    ]
    const models=await Promise.all(defs.map(d=>loader.loadAsync(base+d[0])))
    if(disposed)return false
    models.forEach((m,i)=>{
      const [,x,z,rot,label,pointId,sourceHandle]=defs[i]
      add(new T.PlaneGeometry(7.4,6.2).rotateX(-Math.PI/2).translate(x,.094,-z),softShadowMat)
      const obj=m.scene
      obj.position.set(x,.10,-z)
      obj.rotation.y=rot
      tuneBuildingMaterials(obj)
      obj.name=label
      obj.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        portResources.add(o.geometry)
        for(const mm of Array.isArray(o.material)?o.material:[o.material])portResources.add(mm)
        o.castShadow=true;o.receiveShadow=true
        o.userData={pick:'reliefPoint',pointId,sourceHandle};picks.push(o)
        assignGray(o)
      })
      group.add(obj)
      // 精修 GLB 已包含基座、檐口、门廊与屋面设备；不再叠加程序化外壳，避免重墙与闪烁。
    })
    return !disposed
  }
  // 洗车台样件：modeling/harbor/build_wash_station.py → wash-station-l1.glb。
  // 位置沿用 CAD 文字点 TG-CAD-13 / FAE1D；模型平面包络约 8.6×12.4 显示单位。
  async function loadWashStation(){
    const gltf=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'tanggang/models/harbor/wash-station-l1.glb')
    if(disposed)return false
    const obj=gltf.scene
    obj.position.set(-45.483,.005,6.265)
    obj.name='洗车台区 · TG-CAD-13'
    obj.traverse(o=>{
      if(!(o instanceof T.Mesh))return
      portResources.add(o.geometry)
      for(const m of Array.isArray(o.material)?o.material:[o.material])portResources.add(m)
      o.castShadow=true;o.receiveShadow=true
      o.userData={pick:'reliefPoint',pointId:'TG-CAD-13',sourceHandle:'FAE1D'}
      picks.push(o);assignGray(o)
    })
    group.add(obj)
    portInstances.push(obj)
    return true
  }
  // 出场动画：沿棚下→西侧出口坡道→南向道路的低速折线，循环淡出淡入。
  const exitPath=new T.CatmullRomCurve3([
    new T.Vector3(-45.90,.108,6.50),
    new T.Vector3(-46.80,.108,7.10),
    new T.Vector3(-47.70,.108,8.30),
    new T.Vector3(-48.30,.108,10.40),
    new T.Vector3(-48.40,.108,13.10),
    new T.Vector3(-48.30,.108,15.90),
  ],false,'catmullrom',.5)
  let exitTruck:T.Object3D|null=null
  const exitMats:T.Material[]=[]
  let truckClock=0,truckLast=0
  // 洗车台出场运煤卡车：modeling/harbor/create_trucks.py → coal-truck.glb。
  // 位置按洗车台棚下与出口道路排布，朝向沿出场方向；仅表现层，不参与拾取。
  async function loadTrucks(){
    const gltf=await new GLTFLoader().loadAsync(
      import.meta.env.BASE_URL+'tanggang/models/harbor/coal-truck.glb')
    if(disposed)return false
    const tint:Record<string,[string,number,number]> = {
      'truck-blue':['#2f6f8a',.5,.2],
      'truck-white':['#d4d8d2',.62,.02],
      'glass':['#33525f',.12,.18],
      'metal':['#767d7d',.52,.32],
      'dark':['#2b3033',.66,.2],
      'coal':['#4a4a46',.95,0],
      'orange':['#d2762f',.5,.2],
      'rubber':['#232628',.95,0],
    }
    const places:[[number,number],number,number][]=[
      [[-48.60,5.95],0,1.1],
      [[-44.10,6.80],.18,1.1],
      [[-45.90,6.50],0,1.1],
    ]
    for(let pi=0;pi<places.length;pi++){
      const [[x,z],rot,s]=places[pi]
      const obj=gltf.scene.clone(true)
      obj.position.set(x,.108,z)
      obj.rotation.y=rot
      obj.scale.setScalar(s)
      obj.name=pi===2?'运煤卡车 · 出场动画':'运煤卡车 · 洗车台'
      const animated=pi===2
      obj.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        portResources.add(o.geometry)
        // 运动车辆不写静态阴影贴图，避免留下冻结的影子。
        o.castShadow=!animated;o.receiveShadow=true
        for(const m of Array.isArray(o.material)?o.material:[o.material]){
          let std=m as T.MeshStandardMaterial
          if(animated){
            std=std.clone()
            std.transparent=true
            exitMats.push(std)
            portResources.add(std)
          }else{
            portResources.add(m)
          }
          if(!std.isMeshStandardMaterial)continue
          const t=tint[(std.name||'').toLowerCase()]
          if(t){std.color.set(t[0]);std.roughness=t[1];std.metalness=t[2];std.envMapIntensity=.5}
        }
        assignGray(o)
      })
      group.add(obj)
      portInstances.push(obj)
      if(animated)exitTruck=obj
    }
    return true
  }
  // Detailed trees from modeling/harbor/create_trees.py. Only sites near the working
  // area use them; each GLB is baked to vertex colours and drawn as one InstancedMesh
  // per species, so the extra crown detail costs three draw calls.
  const treeResources=new Set<T.Material|T.BufferGeometry>()
  const treeBatches:T.InstancedMesh[]=[]
  async function loadTrees(){
    const detailed=treeSites.filter(t=>t.detail)
    if(!detailed.length)return false
    const base=import.meta.env.BASE_URL+'tanggang/models/harbor/'
    const loader=new GLTFLoader()
    const tpls=await Promise.all(['tree-broad.glb','tree-narrow.glb','tree-shrub.glb',
      'tree-tall.glb','tree-oval.glb']
      .map(f=>loader.loadAsync(base+f)))
    if(disposed)return false
    function bake(src:T.Object3D){
      const bark:T.BufferGeometry[]=[],leaf:T.BufferGeometry[]=[]
      const flat=(g:T.BufferGeometry)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();return n}
      src.updateMatrixWorld(true)
      src.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        const g=o.geometry.clone()
        g.applyMatrix4(o.matrixWorld)
        const material=(Array.isArray(o.material)?o.material[0]:o.material) as T.Material
        const name=(material?.name||'').toLowerCase()
        if(name.includes('bark')||name.includes('trunk')){
          bark.push(flat(g))
        }else{
          // 交叉面片法线统一朝上，避免同一株树一面亮一面黑。
          const n=g.attributes.normal
          if(n){for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);n.needsUpdate=true}
          leaf.push(flat(g))
        }
      })
      const merge=(list:T.BufferGeometry[])=>{
        if(!list.length)return null
        const merged=mergeGeometries(list)
        list.forEach(g=>g.dispose())
        if(merged)treeResources.add(merged)
        return merged
      }
      return {bark:merge(bark),leaf:merge(leaf)}
    }
    const geos=tpls.map(t=>bake(t.scene))
    // 叶片用带 alphaTest 的树冠图集；树皮用 CC0 PBR 贴图。
    const leafMap=mineralMap('tree-leaves.png',true)
    const barkMap=mineralMap('pbr/bark/color.jpg',true)
    const barkNormal=mineralMap('pbr/bark/normal.jpg')
    const barkRough=mineralMap('pbr/bark/rough.jpg')
    const leafMat=new T.MeshStandardMaterial({map:leafMap,alphaTest:.42,side:T.DoubleSide,roughness:.9,metalness:0})
    // 叶片贴图本身偏鲜绿，整体压一档明度与饱和，接近设计图的橄榄绿。
    leafMat.color.set('#c6cdbd')
    const barkMat=new T.MeshStandardMaterial({map:barkMap,normalMap:barkNormal,roughnessMap:barkRough,roughness:.95,metalness:0})
    treeResources.add(leafMat);treeResources.add(barkMat)
    const buckets:{i:number;s:number;rot:number}[][]=[[],[],[],[],[]]
    const scaleOf=[1.15,1.15,1.15,.95,1.0]
    detailed.forEach((t,i)=>{
      // 五种树形按 tone 轮转：阔叶、行道、灌木、高杆、椭圆冠；高杆树略微压低，
      // 避免在远景里比建筑和装船机更抢眼。
      const v=[0,1,2,3,4,1][t.tone]
      buckets[v].push({i,s:t.h*scaleOf[v],rot:(i*2.399)%(Math.PI*2)})
    })
    const tint=[new T.Color(.92,.98,.88),new T.Color(.98,1,.94),
      new T.Color(.95,1,.90),new T.Color(1,.99,.90)]
    const host=new T.Object3D()
    buckets.forEach((list,v)=>{
      const geo=geos[v]
      if(!geo||!list.length)return
      const fill=(mesh:T.InstancedMesh,color:boolean)=>{
        list.forEach(({i,s,rot},k)=>{
          const t=detailed[i]
          host.position.set(t.x,.02,-t.z)
          host.rotation.set(0,rot,0)
          host.scale.set(s,s,s)
          host.updateMatrix()
          mesh.setMatrixAt(k,host.matrix)
          if(color)mesh.setColorAt(k,tint[t.tone%tint.length])
        })
        mesh.instanceMatrix.needsUpdate=true
        if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true
        mesh.castShadow=mesh.receiveShadow=true
        mesh.computeBoundingSphere()
        treeBatches.push(mesh);group.add(mesh);assignGray(mesh)
      }
      if(geo.leaf){
        const mesh=new T.InstancedMesh(geo.leaf,leafMat,list.length)
        mesh.name=['精细阔叶树','精细行道树','精细灌木','精细高杆树','精细椭圆冠'][v]
        fill(mesh,true)
      }
      if(geo.bark){
        const mesh=new T.InstancedMesh(geo.bark,barkMat,list.length)
        mesh.name=['阔叶树干','行道树干','灌木枝'][v]
        fill(mesh,false)
      }
    })
    return !disposed
  }
  // Batch static primitives by material. Keep only interactive source features as individual meshes.
  buildRoads()
  // 码头前沿：护舷与系缆桩，补设计图的岸线细节。
  const buildDockEdge=()=>{
    const fender=palette('#2b3033',.8,.08), bollard=palette('#79848a',.55,.35)
    for(let x=-45;x<=41;x+=8.5){
      add(new T.BoxGeometry(.95,1.15,.5).translate(x,.52,-50.55),fender)
      add(new T.CylinderGeometry(.22,.26,.9,10).translate(x+4.2,.4,-50.05),bollard)
    }
  }
  buildDockEdge()
  const waterMeshes:T.Mesh[]=[]
  for(const [m,list] of batches){
    const normalized=list.map(g=>{
      const n=g.index?g.toNonIndexed():g
      if(n!==g)g.dispose()
      return n
    })
    const geometry=mergeGeometries(normalized)
    normalized.forEach(g=>g.dispose())
    if(!geometry)continue
    const mesh=new T.Mesh(geometry,m)
    mesh.castShadow=true;mesh.receiveShadow=true
    group.add(mesh);geometries.push(geometry)
    if(m===sea)waterMeshes.push(mesh)
  }
  group.traverse(o=>{if(o instanceof T.Mesh)assignGray(o)})
  function setGray(gray:boolean){if(gray===isGray)return;isGray=gray;for(const [mesh,original] of originals)mesh.material=gray?clay:original}
  // Scene animation: water ripple drift only. Berthed vessels keep a fixed draft —
  // vertical bobbing made the hull shimmer on a static default view.
  function update(t:number){
    sea.uniforms.uTime.value=t
    lakeRipple.offset.set((t*.012)%1,(t*.031)%1)
    for(const obj of portInstances){
      if(obj.userData.bobBase===undefined)continue
      obj.position.y=obj.userData.bobBase
    }
    // 出场卡车：11 秒低速驶出 → 1.5 秒停靠 → 1 秒淡出 → 1.5 秒隐藏 →
    // 回到棚下淡入，循环衔接不跳变。
    if(exitTruck){
      if(!truckLast)truckLast=t
      const dt=Math.min(.2,Math.max(0,t-truckLast));truckLast=t
      truckClock=(truckClock+dt)%16
      const c=truckClock
      const p=c>=15?0:Math.min(1,c/11)
      const at=exitPath.getPointAt(p)
      exitTruck.position.set(at.x,.108,at.z)
      const tan=exitPath.getTangentAt(p)
      exitTruck.rotation.y=Math.atan2(-tan.z,tan.x)
      let op=1
      if(c>=12.5&&c<13.5)op=1-(c-12.5)
      else if(c>=13.5&&c<15)op=0
      else if(c>=15)op=c-15
      exitTruck.visible=op>.02
      for(const m of exitMats)(m as T.MeshStandardMaterial).opacity=op
    }
  }
  function dispose(){
    disposed=true
    textures.forEach(t=>t.dispose());stockpileResources.forEach(r=>r.dispose())
    treeBatches.forEach(i=>i.dispose());treeResources.forEach(r=>r.dispose())
    portInstances.length=0;portResources.forEach(r=>r.dispose())
    originals.clear()
    group.removeFromParent()
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())
  }
  return {group,picks,dispose,setGray,loadStockpiles,loadPortAssets,loadBuildings,loadTrees,loadProcessBuildings,loadWashStation,loadTrucks,update,
    seaMaterial:sea,waterMeshes,waterLevel:.055,
    // 验收复算用：生成树心的最终坐标与可绘制道路中心折线（非 CAD 资产 ID）。
    treeSites,roadSegments,roadHalfWidth:ROAD_HALF_WIDTH}
}
