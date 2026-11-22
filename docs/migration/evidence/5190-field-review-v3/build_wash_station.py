"""唐港 L1 洗车台外观样件，显示单位。锚点由 Three.js 管理。用 Blender -b -P 本文件运行。"""
import math
from pathlib import Path
import bpy
from mathutils import Vector, Euler

folder = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
palette = {
    'Concrete': ('aeb4ac', .88, .02), 'Wet slab': ('586a70', .65, .04),
    'Steel': ('435766', .5, .32), 'Roof': ('b8c8d2', .57, .2),
    'Fascia': ('416984', .48, .23), 'Louvres': ('859da6', .48, .26),
    'Grating': ('38464a', .66, .21), 'Pipe': ('55839a', .44, .34),
}
parts = {name: ([], []) for name in palette}

def component(material, vertices, faces):
    coords, polys = parts[material]
    base = len(coords)
    coords.extend(vertices)
    polys.extend(tuple(base+i for i in face) for face in faces)

def box(material, center, dims, rotation=None):
    orientation = Euler(rotation or (0,0,0)).to_matrix()
    c = Vector(center)
    coords = [tuple(c + orientation @ Vector((sx*dims[0]/2,sy*dims[1]/2,sz*dims[2]/2)))
              for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    component(material,coords,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

def rod(material,a,b,r,steps=8):
    a,b=Vector(a),Vector(b); direction=(b-a).normalized()
    axis=Vector((0,0,1)) if abs(direction.z)<.9 else Vector((0,1,0))
    u=direction.cross(axis).normalized()*r;v=direction.cross(u).normalized()*r
    ends=[tuple(o+u*math.cos(2*math.pi*i/steps)+v*math.sin(2*math.pi*i/steps)) for o in [a,b] for i in range(steps)]
    faces=[(i,(i+1)%steps,steps+(i+1)%steps,steps+i) for i in range(steps)]
    component(material, ends, faces+[tuple(reversed(range(steps))),tuple(range(steps,2*steps))])

# The front apron is exposed. Routes through the canopy remain open at both ends.
box('Concrete',(0,0,.047),(8.62,12.35,.094))
box('Wet slab',(0,-.12,.103),(6.84,10.82,.036))
for x in [-2.12,2.12]:
    box('Grating',(x,-1.10,.143),(1.56,5.7,.045))
    for j in range(11):
        box('Louvres',(x,-3.66+j*.50,.181),(1.48,.095,.031))
for x in [-3.80,3.80]:
    box('Concrete',(x,-1.30,.168),(.27,7.55,.14))
    for y in [-1.55,1.35,4.52]:
        box('Concrete',(x,y,.222),(.51,.52,.26))
        box('Steel',(x,y,1.28),(.15,.22,2.0))
        box('Fascia',(x,y,.59),(.181,.24,.40))
        rod('Steel',(x,y,1.55),(x*.75,y,2.19),.061)
for y in [-1.55,1.35,4.52]:
    box('Steel',(0,y,2.24),(7.95,.18,.20))
# Shallow gable with broad roof planes and a readable shadow under its leading edge.
for sign in [-1,1]:
    slope=.084; w=4.23; a=sign * math.atan(slope)
    box('Roof',(sign*w*.5,1.48,2.55),(w*math.sqrt(1+slope*slope),6.7,.15),(0,a,0))
    box('Fascia',(sign*w,1.48,2.32),(.115,6.79,.22))
    for y in [-1.88,4.82]:
        box('Fascia',(sign*w*.5,y,2.48),(w*math.sqrt(1+slope*slope),.13,.19),(0,a,0))
    for x in [.95,2.9]:
        box('Louvres',(sign*x,1.48,2.55+(w/2-x)*slope+.085),(.065,6.52,.046),(0,a,0))
box('Roof',(0,1.48,2.76),(.17,6.78,.10))
# The grated drain in the approach is a local display feature without an inferred outlet.
box('Grating',(0,-4.55,.143),(6.78,.46,.044))
for j in range(21):
    box('Louvres',(-3.12+.31*j,-4.55,.172),(.085,.42,.018))
for x in [-3.38,3.38]:
    rod('Pipe',(x,-3.45,.31),(x,2.55,.31),.094)
    for y in [-3.18,-.60,1.95]:
        rod('Pipe',(x,y,.31),(x,y,.79),.065)
        rod('Louvres',(x,y,.79),(x*.956,y,.79),.062)
for name,(hexval,rough,metal) in palette.items():
    mat=bpy.data.materials.new(name); mat.use_nodes=True; node=mat.node_tree.nodes.get('Principled BSDF')
    srgb=[int(hexval[i:i+2],16)/255 for i in (0,2,4)]
    linear=[n/12.92 if n<=.04045 else ((n+.055)/1.055)**2.4 for n in srgb]
    node.inputs['Base Color'].default_value=(*linear,1);node.inputs['Roughness'].default_value=rough;node.inputs['Metallic'].default_value=metal
    vs,fs=parts[name];mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(mat)
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'wash-station-l1.blend'))
bpy.ops.export_scene.gltf(filepath=str(folder/'wash-station-l1.glb'),export_format='GLB',export_yup=True)
