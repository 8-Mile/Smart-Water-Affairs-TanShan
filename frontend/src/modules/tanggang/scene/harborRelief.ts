import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { landmarks, landmarksSource } from './harborLandmarks'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type XY = [number, number]
type Path = { displayPoints: XY[]; layer: string; handle: string }
type Band = { id: string; displayXZ: XY[] }
type SceneData = { sourceDWGSHA256:string; anchors: { x:number; z:number; id:string; modelType:string }[]; lines: Path[]; extentXZ: number[]; yardBands: Band[];
  cadClosedContourCandidates: { handle: string; outline: XY[]; layer: string; volumeHeightDisplayOnly: number }[]
  matchedFacilityContours: { handle: string; labels: string[] }[] }
type Spatial = { yardSideCandidates: { id: string; label?: string; bandId: string; sceneXZ: XY; sourceTextHandle: string }[]
  poolContourCandidates: { id: string; displayXZ: XY[]; sourceGeometryHandles: string[] }[] }

// Relief dimensions are graphic conventions. All plan coordinates stay in displayXZ.
function prism(path: XY[], height: number, y: number) {
  const shape = new T.Shape(path.map(([x,z]) => new T.Vector2(x,z)))
  const geometry = new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:1})
  return geometry.rotateX(-Math.PI/2).translate(0,y,0)
}
const distance = (a: XY,b: XY) => Math.hypot(a[0]-b[0],a[1]-b[1])
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
// Levelled coal stockpile: flat crest, straight trapezoidal flanks and square ends.
// This reads like a dozer-levelled yard pile instead of a dune. Dimensions are graphic.
function stockpile(width:number,length:number,height:number,seed:number) {
  const vertices:number[]=[],colors:number[]=[],uv:number[]=[],indices:number[]=[]
  const rows=110,cols=26
  const rand=(v:number)=>{const n=Math.sin(v*127.1+seed*311.7)*43758.5453;return n-Math.floor(n)}
  const smooth=(x:number)=>{const t=Math.min(1,Math.max(0,x));return t*t*(3-2*t)}
  const base=new T.Color(['#3b414b','#3f3e3f','#383e47','#42403f'][seed%4])
  const flat=.34
  for(let j=0;j<=rows;j++){
    const t=j/rows,zc=(t-.5)*length
    // Square ends: the crest stays level until the last ~3% of the run, so the end
    // reads as a dozer-cut face instead of a rounded dune toe.
    const endF=smooth(Math.min(t,1-t)/.032)
    for(let i=0;i<=cols;i++){
      const u=i/cols*2-1,k=j*(cols+1)+i
      const d=Math.abs(u)
      // Levelled ridge: wide flat crest, a crisper shoulder break, then a straight
      // flank down to the pad. raw is the trapezoidal cross-section.
      const raw=d<=flat?1:Math.max(0,1-(d-flat)/(1-flat))
      const face=raw*raw*(3-2*raw)
      const crestNoise=1+.006*Math.sin(t*11+seed)+.004*(rand(k)-.5)
      const faceNoise=.02*Math.sin(t*37+u*9+seed)*face*(1-face)*4
      const x=u*width/2*(1+.012*Math.sin(t*9+seed))
      const y=.02+height*endF*face*crestNoise+faceNoise
      vertices.push(x,Math.max(.02,y),zc)
      uv.push(x*.95*.40,zc*.40)
      // Faint dozer push lines; slopes and square ends read darker than the crest.
      const endShade=.74+.26*Math.min(1,Math.min(t,1-t)/.05)
      // Coal reads darker on the sun-lit crest and slightly lighter on the shaded
      // flanks, as in the reference render where the pile tops stay near-black.
      const channel=(.93+.06*rand(k)+.032*Math.sin(t*17+seed)+.028*Math.sin(u*9+t*5))*(.80+.20*(1-face))*endShade
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
  const wall=palette('#eef2ef',.62,.04), roof=palette('#1e6783',.5,.18), steel=palette('#677e86',.5,.42)
  const accent=palette('#cf7628',.52,.3), pool=palette('#2c8fa9',.16,.18), coping=palette('#dbe6e1',.7,.05)
  pool.emissive=new T.Color('#124a5c');pool.emissiveIntensity=.5
  const poolRim=palette('#e9f2ef',.55,.06), poolInner=palette('#35606a',.86,.05)
  const sea=palette('#0a587f',.16,.44), glint=palette('#dcf4f2',.3)
  const hull=palette('#1d2c37',.45,.3), red=palette('#9b5a46',.6,.1), hatch=palette('#456a7a',.45,.3)
  const canopy=palette('#33603b',.97,0), canopyLight=palette('#527a45',.97,0)
  const concrete=palette('#b9bdb4',.95,0), coalPad=palette('#474f4d',.95,0)
  const orangeMetal=palette('#d2762f',.5,.38), silver=palette('#c3ced2',.3,.78)
  const clarifier=palette('#9fb0b3',.46,.42), fence=palette('#3f93c8',.55,.25)
  const grass=palette('#4a8431',.99,0), grassAlt=palette('#3f742a',.99,0), grassDry=palette('#55863a',.99,0)
  const galleryBody=palette('#b7c2c7',.62,.14)
  const forestFloor=palette('#22361d',.99,0)
  const ore=palette('#ffffff',.99,.01);ore.vertexColors=true
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
  ore.normalMap=mineralMap('ore-normal.jpg');ore.normalScale.set(.5,.5)
  const seaRipple=waterRipples();sea.bumpMap=seaRipple;sea.bumpScale=.17
  const lakeRipple=waterRipples();lakeRipple.repeat.set(2,2)
  const batches=new Map<T.Material,T.BufferGeometry[]>()
  function add(g:T.BufferGeometry,m:T.Material){
    const batch=batches.get(m)||[];batch.push(g);batches.set(m,batch)
  }
  function interactive(g:T.BufferGeometry,m:T.Material,source:Record<string,string>){
    const mesh=new T.Mesh(g,m);mesh.userData=source;mesh.castShadow=true;mesh.receiveShadow=true
    group.add(mesh);picks.push(mesh);geometries.push(g);return mesh
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
  for(const b of data.yardBands)add(prism(b.displayXZ,.10,.008),coalPad)
  // Each yard number carries an A-side and a B-side CAD text anchor. They mark the
  // north and south ends of the same stockpile, so they are paired into one long pile.
  const pileGroups=new Map<string,{xs:number[];zs:number[];bandId:string;id:string;handle:string}>()
  for(const yard of spatial.yardSideCandidates){
    const key=(yard.label||yard.id).replace(/^[AB]侧\s*/,'')||yard.id
    const g=pileGroups.get(key)||{xs:[],zs:[],bandId:yard.bandId,id:yard.id,handle:yard.sourceTextHandle}
    g.xs.push(yard.sceneXZ[0]);g.zs.push(yard.sceneXZ[1])
    pileGroups.set(key,g)
  }
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
  const pileWByBand=new Map<string,number>()
  for(const [id,g] of pileGroups){
    const band=data.yardBands.find(b=>b.id===g.bandId)
    if(!band)continue
    const peers=[...pileGroups.values()].filter(v=>v.bandId===g.bandId).length
    const bandW=distance(band.displayXZ[0],band.displayXZ[1])
    const width=Math.min(5.55,bandW/Math.max(1,peers)-.55)
    if(width<1.4)continue
    const x=g.xs.reduce((a,b)=>a+b,0)/g.xs.length
    // Run length is presentation geometry: the A/B text anchors sit near the ends.
    const z0=Math.min(...g.zs)-18,z1=Math.max(...g.zs)+11.5
    const length=z1-z0,cz=(z0+z1)/2
    const h=2.9+.11*(Number(id.replace(/\D/g,''))%3)
    const geo=stockpile(width,length,h,Number(id.replace(/\D/g,''))||1)
    geo.translate(x,.112,-cz)
    interactive(geo,ore,{pick:'reliefPoint',pointId:id,sourceHandle:g.handle})
    // Soft contact shadow keeps the pile visually planted on the pad.
    const sh=new T.PlaneGeometry(width+2.6,length+2.6).rotateX(-Math.PI/2).translate(x,.1115,-cz)
    add(sh,shadowMat)
    pileWByBand.set(g.bandId,width)
  }
  for(const l of data.lines){
    const path=l.displayPoints
    if(path.length<2)continue
    if(l.layer.includes('道路中心线')){
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],len=distance(a,b)
        if(len<.3)continue
        add(strip(a,b,1.28,.055,.018),road)
        // Crisp white kerb lines define the carriageway as in the reference render.
        const nx=-(b[1]-a[1])/len,nz=(b[0]-a[0])/len
        for(const s of [-.5,.5])
          add(strip([a[0]+nx*s,a[1]+nz*s],[b[0]+nx*s,b[1]+nz*s],.045,.010,.077),stripe)
        const lerp=(f:number):XY=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]
        for(let d=.5;d+.72<len;d+=2.7)add(strip(lerp(d/len),lerp((d+.72)/len),.055,.012,.076),stripe)
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
    // Deeper tone further offshore so the quay reads against a dark water plane.
    const seaDeep=palette('#07405f',.18,.40)
    add(prism([coastline(-140,20),coastline(len+140,20),coastline(len+140,142),coastline(-140,142)],.006,.056),seaDeep)
    // Shallow turquoise shelf and broken surf lines. Graphic water finish, not bathymetry.
    const shallowSea=palette('#2a7f99',.24,.24)
    add(prism([coastline(-140,0),coastline(len+140,0),coastline(len+140,3.4),coastline(-140,3.4)],.012,.058),shallowSea)
    const seaEdge=palette('#06344d',.4,.2)
    add(strip(offset(a,.62),offset(b,.62),.30,.010,.069),seaEdge)
    const foam=palette('#eafbfb',.6,0);foam.transparent=true;foam.opacity=.62;foam.depthWrite=false
    const foamLines:[number,number][]=[[1.05,.20],[2.3,.12],[3.5,.08]]
    for(const [n,w] of foamLines)
      add(strip(offset(a,n),offset(b,n),w,.012,.072),foam)
    for(let i=0;i<120;i++){
      const t=((i*61)%97+.4)/99,n=1.1+(i*29%52)*.055
      const p=offset([a[0]+dx*t*len,a[1]+dz*t*len],n)
      add(strip(p,[p[0]+dx*(.20+(i%5)*.11),p[1]+dz*(.20+(i%5)*.11)],.04,.008,.074),foam)
    }
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
    // Moored bulk carriers are supplied by the Blender asset loader (see loadPortAssets).
    // Only the water glints below are built here.
    add(strip([a[0]+nx*1.2,a[1]+nz*1.2],[b[0]+nx*1.2,b[1]+nz*1.2],.5,.03,.06),coping)
    for(let i=0;i<155;i++){
      const t=((i*47)%97+.3)/99,p=offset([a[0]+dx*t*len,a[1]+dz*t*len],.6+(i*17%115)*.1)
      add(strip(p,[p[0]+dx*(.3+(i%7)*.18),p[1]+dz*(.3+(i%7)*.18)],.034,.009,.062),glint)
    }
    // Broad offshore ripple streaks give the water plane readable scale.
    const waveStreak=palette('#54b7cd',.5,.10)
    waveStreak.transparent=true;waveStreak.opacity=.30;waveStreak.depthWrite=false
    for(let i=0;i<80;i++){
      const t=((i*83)%101+.5)/102,n=8+(i*31%420)*.11
      const p=offset([a[0]+dx*t*len,a[1]+dz*t*len],n)
      const l=.8+(i%6)*.6
      add(strip(p,[p[0]+dx*l,p[1]+dz*l],.05+.02*(i%3),.006,.071),waveStreak)
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
  for(const c of data.cadClosedContourCandidates){
    if(c.layer==='水池'||c.outline.length<4)continue
    if(landmarkFootprints.has(c.handle))continue
    const match=data.matchedFacilityContours.find(f=>f.handle===c.handle)
    // Use the original polygon for named structures when it contains their CAD text.
    // Its attribution remains a candidate; no duplicate placeholder is drawn on top.
    if(!match && sites.some(s=>(s.kind==='office'||s.kind==='workshop') && contains(c.outline,s.x,s.z)))continue
    const isPump=match?.labels.some(v=>v.includes('泵房'))
    const h=isPump?2.95:c.volumeHeightDisplayOnly*(c.layer==='$pm单体'?1.95:1.25)
    const g=prism(c.outline,h,.10)
    if(match)interactive(g,wall,{pick:'matchedContour',sourceHandle:c.handle})
    else add(g,wall)
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
  for(const [i,p] of spatial.poolContourCandidates.entries()){
    const ring=p.displayXZ
    if(ring.length<4)continue
    // Nesting is common: every closed trace keeps its own ID; elevation offsets prevent z-fighting.
    const y=.40+i*.002
    // Recessed water body fills the pool; its surface sits below the coping cap so the
    // rim reads as a wall above the water, not a flat plate at the same level.
    interactive(prism(ring,.06,y),pool,{pick:'reliefPoint',pointId:p.id,sourceHandle:p.sourceGeometryHandles[0]})
    for(let j=1;j<ring.length;j++)if(distance(ring[j-1],ring[j])>.015){
      // Dark wall band (inner/outer wall) from just below the waterline up to the cap.
      add(strip(ring[j-1],ring[j],.14,.26,y+.02),poolInner)
      // Bright coping cap, slightly wider than the wall so the top edge reads as a rim.
      add(strip(ring[j-1],ring[j],.20,.06,y+.22),poolRim)
    }
  }
  // Pool safety railing. Follows the CAD trace; the rail itself is presentation detail.
  for(const [i,p] of spatial.poolContourCandidates.entries()){
    const ring=p.displayXZ
    if(ring.length<4)continue
    const base=.70+i*.002
    for(let j=1;j<ring.length;j++){
      const [a,b]=[ring[j-1],ring[j]],len=distance(a,b)
      if(len<.35)continue
      add(strip(a,b,.055,.045,base+.34),fence)
      for(let d=.15;d<len;d+=1.6){
        const t=d/len
        add(new T.BoxGeometry(.06,.36,.06).translate(a[0]+(b[0]-a[0])*t,base+.18,-(a[1]+(b[1]-a[1])*t)),fence)
      }
    }
  }
  // ---------------------------------------------------------------- process equipment
  // Circular clarifiers near the CAD text of 污水处理场 (TG-CAD-11). The tanks are
  // presentation geometry: this DWG has no verified tank outline or diameter.
  const clarifierWater=palette('#2f92b5',.14,.14)
  clarifierWater.emissive=new T.Color('#144f68');clarifierWater.emissiveIntensity=.5
  const clarifierRim=palette('#e7f1f4',.55,.06)
  for(const [cx,cz] of [[-26.2,36.4],[-21.4,36.4],[-26.2,40.8],[-21.4,40.8]] as XY[]){
    add(new T.CylinderGeometry(2.15,2.15,.66,44).translate(cx,.37,-cz),clarifier)
    add(new T.CylinderGeometry(2.02,2.02,.06,44).translate(cx,.70,-cz),clarifierWater)
    add(new T.TorusGeometry(2.07,.09,10,48).rotateX(Math.PI/2).translate(cx,.74,-cz),clarifierRim)
    add(strip([cx-1.86,cz],[cx+1.86,cz],.22,.13,.84),steel)
    add(new T.CylinderGeometry(.15,.15,.90,10).translate(cx,.58,-cz),steel)
    for(let k=0;k<30;k++){
      const a=k/30*Math.PI*2
      add(new T.BoxGeometry(.045,.34,.045).translate(cx+Math.cos(a)*2.10,.88,-(cz+Math.sin(a)*2.10)),fence)
    }
  }
  // Rectangular aeration basin east of the clarifiers. Presentation volume only.
  {
    const bx0=-16.4,bx1=-14.4,bz0=35.6,bz1=41.4
    add(prism([[bx0,bz0],[bx1,bz0],[bx1,bz1],[bx0,bz1]],.36,.02),clarifier)
    add(prism([[bx0+.22,bz0+.22],[bx1-.22,bz0+.22],[bx1-.22,bz1-.22],[bx0+.22,bz1-.22]],.06,.36),clarifierWater)
    for(const z of [37.5,39.5])add(strip([bx0+.1,z],[bx1-.1,z],.08,.10,.40),coping)
    add(strip([bx0+.3,bz0+.3],[bx0+.3,bz1-.3],.08,.44,.42),fence)
  }
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
  // 洗车台区 canopy at CAD text TG-CAD-13 (FAE1D). Bay count and roof form are
  // presentation detail; the source drawing only fixes the area's location.
  {
    const cx=-45.5,cz=-6.3
    add(prism([[cx-4.4,cz-6.2],[cx+4.4,cz-6.2],[cx+4.4,cz+6.2],[cx-4.4,cz+6.2]],.05,.02),concrete)
    for(let i=0;i<5;i++){
      const z=cz-5-i*2.65
      for(const dx of [-3.9,3.9]){
        add(new T.BoxGeometry(.17,1.06,.17).translate(cx+dx,.56,-z),steel)
        add(new T.BoxGeometry(.20,.10,.90).translate(cx+dx,.10,-z),steel)
      }
      add(strip([cx-4.1,z],[cx+4.1,z],.055,.16,1.06),fence)
      add(prism([[cx-3.9,z-1.15],[cx+3.9,z-1.15],[cx+3.9,z-.75],[cx-3.9,z-.75]],.36,.12),coping)
    }
    add(prism([[cx-4.2,cz-6.0],[cx+4.2,cz-6.0],[cx+4.2,cz+5.4],[cx-4.2,cz+5.4]],.08,1.16),wall)
    for(let i=0;i<5;i++)add(strip([cx-4.15,cz-5.5+i*2.7],[cx+4.15,cz-5.5+i*2.7],.10,.09,1.245),fence)
    add(strip([cx-4.2,cz-6.0],[cx-4.2,cz+5.4],.10,.20,1.24),fence)
    add(strip([cx+4.2,cz-6.0],[cx+4.2,cz+5.4],.10,.20,1.24),fence)
  }
  // ---------------------------------------------------------------- planting
  // Perimeter forest belts and trees inside closed --绿化 outlines. Trees are
  // landscape presentation; there is no tree inventory in the source DWG.
  const rng=(()=>{let s=20261121>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}})()
  const treeSites:{x:number;z:number;r:number;h:number;tone:number;detail:boolean}[]=[]
  // `detail` marks trees near the working area that use the Blender tree models.
  // The dense perimeter belts keep the low-poly instanced crowns.
  const pushTree=(x:number,z:number,scale=1,detail=false)=>{
    treeSites.push({x,z,r:(.40+.46*rng())*scale,h:(.66+1.25*rng())*scale,tone:Math.floor(rng()*6),detail})
  }
  // Woodland belt now starts right behind the north facility row and along the east
  // boundary, as in the reference composition. Tree spacing is presentation only.
  const belts:number[][]=[[xmin-18,xmin-1.4,zmin+2,zmax+18],[48,xmax+18,zmin+2,zmax+18],
    [xmin-18,xmax+18,49.5,zmax+18]]
  for(const [x0,x1,z0,z1] of belts){
    // Dark forest floor under the belts so the edge reads as woodland, not lawn.
    add(prism([[x0,z0],[x1,z0],[x1,z1],[x0,z1]],.045,.004),forestFloor)
    for(let z=z0;z<z1;z+=1.32)for(let x=x0;x<x1;x+=1.32){
      if(rng()<.10)continue
      pushTree(x+(rng()-.5)*1.2,z+(rng()-.5)*1.2,.95+rng()*.55)
    }
  }
  // Taller back row so the far forest edge reads as a treeline, not a low hedge.
  for(let x=xmin-16;x<xmax+16;x+=1.75)for(let z=zmax+6;z<zmax+17;z+=1.9){
    if(rng()<.08)continue
    pushTree(x+(rng()-.5)*1.5,z,1.2+rng()*.6)
  }
  let internalTrees=0
  // Street trees along the open north band and the east/west service roads.
  for(let x=-62;x<58;x+=3.9)pushTree(x+(rng()-.5)*.7,46.6+(rng()-.5)*1.1,.7+rng()*.25,true)
  for(let z=-40;z<32;z+=4.1){pushTree(44.4+(rng()-.5)*.8,z,.68+rng()*.28,true);pushTree(-49.6+(rng()-.5)*.8,z,.68+rng()*.28,true)}
  // Grove on the west service lawn so the quay approach does not read as empty turf.
  for(let x=-64;x<-50;x+=3.2)for(let z=-58;z<-38;z+=3.2){
    if(rng()<.42)continue
    pushTree(x+(rng()-.5)*1.8,z+(rng()-.5)*1.8,1.0+rng()*.45,true)
  }
  // Park trees between the yard roads and the east service buildings, plus the north-east corner.
  for(let z=-40;z<30;z+=2.7)for(const x of [21.6,-46.9])
    if(rng()>.12)pushTree(x+(rng()-.5)*1.2,z+(rng()-.5)*1.5,1.0+rng()*.40,true)
  for(let x=30;x<63;x+=3.0)for(let z=11;z<48;z+=3.0){
    if(rng()<.38)continue
    if(x>44&&z<7)continue
    pushTree(x+(rng()-.5)*1.7,z+(rng()-.5)*1.7,1.05+rng()*.5,true)
  }
  // Second row along the east yard fence and loose park planting on the service lawn.
  for(let z=-36;z<9;z+=3.4)if(rng()>.18)pushTree(24.9+(rng()-.5)*1.0,z+(rng()-.5)*1.4,.95+rng()*.35,true)
  for(let x=26;x<46;x+=4.9)for(let z=-12;z<9;z+=4.9){
    if(rng()<.62)continue
    pushTree(x+(rng()-.5)*1.6,z+(rng()-.5)*1.6,.95+rng()*.4,true)
  }
  // Shoreline trees around the artificial lake; the north bank is left clear for
  // the pump station and treatment buildings.
  for(let i=0;i<9;i++){
    const a=i/9*Math.PI*2
    if(Math.sin(a)>.2)continue
    const r=7.4+rng()*1.3
    pushTree(27+Math.cos(a)*r,-42.35+Math.sin(a)*r*.74,.85+rng()*.35,true)
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
      pushTree(x+(rng()-.5)*1.1,z+(rng()-.5)*1.1,.75+rng()*.5,true);internalTrees++
    }
  }
  const simpleSites=treeSites.filter(t=>!t.detail)
  if(simpleSites.length){
    // Smoother belt crowns: one extra subdivision removes the faceted silhouette
    // that read as low-poly blocks against the reference treeline.
    const crownGeo=new T.IcosahedronGeometry(1,1),lobeGeo=new T.IcosahedronGeometry(1,0),trunkGeo=new T.CylinderGeometry(.05,.065,1,5)
    const crownMat=new T.MeshStandardMaterial({color:'#ffffff',roughness:.94,metalness:0})
    const trunkMat=new T.MeshStandardMaterial({color:'#5a4a3c',roughness:1,metalness:0})
    materials.push(crownMat,trunkMat);geometries.push(crownGeo,lobeGeo,trunkGeo)
    const crown=new T.InstancedMesh(crownGeo,crownMat,simpleSites.length)
    const crown2=new T.InstancedMesh(lobeGeo,crownMat,simpleSites.length)
    const crown3=new T.InstancedMesh(lobeGeo,crownMat,simpleSites.length)
    const trunk=new T.InstancedMesh(trunkGeo,trunkMat,simpleSites.length)
    crown.name='林带树冠';crown2.name='林带树冠二层';crown3.name='林带树冠三层';trunk.name='林带树干'
    const tones=['#25522e','#2f6134','#1f4728','#386b36','#2a5730','#41773c'].map(c=>new T.Color(c))
    const m=new T.Matrix4(),q=new T.Quaternion(),Y=new T.Vector3(0,1,0)
    simpleSites.forEach((t,i)=>{
      const trunkH=t.h*1.2
      // Per-tree rotation and lobe offsets break the repeated identical clump silhouette.
      q.setFromAxisAngle(Y,(t.tone*1.31+i*.53)%(Math.PI*2))
      m.compose(new T.Vector3(t.x,trunkH*.5,-t.z),q,new T.Vector3(1,trunkH,1))
      trunk.setMatrixAt(i,m)
      m.compose(new T.Vector3(t.x,trunkH+t.r*.72,-t.z),q,new T.Vector3(t.r,t.r*.92,t.r))
      crown.setMatrixAt(i,m)
      crown.setColorAt(i,tones[t.tone%tones.length])
      // Second, smaller crown lobe fills the silhouette instead of a single spike.
      const j1=.18+.10*((i*7+t.tone)%8)/8, j2=.26+.12*((i*5+t.tone*3)%7)/7
      m.compose(new T.Vector3(t.x+t.r*j1,trunkH+t.r*1.06,-t.z-t.r*j1*.82),q,
        new T.Vector3(t.r*.66,t.r*.60,t.r*.66))
      crown2.setMatrixAt(i,m)
      crown2.setColorAt(i,tones[(t.tone+1)%tones.length])
      m.compose(new T.Vector3(t.x-t.r*j2,trunkH+t.r*.86,-t.z+t.r*j2*.66),q,
        new T.Vector3(t.r*.52,t.r*.48,t.r*.52))
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
    // Far canopy mass behind the perimeter belts: overlapping low-poly crowns that
    // read as continuous woodland from the default camera. Presentation only.
    const blobGeo=new T.IcosahedronGeometry(1,1)
    const blobMat=new T.MeshStandardMaterial({color:'#ffffff',roughness:.98,metalness:0})
    materials.push(blobMat)
    const blobSites:[number,number][]=[]
    for(let x=xmin-22;x<xmax+22;x+=3.4)for(let z=zmax+5;z<zmax+24;z+=3.9)
      if(rng()>.08)blobSites.push([x,z])
    for(let z=zmin+4;z<zmax+8;z+=4.0)for(let x=xmax+3;x<xmax+22;x+=3.6)
      if(rng()>.12)blobSites.push([x,z])
    for(let z=zmin+4;z<zmax+8;z+=4.0)for(let x=xmin-22;x<xmin-3;x+=3.6)
      if(rng()>.12)blobSites.push([x,z])
    const mass=new T.InstancedMesh(blobGeo,blobMat,blobSites.length)
    mass.name='远景林冠体块'
    const massTones=['#27452c','#2f5233','#213d27','#365c37','#1c3822','#3a6240'].map(c=>new T.Color(c))
    blobSites.forEach(([x,z],i)=>{
      const r=2.4+rng()*1.4
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
  const shallow=palette('#9adbd3',.30,.04), shoreStone=palette('#d9d6ca')
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
  for(const f of sites){
    const {x,z,width,depth,height,kind}=f
    const cad=data.anchors.find(a=>a.x===x&&a.z===z)
    const pointId=cad?.id || ({'1058D8':'TG-CHAIN-1058D8','1AFB89':'TG-CAD-15','139AAA':'TG-CAD-16','10340E':'TG-CAD-14'} as Record<string,string>)[f.handle] || 'HOME-'+f.handle
    const token={pick:'reliefPoint',pointId,sourceHandle:f.handle}
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
      // 岸线形状与放大倍数为表现参数，不是实测水面范围。
      const LW=width*1.9,LD=depth*1.9
      const ring=(k:number):XY[]=>Array.from({length:72},(_,i)=>{
        const a=i/72*Math.PI*2
        const r=1+.118*Math.sin(3*a+.35)+.056*Math.sin(5*a+.9)+.024*Math.sin(9*a+1.1)+.015*Math.cos(13*a+2.3)
        return [x+Math.cos(a)*LW*.5*k*r,z+Math.sin(a)*LD*.5*k*r] as XY
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
      const ix=x+LW*.08,iz=z-LD*.10
      add(new T.CylinderGeometry(2.1,2.4,.14,.32).translate(ix,.15,-iz),shoreStone)
      add(new T.IcosahedronGeometry(1.75,1).scale(1,.28,.72).translate(ix,.24,-iz),lakeside)
      for(let k=0;k<7;k++){
        const a=k/7*Math.PI*2
        add(new T.IcosahedronGeometry(.32+(k%3)*.05,0).translate(ix+Math.cos(a)*1.05,.52,-(iz+Math.sin(a)*.65)),k%2?canopy:canopyLight)
      }
      for(let i=0;i<edge.length;i+=8)add(new T.ConeGeometry(.05,.2,5).translate(edge[i][0],.22,-edge[i][1]),reed)
    }else if(kind==='pool'){
      if(f.handle==='103415'||f.handle==='10340E'){
        // Two CAD TEXT anchors share the design name 生态蓄水池. No individual basin
        // outline is verified, so only a flat candidate border is drawn (no water body).
        add(new T.BoxGeometry(width,.02,depth).translate(x,.065,-z),road)
        for(const side of [-1,1]){
          box(0,side*depth/2,width+.14,.05,.02,.035,coping)
          box(side*width/2,0,.02,depth,.02,.035,coping)
        }
      }else{
        interactive(new T.BoxGeometry(width,.16,depth).translate(x,.16,-z),pool,token)
        for(const side of [-1,1]){
          box(0,side*depth/2,width+.14,.11,.29,.035,coping)
          box(side*width/2,0,.11,depth,.29,.035,coping)
        }
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
  // Reuse one Blender truss bay along the longest source edge in the belt assembly layer.
  // Parallel belt edges are not counted as separate conveyors. The section/height is illustrative.
  const spanLength=(line:Path)=>distance(line.displayPoints[0],line.displayPoints[1])
  const gallerySource=data.lines.filter(l=>l.layer==='++皮带机'&&l.displayPoints.length===2)
    .sort((a,b)=>spanLength(b)-spanLength(a))[0]
  const galleryInstances:T.InstancedMesh[]=[]
  const galleryResources=new Set<T.Material|T.BufferGeometry>()
  async function loadGallery(){
    if(!gallerySource)return false
    const {scene:model}=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'tanggang/models/harbor/gallery-bay.glb')
    const [a,b]=gallerySource.displayPoints,len=distance(a,b),count=Math.max(1,Math.round(len/4)),step=len/count
    const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len,host=new T.Object3D()
    model.updateMatrixWorld(true)
    model.traverse(part=>{
      if(!(part instanceof T.Mesh))return
      galleryResources.add(part.geometry)
      for(const m of Array.isArray(part.material)?part.material:[part.material])galleryResources.add(m)
      if(disposed)return
      const batch=new T.InstancedMesh(part.geometry,part.material,count)
      batch.name='Gallery bay · '+gallerySource.handle;batch.userData.sourceHandle=gallerySource.handle
      for(let i=0;i<count;i++){
        host.position.set(a[0]+dx*step*i,.07,-a[1]-dz*step*i)
        host.rotation.y=Math.atan2(dz,dx);host.scale.set(step/4,1,1);host.updateMatrix()
        batch.setMatrixAt(i,new T.Matrix4().multiplyMatrices(host.matrix,part.matrixWorld))
      }
      batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere()
      batch.castShadow=batch.receiveShadow=true;galleryInstances.push(batch);group.add(batch);assignGray(batch)
    })
    if(disposed)galleryResources.forEach(r=>r.dispose())
    return !disposed
  }
  // ---------------------------------------------------------------- Blender assets
  // Ships, ship loaders, stacker-reclaimers and the enclosed belt gallery are authored
  // in modeling/harbor/create_port_assets.py. Placement follows CAD berth anchors and
  // yard band centres; the asset form itself is presentation geometry.
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
    const [shipTpl,loaderTpl,stackTpl,galleryTpl]=await Promise.all([
      loader.loadAsync(base+'bulk-carrier.glb'),
      loader.loadAsync(base+'ship-loader.glb'),
      loader.loadAsync(base+'stacker-reclaimer.glb'),
      loader.loadAsync(base+'belt-gallery.glb')
    ])
    if(disposed)return false
    // Presentation tint: rust-brown cargo decks read closer to the reference render.
    const tint:Record<string,string>={'deck-grey':'#8a5643','hatch-blue':'#31434d','hull-navy':'#4a3730'}
    shipTpl.scene.traverse(o=>{
      if(!(o instanceof T.Mesh))return
      for(const m of Array.isArray(o.material)?o.material:[o.material])
        if(m instanceof T.MeshStandardMaterial && tint[m.name])m.color.set(tint[m.name])
    })
    const q=quayInfo, theta=Math.atan2(q.dz,q.dx)
    let shipIndex=0
    for(const berth of data.anchors.filter(p=>p.modelType==='berth_anchor')){
      const t=(berth.x-q.a[0])*q.dx+(berth.z-q.a[1])*q.dz
      const cx=q.a[0]+q.dx*t+q.nx*3.6, cz=q.a[1]+q.dz*t+q.nz*3.6
      const shipLength=Math.min(32,Math.max(24,q.len*.36))
      const ship=placeAsset(shipTpl.scene,new T.Vector3(cx,.04,-cz),theta,shipLength/20,'散货船 · 泊位表现模型')
      // Gentle swell only. Vessel identity and berth status are not simulated.
      ship.userData.bobBase=.04;ship.userData.bobPhase=shipIndex++*2.1+1.2
      // Scenic foam collar at the waterline so the hull sits in the water.
      const collarGeo=new T.RingGeometry(shipLength*.40,shipLength*.455,44)
      const collarMat=new T.MeshBasicMaterial({color:'#e6f6f6',transparent:true,opacity:.34,depthWrite:false})
      const collar=new T.Group()
      collar.position.set(cx,.076,-cz);collar.rotation.y=theta
      const ring=new T.Mesh(collarGeo,collarMat)
      ring.rotation.x=-Math.PI/2;ring.scale.set(1,.30,1)
      collar.add(ring);group.add(collar)
      portResources.add(collarGeo);portResources.add(collarMat)
      const lx=q.a[0]+q.dx*t+q.nx*1.0, lz=q.a[1]+q.dz*t+q.nz*1.0
      // The GLB boom points +Z; add PI so it reaches over the vessel.
      placeAsset(loaderTpl.scene,new T.Vector3(lx,.06,-lz),theta+Math.PI,1.55,'装船机 · 表现模型')
    }
    for(const [,g] of pileGroups){
      const x=g.xs.reduce((a,b)=>a+b,0)/g.xs.length
      const z0=Math.min(...g.zs)-18,z1=Math.max(...g.zs)+11.5
      // One stacker-reclaimer per pile, working from the middle of the run toward
      // the northern end as in the reference render. Form and count are presentation
      // geometry; the CAD only fixes the pile text anchors.
      placeAsset(stackTpl.scene,new T.Vector3(x,.02,-((z0+z1)/2)),0,1.35,
        '堆取料机 · 表现模型')
    }
    const belt=data.lines.filter(l=>l.layer==='++皮带机'&&l.displayPoints.length===2)
      .sort((a,b)=>distance(b.displayPoints[0],b.displayPoints[1])-distance(a.displayPoints[0],a.displayPoints[1]))[0]
    if(belt){
      const [a,b]=belt.displayPoints,len=distance(a,b),count=Math.floor(len/10)
      const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len
      for(let i=0;i<count;i++)
        placeAsset(galleryTpl.scene,new T.Vector3(a[0]+dx*(i*10+5),.06,-(a[1]+dz*(i*10+5))),
          Math.atan2(dz,dx),1,'封闭皮带机廊道 · 表现模型')
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
      const cad=data.anchors.find(a=>a.x===f.x&&a.z===f.z)
      const pointId=cad?.id || ({'1AFB89':'TG-CAD-15','139AAA':'TG-CAD-16'} as Record<string,string>)[handle] || 'HOME-'+handle
      const token={pick:'reliefPoint',pointId,sourceHandle:handle}
      const obj=models[i].scene
      obj.position.set(px,.10,-pz)
      obj.name='精细建筑 · '+handle
      obj.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        portResources.add(o.geometry)
        for(const m of Array.isArray(o.material)?o.material:[o.material])portResources.add(m)
        o.castShadow=true;o.receiveShadow=true;o.userData=token
        picks.push(o);assignGray(o)
      })
      group.add(obj)
    })
    return !disposed
  }
  // Process buildings authored inside the two verified text contours. The CAD review
  // only proves the label falls inside each outline; the building form is presentation.
  async function loadProcessBuildings(){
    const base=import.meta.env.BASE_URL+'tanggang/models/harbor/'
    const loader=new GLTFLoader()
    const defs:[string,number,number,number,string][]=[
      ['pumphouse.glb',-0.55,40.55,0,'除尘泵房 · 轮廓内表现建筑'],
      ['treatmenthouse.glb',-18.05,40.6,Math.PI/2,'污水处理场 · 轮廓内表现建筑']
    ]
    const models=await Promise.all(defs.map(d=>loader.loadAsync(base+d[0])))
    if(disposed)return false
    models.forEach((m,i)=>{
      const [,x,z,rot,label]=defs[i]
      add(new T.PlaneGeometry(7.4,6.2).rotateX(-Math.PI/2).translate(x,.094,-z),softShadowMat)
      const obj=m.scene
      obj.position.set(x,.10,-z)
      obj.rotation.y=rot
      obj.name=label
      obj.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        portResources.add(o.geometry)
        for(const mm of Array.isArray(o.material)?o.material:[o.material])portResources.add(mm)
        o.castShadow=true;o.receiveShadow=true
        assignGray(o)
      })
      group.add(obj)
    })
    return !disposed
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
    const tpls=await Promise.all(['tree-broad.glb','tree-narrow.glb','tree-shrub.glb']
      .map(f=>loader.loadAsync(base+f)))
    if(disposed)return false
    function bake(src:T.Object3D){
      const raw:T.BufferGeometry[]=[]
      src.updateMatrixWorld(true)
      src.traverse(o=>{
        if(!(o instanceof T.Mesh))return
        const g=o.geometry.clone()
        g.applyMatrix4(o.matrixWorld)
        g.deleteAttribute('uv')
        const material=(Array.isArray(o.material)?o.material[0]:o.material) as T.MeshStandardMaterial
        // Blender exports base colours as linear values; map them back onto the scene
        // palette so detailed trees read at the same density as the belt crowns.
        const name=(material.name||'').toLowerCase()
        const c=new T.Color(name.includes('bark')||name.includes('stem')?'#5a4a3c'
          :name.includes('shrub')?'#3f7539':'#2f6334')
        const count=g.attributes.position.count,colors=new Float32Array(count*3)
        for(let i=0;i<count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
        g.setAttribute('color',new T.Float32BufferAttribute(colors,3))
        raw.push(g)
      })
      const normalized=raw.map(g=>g.index?g.toNonIndexed():g)
      const merged=mergeGeometries(normalized)
      normalized.forEach(g=>g.dispose());raw.forEach(g=>g.dispose())
      if(merged)treeResources.add(merged)
      return merged
    }
    const geos=tpls.map(t=>bake(t.scene))
    const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0})
    treeResources.add(material)
    const buckets:{i:number;s:number;rot:number}[][]=[[],[],[]]
    detailed.forEach((t,i)=>{
      // Low, wide shrubs near kerbs; upright trees along roads; broad crowns elsewhere.
      const v=t.tone>=5?2:(t.tone%2)
      buckets[v].push({i,s:t.h*1.15,rot:(i*2.399)%(Math.PI*2)})
    })
    const tint=[new T.Color(.88,.99,.84),new T.Color(1,1.02,.94),
      new T.Color(.94,1.05,.90),new T.Color(1.03,.99,.88)]
    const host=new T.Object3D()
    buckets.forEach((list,v)=>{
      const geometry=geos[v]
      if(!geometry||!list.length)return
      const batch=new T.InstancedMesh(geometry,material,list.length)
      batch.name=['精细阔叶树','精细行道树','精细灌木'][v]
      list.forEach(({i,s,rot},k)=>{
        const t=detailed[i]
        host.position.set(t.x,.02,-t.z)
        host.rotation.set(0,rot,0)
        host.scale.set(s,s,s)
        host.updateMatrix()
        batch.setMatrixAt(k,host.matrix)
        batch.setColorAt(k,tint[t.tone%tint.length])
      })
      batch.instanceMatrix.needsUpdate=true
      if(batch.instanceColor)batch.instanceColor.needsUpdate=true
      batch.castShadow=batch.receiveShadow=true
      batch.computeBoundingSphere()
      treeBatches.push(batch);group.add(batch);assignGray(batch)
    })
    return !disposed
  }
  // Batch static primitives by material. Keep only interactive source features as individual meshes.
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
  }
  group.traverse(o=>{if(o instanceof T.Mesh)assignGray(o)})
  function setGray(gray:boolean){if(gray===isGray)return;isGray=gray;for(const [mesh,original] of originals)mesh.material=gray?clay:original}
  // Scene animation: water ripple drift and a gentle vessel swell. No operational
  // values, vessel identity or berth status are simulated.
  function update(t:number){
    seaRipple.offset.set((t*.018)%1,(t*.043)%1)
    lakeRipple.offset.set((t*.012)%1,(t*.031)%1)
    for(const obj of portInstances){
      if(obj.userData.bobBase===undefined)continue
      obj.position.y=obj.userData.bobBase+Math.sin(t*.55+obj.userData.bobPhase)*.04
    }
  }
  function dispose(){
    disposed=true
    textures.forEach(t=>t.dispose());galleryInstances.forEach(i=>i.dispose());galleryResources.forEach(r=>r.dispose())
    treeBatches.forEach(i=>i.dispose());treeResources.forEach(r=>r.dispose())
    portInstances.length=0;portResources.forEach(r=>r.dispose())
    originals.clear()
    group.removeFromParent()
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())
  }
  return {group,picks,dispose,setGray,loadGallery,loadPortAssets,loadBuildings,loadTrees,loadProcessBuildings,update}
}
