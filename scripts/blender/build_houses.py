# Builds megawatt.fun house models in Blender (Z-up, meters), exports Y-up glb.
import bpy, math, os, sys
OUT = sys.argv[sys.argv.index("--")+1] if "--" in sys.argv else "."
PAL = {  # Base public palette (flat colors)
 "wall": (0.941,0.933,0.922), "wall2": (0.847,0.843,0.835), "roof": (0.161,0.157,0.149),
 "trim": (1,1,1), "door": (0.118,0.302,0.169), "glass": (0.016,0.557,0.898),
 "battery": (0.698,0.867,0.475), "batt_dark": (0.063,0.165,0.090), "garage": (0.329,0.322,0.310),
 "solar": (0.063,0.165,0.090), "concrete": (0.76,0.75,0.73)}
def srgb(c): return tuple(((x+0.055)/1.055)**2.4 if x>0.04045 else x/12.92 for x in c)
MATS={}
def mat(n):
    if n in MATS: return MATS[n]
    m=bpy.data.materials.new(n); m.use_nodes=True
    b=m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value=(*srgb(PAL[n]),1)
    b.inputs["Roughness"].default_value=0.25 if n=="glass" else 0.8
    MATS[n]=m; return m
def box(name,sx,sy,sz,x,y,z,m,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,y,z)); o=bpy.context.object
    o.name=name; o.scale=(sx,sy,sz); o.data.materials.append(mat(m))
    if parent: o.parent=parent
    return o
def gable(name,w,d,h,x,y,z,overhang=0.35,axis="x"):
    # triangular prism roof; ridge along axis
    import bmesh
    me=bpy.data.meshes.new(name); o=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(o)
    bm=bmesh.new(); W=w/2+overhang; D=d/2+overhang
    if axis=="x":
        pts=[(-W,-D,0),(W,-D,0),(W,D,0),(-W,D,0),(-W,0,h),(W,0,h)]
        faces=[(0,1,5,4),(2,3,4,5),(0,4,3),(1,2,5),(0,3,2,1)]
    else:
        pts=[(-W,-D,0),(W,-D,0),(W,D,0),(-W,D,0),(0,-D,h),(0,D,h)]
        faces=[(1,2,5,4),(3,0,4,5),(0,1,4),(2,3,5),(0,3,2,1)]
    vs=[bm.verts.new(p) for p in pts]
    for f in faces: bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
    o.location=(x,y,z); me.materials.append(mat("roof")); return o
def window(x,y,z,w,h,face="front"):
    # face front = -Y in Blender (becomes +Z in glTF after Y-up conversion)
    t=0.06
    if face=="front": box("Window",w,t,h,x,y-0.02,z,"glass"); box("Sill",w+0.15,0.12,0.06,x,y-0.06,z-h/2-0.03,"trim")
    elif face=="side": box("Window",t,w,h,x+0.02,y,z,"glass")
def battery(x,y,z,face="side_px"):
    # Base-style wall unit ~0.8w x 0.3d x 1.2h on +X side wall
    b=box("Battery",0.30,0.80,1.20,x,y,z,"battery")
    box("BatteryBand",0.31,0.80,0.10,x,y,z+0.35,"batt_dark",parent=None).parent=None
    box("BatteryPad",0.6,1.1,0.08,x,y,0.04,"concrete")
    return b
def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
def export(name):
    import mathutils
    xs=[];ys=[]
    for o in bpy.data.objects:
        if o.type=="MESH" and o.name.split(".")[0] in ("Walls","Wing","Garage"):
            for c in o.bound_box:
                v=o.matrix_world @ mathutils.Vector(c); xs.append(v.x); ys.append(v.y)
    cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2
    for o in bpy.data.objects:
        if o.parent is None: o.location.x-=cx; o.location.y-=cy
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active=bpy.data.objects[0]
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f"house-{name}.glb"),export_format="GLB",export_yup=True,export_apply=True)

