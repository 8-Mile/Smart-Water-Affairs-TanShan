<template>
  <div ref="hostRef" class="robot-live" aria-hidden="true" />
</template>

<script setup lang="ts">
/**
 * ORB-01 会眨眼/有表情的 3D 机器人（移植自 public/robot-live）
 * - 透明背景，适合嵌入悬浮小窗
 * - 随机眨眼 + 呼吸浮动 + 视线跟随
 * - 表情接口：setMood('happy' | 'sad') / blink() / clearMood()
 * - 视线接口：setPointer(x, y)（x/y 归一化 -1~1）
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const emit = defineEmits<{ (e: 'ready'): void }>()

const hostRef = ref<HTMLDivElement | null>(null)

const ASSET_BASE = '/robot-live/assets/'

/* ---------------- helpers ---------------- */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const damp = (a: number, b: number, lambda: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-lambda * dt))
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInQuad = (t: number) => t * t

/* ---------------- three core ---------------- */
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let rafId = 0
let disposed = false
const clock = new THREE.Clock()
let resizeObserver: ResizeObserver | null = null

const rig = new THREE.Group()
rig.position.y = 0.075

let robotBox = new THREE.Box3()
let robotSize = new THREE.Vector3(1, 1, 1)
let faceUniforms: Record<string, { value: unknown }> | null = null

/* ---------------- shaders（表情遮罩） ---------------- */
const shutterVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const shutterDimFragment = /* glsl */ `
  uniform float uBlink;
  uniform float uSad;
  uniform vec4 uEyes[2];
  varying vec2 vUv;

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float dim = 1.0;

    for (int i = 0; i < 2; i++) {
      vec4 e = uEyes[i];
      vec2 p = (uv - e.xy) / max(e.zw, vec2(0.00001));
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) continue;

      float lid = 0.5 + 0.085 * pow(abs(p.x - 0.5) * 2.0, 2.0) - 0.045;
      float halfGap = 0.5 * (1.0 - uBlink * 0.985);
      float d = abs(p.y - lid);
      float bars = smoothstep(halfGap, halfGap + 0.022, d);

      vec2 q = (p - 0.5) * 2.0;
      float oval = 1.0 - smoothstep(0.70, 1.0, length(q));
      float border = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
      float baseMask = oval * smoothstep(0.0, 0.02, border);

      float blinkMask = baseMask * smoothstep(0.0, 0.04, uBlink);
      float full = smoothstep(0.90, 0.995, uBlink);
      float cover = blinkMask * mix(bars, 1.0, full);

      // sad upper eyelid: drops toward the outer corner
      float outward = (e.x < 0.5) ? (1.0 - p.x) : p.x;
      float sadLid = 0.88 - 0.26 * outward;
      float sadMask = smoothstep(0.0, 0.035, border) * uSad;
      float sadCover = sadMask * smoothstep(sadLid - 0.018, sadLid + 0.018, p.y);
      cover = max(cover, sadCover);

      dim = min(dim, 1.0 - cover * 0.995);
    }
    gl_FragColor = vec4(vec3(dim), 1.0);
  }
`

const shutterLineFragment = /* glsl */ `
  uniform float uBlink;
  uniform vec4 uEyes[2];
  varying vec2 vUv;

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float amt = 0.0;

    for (int i = 0; i < 2; i++) {
      vec4 e = uEyes[i];
      vec2 p = (uv - e.xy) / max(e.zw, vec2(0.00001));
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) continue;

      float lid = 0.5 + 0.085 * pow(abs(p.x - 0.5) * 2.0, 2.0) - 0.045;
      float lx = abs(p.x - 0.5);
      float ld = abs(p.y - lid);
      float core = smoothstep(0.0062, 0.0010, ld);
      float halo = exp(-ld * 42.0) * 0.30;
      float border = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
      float fade = smoothstep(0.64, 0.94, uBlink);
      fade *= smoothstep(0.44, 0.40, lx);
      fade *= smoothstep(0.0, 0.05, border);
      amt = max(amt, (core + halo) * fade);
    }
    gl_FragColor = vec4(vec3(0.36, 1.42, 2.05), clamp(amt, 0.0, 1.0));
  }
`

