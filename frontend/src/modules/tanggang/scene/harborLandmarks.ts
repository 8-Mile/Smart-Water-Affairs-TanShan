// Source XY are DWG text anchors in 5188 local coordinates. All dimensions below
// are illustrative display units; they do not describe built footprints or elevations.
export const landmarksSource = 'de51fe02e029c880f9cee8e9ff0bc060e449603f4c213aef485ad161f3accd47'
// 人工湖表现湖心相对 CAD 文字点的偏移（displayXZ）。岸线为表现层构造，
// 标牌引线落在可见湖岸上，源文字点仍用于追溯与详情。
export const lakeDisplayOffset = { x: 7.3, z: 1.3 }
// evidenceLevel 只描述位置证据，不描述体量：anchor_only 表示仅有 CAD 文字锚点，
// 图内未找到可用于建模的闭合轮廓；contour_matched 表示有源闭合几何可对齐。
export type Landmark = { handle:string; name:string; layer:string; x:number; z:number; kind:string; width:number; depth:number; height:number; evidence?:string; evidenceLevel?:'anchor_only'|'contour_matched'; footprintHandle?:string }
export const landmarks: Landmark[] = [
  {
    "handle": "1028AB",
    "name": "人工湖",
    "layer": "---辅建区",
    "x": 27.007,
    "z": -42.349,
    "kind": "lake",
    "width": 7.8,
    "depth": 4.7,
    "height": 0.09,
    "evidenceLevel": "anchor_only",
    "evidence": "CAD 文字锚点 1028AB（图层 $TD_AUDIT_GENERATED_(F7C5E)，即人工湖）。源图 ±55m 内无闭合岸线、水面填充或护岸线，仅周边乔木图例留白；位置有据，岸线待核，水面为表现层构造。"
  },
  {
    "handle": "F9BEE",
    "name": "唐山港智慧中心",
    "layer": "---辅建区",
    "x": 33.903,
    "z": -29.593,
    "kind": "office",
    "width": 5.75,
    "depth": 2.5,
    "height": 2.75,
    "evidenceLevel": "contour_matched",
    "footprintHandle": "2AA962",
    "evidence": "CAD 文字锚点 F9BEE（图层 $TD_AUDIT_GENERATED_(F7C5E)，即唐山港智慧中心）。文字点落在原图 $pm单体 闭合轮廓 2AA962 内，该轮廓 13 点、约 64m×19.6m，现按此轮廓落位。轮廓归属仍待单体平面核准；层数与高度为示意。"
  },
  {
    "handle": "8D367",
    "name": "办公楼",
    "layer": "02首钢矿石码头",
    "x": 29.46,
    "z": 18.22,
    "kind": "office",
    "width": 5.5,
    "depth": 2.4,
    "height": 2.5,
    "evidenceLevel": "anchor_only",
    "evidence": "首钢矿石码头参照区 CAD 文字锚点 8D367（图层 02首钢矿石码头，即办公楼）。源图未找到该栋建筑基底闭合轮廓，体量为示意。"
  },
  {
    "handle": "8D368",
    "name": "食堂",
    "layer": "02首钢矿石码头",
    "x": 38.96,
    "z": 23.44,
    "kind": "workshop",
    "width": 3.2,
    "depth": 2,
    "height": 1.35,
    "evidenceLevel": "anchor_only",
    "evidence": "首钢矿石码头参照区 CAD 文字锚点 8D368（图层 02首钢矿石码头，即食堂）。源图未找到该栋建筑基底闭合轮廓，体量为示意。"
  },
  {
    "handle": "8D36A",
    "name": "联检楼",
    "layer": "02首钢矿石码头",
    "x": 39.2,
    "z": 18.18,
    "kind": "office",
    "width": 3.6,
    "depth": 2.1,
    "height": 2.0,
    "evidenceLevel": "anchor_only",
    "evidence": "首钢矿石码头参照区 CAD 文字锚点 8D36A（图层 02首钢矿石码头，即联检楼）。源图未找到该栋建筑基底闭合轮廓，体量为示意。"
  },
  {
    "handle": "8D372",
    "name": "停车场",
    "layer": "---辅建区",
    "x": 32.478,
    "z": 1.655,
    "kind": "parking",
    "width": 6.2,
    "depth": 4.1,
    "height": 0.07
  },
  {
    "handle": "F9BDE",
    "name": "危险废物暂存库",
    "layer": "---辅建区",
    "x": 24.69,
    "z": -14.015,
    "kind": "workshop",
    "width": 2.8,
    "depth": 1.8,
    "height": 1.25
  },
  {
    "handle": "F9BF9",
    "name": "物资仓库",
    "layer": "---辅建区",
    "x": 35.298,
    "z": -20.282,
    "kind": "workshop",
    "width": 4.6,
    "depth": 2.1,
    "height": 1.6
  },
  {
    "handle": "F9BFB",
    "name": "港机维修车间",
    "layer": "---辅建区",
    "x": 25.095,
    "z": -20.348,
    "kind": "workshop",
    "width": 4.75,
    "depth": 2.5,
    "height": 1.65
  },
  {
    "handle": "12F87C",
    "name": "环保车房",
    "layer": "---辅建区",
    "x": 40.129,
    "z": -14.336,
    "kind": "workshop",
    "width": 2.8,
    "depth": 1.7,
    "height": 1.22
  },
  {
    "handle": "12F87A",
    "name": "洗车房",
    "layer": "$pm单体",
    "x": 36.77,
    "z": -13.99,
    "kind": "workshop",
    "width": 2.6,
    "depth": 1.5,
    "height": 1.24
  },
  {
    "handle": "F9BEF",
    "name": "1#变电所及地源热泵机房",
    "layer": "---辅建区",
    "x": 25.77,
    "z": -32.756,
    "kind": "workshop",
    "width": 3.1,
    "depth": 1.8,
    "height": 1.45
  },
  {
    "handle": "12F861",
    "name": "食堂及库场楼",
    "layer": "$pm单体",
    "x": 7.48,
    "z": -51.27,
    "kind": "office",
    "width": 4.2,
    "depth": 1.8,
    "height": 1.75
  },
  {
    "handle": "1AFB89",
    "name": "生态空间提升泵站",
    "layer": "$管综-雨水",
    "x": 26.54,
    "z": -37.15,
    "kind": "workshop",
    "width": 1.65,
    "depth": 1.25,
    "height": 1.1
  },
  {
    "handle": "139AAA",
    "name": "一体化生活污水处理设施",
    "layer": "$管综-生活污水",
    "x": 36.05,
    "z": -27.64,
    "kind": "treatment",
    "width": 2.6,
    "depth": 1.7,
    "height": 1.15
  },
  {
    "handle": "1058D8",
    "name": "链斗冲洗池",
    "layer": "$pm单体",
    "x": 13.71,
    "z": -58.59,
    "kind": "pool",
    "width": 2.0,
    "depth": 1.25,
    "height": 0.23
  },
  {
    "handle": "103415",
    "name": "生态蓄水池",
    "layer": "$pm单体",
    "x": -13.35,
    "z": 45.08,
    "kind": "pool",
    "width": 5.1,
    "depth": 2.25,
    "height": 0.23,
    "evidenceLevel": "anchor_only",
    "evidence": "CAD 文字锚点 103415（图层 $pm单体，x=-13.35、z=45.08）。与 10340E 是同名“生态蓄水池”的两处相邻文字点，相距约 16.5 个场景单位；源图没有核出两座独立池体轮廓。现仅保留文字锚点与候选边框，不表示两座已建水池。"
  },
  {
    "handle": "10340E",
    "name": "生态蓄水池",
    "layer": "$pm单体",
    "x": 3.13,
    "z": 45.08,
    "kind": "pool",
    "width": 5.1,
    "depth": 2.25,
    "height": 0.23,
    "evidenceLevel": "anchor_only",
    "evidence": "CAD 文字锚点 10340E（图层 $pm单体，x=3.13、z=45.08）。与 103415 是同名“生态蓄水池”的两处相邻文字点，相距约 16.5 个场景单位；源图没有核出两座独立池体轮廓。现仅保留文字锚点与候选边框，不表示两座已建水池。"
  },
  {
    "handle": "FAC60",
    "name": "集水池",
    "layer": "$pm单体",
    "x": 8.33183,
    "z": 39.86324,
    "kind": "pool",
    "width": 6.0,
    "depth": 3.8,
    "height": 0.23,
    "evidenceLevel": "anchor_only",
    "evidence": "CAD 文字锚点 FAC60 经 TG-CAD-09「北部集水池（原图“集水池”）」定位（x=8.33183、z=39.86324）。源图设计北池 2 座，本处与 10B85C 成组；池体轮廓与单池身份待核，水面与池壁为 L1 示意。进深为默认机位可读性示意。"
  },
  {
    "handle": "10B85C",
    "name": "集水池",
    "layer": "$管综-雨水",
    "x": -24.42,
    "z": 39.93,
    "kind": "pool",
    "width": 6.0,
    "depth": 3.8,
    "height": 0.23,
    "evidenceLevel": "anchor_only",
    "evidence": "CAD 文字锚点 10B85C（图层 $管综-雨水）。与 FAC60 同为北侧集水池设计 2 座的位置来源；池体轮廓与单池身份待核。"
  },
  {
    "handle": "10AE0B",
    "name": "集水池",
    "layer": "$管综-雨水",
    "x": -17.78064,
    "z": -42.6,
    "kind": "pool",
    "width": 6.2,
    "depth": 2.6,
    "height": 0.23,
    "evidenceLevel": "anchor_only",
    "evidence": "CAD 文字锚点 10AE0B 经 TG-CAD-10「南部集水池（原图“集水池”）」定位（x=-17.78064、z=-46.49161）。与 10AE12、10AE14、10AE0E、10AE10 组成南池设计 5 座；池体轮廓待核。为避开前置管架遮挡，首页显示位置较文字点贴靠堆场南缘并北移约 3.9 单位；进深为可读性示意，不是实测池壁尺寸。"
  },
  {
    "handle": "10AE12",
    "name": "集水池",
    "layer": "$管综-雨水",
    "x": -34.28,
    "z": -42.6,
    "kind": "pool",
    "width": 6.6,
    "depth": 2.6,
    "height": 0.23
  },
  {
    "handle": "10AE14",
    "name": "集水池",
    "layer": "$管综-雨水",
    "x": -8.39,
    "z": -42.6,
    "kind": "pool",
    "width": 5.6,
    "depth": 2.6,
    "height": 0.23
  },
  {
    "handle": "10AE0E",
    "name": "集水池",
    "layer": "$管综-雨水",
    "x": -1.2,
    "z": -42.6,
    "kind": "pool",
    "width": 5.0,
    "depth": 2.6,
    "height": 0.23
  },
  {
    "handle": "10AE10",
    "name": "集水池",
    "layer": "$管综-雨水",
    "x": 15.48,
    "z": -42.6,
    "kind": "pool",
    "width": 6.4,
    "depth": 2.6,
    "height": 0.23
  }
]