# Front faces -Y in Blender. glTF Y-up conversion maps Blender -Y to glTF +Z. 
def bungalow():
    clear(); W,D,H=9.0,8.0,3.0
    box("Walls",W,D,H,0,0,H/2,"wall")
    box("Porch",3.2,1.8,0.25,-1.5,-D/2-0.9,0.125,"concrete")
    box("PorchPostL",0.15,0.15,2.6,-2.9,-D/2-1.65,1.3,"trim"); box("PorchPostR",0.15,0.15,2.6,-0.1,-D/2-1.65,1.3,"trim")
    box("PorchRoof",3.6,2.0,0.15,-1.5,-D/2-0.9,2.8,"roof")
    box("Door",1.0,0.08,2.1,-1.5,-D/2-0.02,1.05,"door")
    window(1.8,-D/2,1.6,1.6,1.3); window(-3.6,-D/2,1.6,1.0,1.3)
    window(W/2,1.5,1.6,1.4,1.2,"side")
    gable("Roof",W,D,2.4,0,0,H,axis="x")
    box("Chimney",0.7,0.7,1.8,2.5,1.5,H+1.6,"wall2")
    battery(W/2+0.17,-1.8,1.0); export("bungalow")
def suburban():
    clear(); W,D,H=11.0,9.0,5.8
    box("Walls",W,D,H,0,0,H/2,"wall")
    box("Garage",6.0,7.0,3.0,W/2+3.0,-1.0,1.5,"wall2")
    box("GarageDoor",4.8,0.08,2.3,W/2+3.0,-4.5-0.02,1.15,"garage")
    gable("GarageRoof",6.0,7.0,1.6,W/2+3.0,-1.0,3.0,overhang=0.3,axis="y")
    box("Door",1.1,0.08,2.2,-1.0,-D/2-0.02,1.1,"door")
    box("Stoop",2.2,1.2,0.2,-1.0,-D/2-0.6,0.1,"concrete")
    for x in (-3.8,1.6): window(x,-D/2,1.5,1.4,1.3)
    for x in (-3.8,-1.0,1.6,3.8): window(x,-D/2,4.3,1.2,1.2)
    window(-W/2-0.08,0,4.3,1.2,1.2,"side")
    gable("Roof",W,D,2.8,0,0,H,axis="x")
    for i in range(3):
        box("SolarPanel",1.0,1.7,0.05,-3+i*1.15,-2.2,H+1.25,"solar").rotation_euler=(math.radians(-32),0,0)
    battery(W/2+6.0+0.17,1.0,1.0); export("suburban")
def ranch():
    clear(); W,D,H=20.0,10.0,3.2
    box("Walls",W,D,H,0,0,H/2,"wall")
    box("Wing",8.0,8.0,H,-W/2+4.0,D/2+3.0,H/2,"wall")
    gable("Roof",W,D,2.2,0,0,H,overhang=0.6,axis="x")
    gable("WingRoof",8.0,8.0,2.2,-W/2+4.0,D/2+3.0,H,overhang=0.6,axis="y")
    box("Porch",12.0,2.4,0.2,1.0,-D/2-1.2,0.1,"concrete")
    box("PorchRoof",12.6,2.6,0.15,1.0,-D/2-1.2,2.9,"roof")
    for x in (-5,-1,3,7): box("PorchPost",0.18,0.18,2.8,x,-D/2-2.3,1.4,"trim")
    box("Door",1.2,0.08,2.2,1.0,-D/2-0.02,1.1,"door")
    for x in (-7,-3.5,4.5,8): window(x,-D/2,1.6,1.6,1.3)
    box("GarageDoor",0.08,5.0,2.4,W/2+0.02,1.5,1.2,"garage")
    box("Chimney",0.9,0.9,2.0,-6,1.0,H+1.6,"wall2")
    battery(W/2+0.17,-3.0,1.0); export("ranch")
bungalow(); suburban(); ranch(); print("BUILT")