const mouthDimFragment = /* glsl */ `
  uniform float uSad;
  uniform vec4 uMouth;
  varying vec2 vUv;

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float dim = 1.0;
    vec2 p = (uv - uMouth.xy) / max(uMouth.zw, vec2(0.00001));
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
      vec2 q = (p - 0.5) * 2.0;
      float oval = 1.0 - smoothstep(0.55, 1.0, length(q));
      float border = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
      float mask = oval * smoothstep(0.0, 0.04, border) * smoothstep(0.0, 0.05, uSad);
      dim = 1.0 - mask * 0.995;
    }
    gl_FragColor = vec4(vec3(dim), 1.0);
  }
`

const mouthLineFragment = /* glsl */ `
  uniform float uSad;
  uniform float uSadTime;
  uniform vec4 uMouth;
  varying vec2 vUv;

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float amt = 0.0;
    vec2 p = (uv - uMouth.xy) / max(uMouth.zw, vec2(0.00001));
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
      float x = abs(p.x - 0.5) * 2.0;
      float y = 0.30 + 0.29 * (1.0 - x * x);
      y += sin(uSadTime * 8.0 + p.x * 22.0) * 0.006;
      float d = abs(p.y - y);
      float core = smoothstep(0.040, 0.008, d);
      float halo = exp(-d * 44.0) * 0.50;
      float border = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
      float fade = smoothstep(0.0, 0.35, uSad);
      fade *= smoothstep(0.96, 0.80, x);
      fade *= smoothstep(0.0, 0.06, border);
      amt = clamp((core + halo) * fade, 0.0, 1.0);
    }
    gl_FragColor = vec4(vec3(0.46, 1.45, 2.05), amt);
  }
`

const browLineFragment = /* glsl */ `
  uniform float uSad;
  uniform vec4 uBrow;
  varying vec2 vUv;

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float amt = 0.0;
    vec2 p = (uv - uBrow.xy) / max(uBrow.zw, vec2(0.00001));
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
      float side = step(0.5, p.x);
      float x0 = mix(0.03, 0.66, side);
      float x1 = mix(0.34, 0.97, side);
      float t = (p.x - x0) / (x1 - x0);
      if (t >= 0.0 && t <= 1.0) {
        float y = side > 0.5 ? mix(0.62, 0.10, t) : mix(0.10, 0.62, t);
        float d = abs(p.y - y);
        float core = smoothstep(0.024, 0.004, d);
        float halo = exp(-d * 70.0) * 0.18;
        float fade = smoothstep(0.0, 0.35, uSad) * smoothstep(0.0, 0.08, min(t, 1.0 - t));
        amt = clamp((core + halo) * fade, 0.0, 1.0);
      }
    }
    gl_FragColor = vec4(vec3(0.22, 0.82, 1.22), amt);
  }
`

function buildFaceUniforms(faceData: FaceData) {
  const normBox = (b: { x0: number; z0: number; x1: number; z1: number }) => {
    const [x0, x1, z0, z1] = faceData.bounds
    return new THREE.Vector4(
      (b.x0 - x0) / (x1 - x0),
      (b.z0 - z0) / (z1 - z0),
      (b.x1 - b.x0) / (x1 - x0),
      (b.z1 - b.z0) / (z1 - z0)
    )
  }
  const eyes = faceData.eyes.map(normBox)
  return {
    uBlink: { value: 1 },
    uEyes: { value: eyes },
    uSad: { value: 0 },
    uSadTime: { value: 0 },
    uMouth: { value: normBox(faceData.mouth) },
    uBrow: { value: normBox(faceData.brows) },
  }
}

interface FaceBox {
  x0: number
  z0: number
  x1: number
  z1: number
}
interface FaceData {
  eyes: FaceBox[]
  mouth: FaceBox
  brows: FaceBox
  bounds: [number, number, number, number]
}

/* ---------------- interaction state ---------------- */
const state = {
  time: 0,
  intro: 0,
  blink: 0,
  squint: 0,
  squintTarget: 0,
  squintUntil: 0,
  pointer: new THREE.Vector2(0, 0),
  pointerActive: false,
  happyUntil: 0,
  sad: 0,
  sadTarget: 0,
  sadUntil: 0,
  nextTear: 0,
  reactT: 99,
}

const blink = {
  active: false,
  t: 0,
  dur: 0.23,
  value: 0,
  next: 2.6,
  queue: 0,
  pending: false,
  delay: 0,
  trigger(delay = 0) {
    if (this.active) {
      this.queue = Math.min(this.queue + 1, 1)
      return
    }
    if (delay > 0) {
      this.pending = true
      this.delay = delay
      return
    }
    this.start()
  },
  start() {
    this.active = true
    this.t = 0
    this.value = 0
    this.dur = 0.2 + Math.random() * 0.05
  },
  update(dt: number) {
    if (this.pending) {
      this.delay -= dt
      if (this.delay <= 0) {
        this.pending = false
        this.start()
      }
    }
    if (this.active) {
      this.t += dt
      const p = this.t / this.dur
      if (p < 0.36) this.value = easeInQuad(p / 0.36)
      else if (p < 0.56) this.value = 1
      else if (p < 1) this.value = 1 - easeOutCubic((p - 0.56) / 0.44)
      else {
        this.value = 0
        this.active = false
        if (this.queue > 0) {
          this.queue--
          this.pending = true
          this.delay = 0.14
        }
      }
    } else {
      this.value = damp(this.value, 0, 20, dt)
      if (state.intro > 0.75) {
        this.next -= dt
        if (this.next <= 0) {
          this.start()
          this.next = 2.3 + Math.random() * 3.5
          if (Math.random() < 0.16) this.queue = 1
        }
      }
    }
  },
}

/* ---------------- hearts ---------------- */
function makeHeartTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.translate(64, 66)
  g.shadowColor = 'rgba(255,120,170,0.65)'
  g.shadowBlur = 8
  const grad = g.createLinearGradient(0, -40, 0, 42)
  grad.addColorStop(0, '#fff2f7')
  grad.addColorStop(0.45, '#ffb3cf')
  grad.addColorStop(1, '#ff7aac')
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, 34)
  g.bezierCurveTo(-44, 4, -40, -36, -14, -36)
  g.bezierCurveTo(-5, -36, -1, -30, 0, -24)
  g.bezierCurveTo(1, -30, 5, -36, 14, -36)
  g.bezierCurveTo(40, -36, 44, 4, 0, 34)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
const heartTex = makeHeartTexture()
const hearts: {
  sprite: THREE.Sprite
  life: number
  max: number
  vx: number
  vy: number
  vz: number
  spin: number
}[] = []
for (let i = 0; i < 10; i++) {
  const mat = new THREE.SpriteMaterial({
    map: heartTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.07, 0.07, 1)
  sprite.visible = false
  sprite.renderOrder = 4
  rig.add(sprite)
  hearts.push({ sprite, life: 0, max: 1.6, vx: 0, vy: 0, vz: 0, spin: 0 })
}
function spawnHearts(n = 4) {
  for (let k = 0; k < n; k++) {
    const h = hearts.find((x) => x.life <= 0)
    if (!h) break
    h.life = h.max = 0.95 + Math.random() * 0.4
    h.sprite.visible = true
    const side = Math.random() < 0.5 ? -1 : 1
    h.sprite.position.set(
      side * (0.23 + Math.random() * 0.18),
      0.7 + Math.random() * 0.15,
      0.4 + Math.random() * 0.1
    )
    h.vx = side * (0.012 + Math.random() * 0.025)
    h.vy = 0.08 + Math.random() * 0.08
    h.vz = (Math.random() - 0.5) * 0.03
    h.spin = (Math.random() - 0.5) * 1.2
    h.sprite.material.opacity = 0
    const s = 0.055 + Math.random() * 0.035
    h.sprite.scale.set(s, s, 1)
  }
}
function resetHearts() {
  for (const h of hearts) {
    h.life = 0
    h.sprite.visible = false
    h.sprite.material.opacity = 0
  }
}

/* ---------------- tear ---------------- */
function makeTearTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.translate(64, 64)
  g.shadowColor = 'rgba(130,235,255,0.9)'
  g.shadowBlur = 12
  const grad = g.createLinearGradient(0, -54, 0, 56)
  grad.addColorStop(0, '#f2ffff')
  grad.addColorStop(0.42, '#a9f1ff')
  grad.addColorStop(1, '#3ba9e0')
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, -52)
  g.bezierCurveTo(10, -30, 40, 2, 40, 26)
  g.bezierCurveTo(40, 48, 22, 60, 0, 60)
  g.bezierCurveTo(-22, 60, -40, 48, -40, 26)
  g.bezierCurveTo(-40, 2, -10, -30, 0, -52)
  g.closePath()
  g.fill()
  g.shadowBlur = 0
  g.fillStyle = 'rgba(255,255,255,0.85)'
  g.beginPath()
  g.ellipse(-12, 20, 6, 11, -0.3, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
const tear = { active: false, t: 0, dur: 1.15, side: -1, sprite: null as THREE.Sprite | null }
const tearSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeTearTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
)
tearSprite.scale.set(0.044, 0.064, 1)
tearSprite.visible = false
tearSprite.renderOrder = 5
rig.add(tearSprite)
tear.sprite = tearSprite

function startTear() {
  if (!tear.sprite) return
  tear.active = true
  tear.t = 0
  tear.side *= -1
  tear.sprite.visible = true
  tear.sprite.material.opacity = 0
  tear.sprite.position.set(tear.side * 0.135, 0.598, 0.326)
  tear.sprite.scale.set(0.044, 0.064, 1)
}

/* ---------------- moods ---------------- */
function clearMood() {
  state.happyUntil = 0
  state.sadUntil = 0
  state.sadTarget = 0
  state.squintUntil = 0
  state.squintTarget = 0
  tear.active = false
  if (tear.sprite) {
    tear.sprite.visible = false
    tear.sprite.material.opacity = 0
  }
  resetHearts()
}
function setMoodHappy() {
  clearMood()
  state.happyUntil = state.time + 2.5
  state.squintTarget = 1.0
  state.squintUntil = state.time + 1.15
  state.reactT = 0
  spawnHearts(5)
}
function setMoodSad() {
  clearMood()
  state.sadUntil = state.time + 3.35
  state.sadTarget = 1
  state.nextTear = state.time + 1.35
  startTear()
}

/* ---------------- scene setup ---------------- */
function initThree() {
  const host = hostRef.value
  if (!host) return

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(host.clientWidth || 210, host.clientHeight || 210)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  host.appendChild(renderer.domElement)

  scene = new THREE.Scene()

  const aspect = (host.clientWidth || 210) / (host.clientHeight || 210)
  camera = new THREE.PerspectiveCamera(33, aspect, 0.02, 30)
  camera.position.set(0.08, 0.7, 2.0)

  /* environment + lights */
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.035)
  scene.environment = envRT.texture
  pmrem.dispose()

  scene.add(new THREE.HemisphereLight(0xb8e4ff, 0x0a1018, 0.32))

  const key = new THREE.DirectionalLight(0xfff1df, 1.75)
  key.position.set(2.4, 3.2, 2.7)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0x86c9ff, 0.65)
  fill.position.set(-2.8, 1.2, 2.0)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0x73e4ff, 1.35)
  rim.position.set(-1.4, 2.0, -2.6)
  scene.add(rim)

  const warmRim = new THREE.DirectionalLight(0xffb082, 0.85)
  warmRim.position.set(2.8, 0.7, -1.7)
  scene.add(warmRim)

  const topGlow = new THREE.PointLight(0x6fe3ff, 0.55, 4.5, 2)
  topGlow.position.set(0, 1.65, 0.45)
  scene.add(topGlow)

  scene.add(rig)

  resizeObserver = new ResizeObserver(() => onResize())
  resizeObserver.observe(host)
}

function frameRobot() {
  if (!camera) return
  // 按机器人实际尺寸自适应取景：高度约占画面 94%
  const h = Math.max(robotSize.y, 0.5)
  const vFov = (camera.fov * Math.PI) / 180
  const dist = clamp(h / (2 * Math.tan(vFov / 2) * 0.94), 1.1, 2.6)
  const centerY = 0.075 + (robotBox.min.y + robotBox.max.y) / 2
  camera.position.set(0.08, centerY + dist * 0.06, dist)
  camera.lookAt(0, centerY, 0)
}

/* ---------------- assets ---------------- */
async function loadAssets() {
  const gltfLoader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${ASSET_BASE}draco/`)
  gltfLoader.setDRACOLoader(draco)

  const [gltf, shutterGltf, mouthGltf, browGltf, face] = await Promise.all([
    gltfLoader.loadAsync(`${ASSET_BASE}robot.glb`),
    gltfLoader.loadAsync(`${ASSET_BASE}eye_shutters.glb`),
    gltfLoader.loadAsync(`${ASSET_BASE}mouth_patch.glb`),
    gltfLoader.loadAsync(`${ASSET_BASE}brow_patch.glb`),
    fetch(`${ASSET_BASE}face_boxes.json`).then((r) => {
      if (!r.ok) throw new Error('face_boxes.json not found')
      return r.json()
    }) as Promise<FaceData>,
  ])

  const root = gltf.scene
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.frustumCulled = false
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (!m) continue
        const std = m as unknown as THREE.MeshPhysicalMaterial
        std.envMapIntensity = 0.8
        std.specularColor.setRGB(1, 1, 1)
        std.specularIntensity = 0.55
        if (std.map) {
          std.map.anisotropy = Math.min(8, renderer!.capabilities.getMaxAnisotropy())
          // 一点自发光，让青色细节在阴影里也可见
          std.emissive = new THREE.Color(0xffffff)
          std.emissiveMap = std.map
          std.emissiveIntensity = 0.035
          std.needsUpdate = true
        }
      }
    }
  })
  robotBox.setFromObject(root)
  robotBox.getSize(robotSize)
  rig.add(root)

  faceUniforms = buildFaceUniforms(face)

  const addPatch = (
    gltfScene: THREE.Group,
    fragment: string,
    blending: THREE.Blending,
    premultiplied = false
  ) => {
    let geo: THREE.BufferGeometry | null = null
    gltfScene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) geo = mesh.geometry
    })
    if (!geo || !scene) return
    const mat = new THREE.ShaderMaterial({
      uniforms: faceUniforms!,
      vertexShader: shutterVertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending,
      premultipliedAlpha: premultiplied,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 3
    mesh.frustumCulled = false
    rig.add(mesh)
  }

  addPatch(shutterGltf.scene, shutterDimFragment, THREE.MultiplyBlending, true)
  addPatch(shutterGltf.scene, shutterLineFragment, THREE.AdditiveBlending)
  addPatch(mouthGltf.scene, mouthDimFragment, THREE.MultiplyBlending, true)
  addPatch(mouthGltf.scene, mouthLineFragment, THREE.AdditiveBlending)
  addPatch(browGltf.scene, browLineFragment, THREE.AdditiveBlending)

  frameRobot()
}

/* ---------------- loop ---------------- */
function animate() {
  if (disposed) return
  rafId = requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  state.time += dt
  const t = state.time

  /* intro（加载完成后的起身动画） */
  state.intro = clamp(state.intro + dt / 1.9, 0, 1)

  /* blink + squint */
  blink.update(dt)
  if (t > state.squintUntil) state.squintTarget = 0
  state.squint = damp(state.squint, state.squintTarget, 14, dt)
  state.blink = damp(state.blink, Math.max(blink.value, state.squint), 30, dt)

  /* mood expiry / sad envelope */
  if (state.happyUntil && t > state.happyUntil) clearMood()
  if (state.sadUntil) {
    if (t > state.sadUntil - 0.7) state.sadTarget = 0
    if (t > state.sadUntil) clearMood()
  }
  state.sad = damp(state.sad, state.sadTarget, 7, dt)

  if (faceUniforms) {
    faceUniforms.uBlink.value = state.blink
    faceUniforms.uSad.value = state.sad
    faceUniforms.uSadTime.value = t
  }

  /* rig motion（呼吸浮动 + 随机摇摆 + 视线跟随） */
  const introY = (1 - easeOutCubic(state.intro)) * -0.16
  const introScale = 0.94 + 0.06 * easeOutCubic(state.intro)

  const sad = state.sad
  const idleYaw = Math.sin(t * 0.31) * 0.055
  let targetYaw = idleYaw
  let targetPitch = Math.sin(t * 0.47) * 0.012 + 0.005 + sad * 0.085
  if (state.pointerActive) {
    targetYaw += state.pointer.x * 0.34
    targetPitch += -state.pointer.y * 0.055
  }
  targetYaw = clamp(targetYaw, -0.46, 0.46)
  targetPitch = clamp(targetPitch, -0.075, 0.14)

  const float = (Math.sin(t * 1.28) * 0.008 + Math.sin(t * 0.61) * 0.004) * (1 - 0.45 * sad)
  let reactLift = 0
  let reactSpin = 0
  if (state.reactT != null) {
    state.reactT += dt
    if (state.reactT < 1.2) {
      reactLift = Math.sin(state.reactT * 15) * 0.028 * Math.exp(-state.reactT * 5.2)
      reactSpin = Math.sin(state.reactT * 11) * 0.045 * Math.exp(-state.reactT * 4.5)
    }
  }

  rig.position.y = 0.075 + float + reactLift + introY - sad * 0.018
  rig.position.x = Math.sin(t * 0.43) * 0.012
  rig.position.z = Math.sin(t * 0.29) * 0.006
  rig.rotation.y = damp(rig.rotation.y, targetYaw + reactSpin, 3.5, dt)
  rig.rotation.x = damp(rig.rotation.x, targetPitch, 4.0, dt)
  rig.rotation.z = Math.sin(t * 0.63) * 0.011 + sad * Math.sin(t * 7.5) * 0.0045
  rig.scale.setScalar(introScale * (1 + Math.sin(t * 1.6) * 0.0022))

  /* tear */
  if (state.sad > 0.45 && t > state.nextTear) {
    startTear()
    state.nextTear = t + 1.55
  }
  if (tear.active && tear.sprite) {
    tear.t += dt
    const p = clamp(tear.t / tear.dur, 0, 1)
    if (p >= 1) {
      tear.active = false
      tear.sprite.visible = false
      tear.sprite.material.opacity = 0
    } else {
      tear.sprite.position.y = 0.598 - 0.058 * easeInQuad(p)
      tear.sprite.material.opacity = Math.sin(Math.PI * clamp(p * 1.05, 0, 1)) * 0.9
      const sc = 0.044 * (1 - 0.15 * p)
      tear.sprite.scale.set(sc, sc * 1.5, 1)
    }
  }

  /* hearts */
  for (const h of hearts) {
    if (h.life <= 0) continue
    h.life -= dt
    if (h.life <= 0) {
      h.sprite.visible = false
      h.sprite.material.opacity = 0
      continue
    }
    h.sprite.position.x += h.vx * dt
    h.sprite.position.y += h.vy * dt
    h.sprite.position.z += h.vz * dt
    const p = 1 - h.life / h.max
    h.sprite.material.opacity = Math.sin(Math.PI * clamp(p * 1.05, 0, 1)) * 0.82
    h.sprite.material.rotation += h.spin * dt
    h.sprite.scale.setScalar(0.05 + p * 0.02)
  }

  if (renderer && scene && camera) renderer.render(scene, camera)
}

/* ---------------- resize / cleanup ---------------- */
function onResize() {
  const host = hostRef.value
  if (!host || !renderer || !camera) return
  const w = host.clientWidth || 210
  const h = host.clientHeight || 210
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function disposeAll() {
  disposed = true
  cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  resizeObserver = null
  scene?.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial
      mat.map?.dispose()
      mat.emissiveMap?.dispose()
      mat.dispose()
    }
  })
  heartTex.dispose()
  tear.sprite?.material.map?.dispose()
  scene?.clear()
  renderer?.dispose()
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }
  renderer = null
  scene = null
  camera = null
}

/* ---------------- public api ---------------- */
function setPointer(x: number, y: number) {
  state.pointer.set(clamp(x, -1, 1), clamp(y, -1, 1))
  state.pointerActive = true
}

defineExpose({
  setMood: (mood: 'happy' | 'sad' | 'blink' | 'clear') => {
    switch (mood) {
      case 'happy':
        setMoodHappy()
        break
      case 'sad':
        setMoodSad()
        break
      case 'blink':
        blink.trigger()
        state.reactT = 0
        break
      case 'clear':
        clearMood()
        break
    }
  },
  setPointer,
})

onMounted(async () => {
  initThree()
  try {
    await loadAssets()
    emit('ready')
  } catch (err) {
    console.error('[RobotLive] 模型加载失败：', err)
  }
  animate()
})

onBeforeUnmount(() => {
  disposeAll()
})
</script>

<style scoped>
.robot-live {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
