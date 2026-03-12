"""
NovaUniverse — Blender Asset Pipeline
======================================
Procedurally generates all zone hero assets from Kenney GLBs + custom geometry.
Runs headless — no GUI needed.

USAGE:
  blender --background --python scripts/blender/build_world.py

  Or per-zone:
  blender --background --python scripts/blender/build_world.py -- --zone trading_floor

REQUIREMENTS:
  - Blender 4.x installed
  - Kenney GLBs already extracted to public/kenney/models/
  - Output goes to public/kenney/models/custom/

FILE STRUCTURE:
  NovaUniverse/
  ├── scripts/
  │   └── blender/
  │       ├── build_world.py      ← this file (master runner)
  │       ├── zones/
  │       │   ├── trading_floor.py
  │       │   ├── intel_hub.py
  │       │   ├── command_center.py
  │       │   ├── launchpad.py
  │       │   ├── watchtower.py
  │       │   ├── agora.py
  │       │   └── burn_furnace.py
  │       └── lib/
  │           ├── scene.py        ← scene setup helpers
  │           ├── kenney.py       ← import Kenney GLBs
  │           ├── nova_brand.py   ← Nova logo, neon strips, signs
  │           └── export.py       ← GLB export helpers
  └── public/kenney/models/
      ├── commercial/
      ├── industrial/
      ├── suburban/
      ├── cars/
      ├── characters/
      └── custom/                 ← generated output
"""

import bpy
import sys
import os
import math

# ── Path resolution ────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
KENNEY_DIR  = os.path.join(PROJECT_DIR, 'public', 'kenney', 'models')
OUT_DIR     = os.path.join(KENNEY_DIR, 'custom')
os.makedirs(OUT_DIR, exist_ok=True)

sys.path.insert(0, os.path.join(SCRIPT_DIR, 'lib'))


# ══════════════════════════════════════════════════════════════════════════════
# LIB — scene.py  (inline for single-file distribution)
# ══════════════════════════════════════════════════════════════════════════════

def scene_clear():
    """Wipe everything from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


def scene_lighting():
    """Set up a basic light rig for preview (not exported)."""
    bpy.ops.object.light_add(type='SUN', location=(5, 5, 10))
    sun = bpy.context.active_object
    sun.data.energy = 3.0


# ══════════════════════════════════════════════════════════════════════════════
# LIB — kenney.py
# ══════════════════════════════════════════════════════════════════════════════

def import_glb(pack: str, filename: str) -> bpy.types.Object:
    """
    Import a Kenney GLB and return the top-level empty/object.
    pack     = 'commercial' | 'industrial' | 'suburban' | 'cars' | 'characters'
    filename = 'building-a' (no extension)
    """
    path = os.path.join(KENNEY_DIR, pack, f'{filename}.glb')
    if not os.path.exists(path):
        raise FileNotFoundError(f'GLB not found: {path}')

    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    after  = set(bpy.data.objects.keys())

    new_objects = list(after - before)
    # Return the root — the object with no parent among the new ones
    roots = [bpy.data.objects[n] for n in new_objects if bpy.data.objects[n].parent is None]
    return roots[0] if roots else bpy.data.objects[new_objects[0]]


def place(obj: bpy.types.Object, x=0, y=0, z=0, rot_z=0, scale=1.0):
    """Position, rotate and scale an object."""
    obj.location    = (x, y, z)
    obj.rotation_euler[2] = math.radians(rot_z)
    obj.scale       = (scale, scale, scale)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(scale=True)


def fix_pivot_to_base(obj: bpy.types.Object):
    """Move object origin to the bottom centre of its bounding box."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    # Now move origin down to base
    min_z = min((obj.matrix_world @ v.co).z for v in obj.data.vertices) if hasattr(obj.data, 'vertices') else 0
    obj.location.z -= min_z


# ══════════════════════════════════════════════════════════════════════════════
# LIB — nova_brand.py
# ══════════════════════════════════════════════════════════════════════════════

def make_emissive_material(name: str, color: tuple, strength=3.0) -> bpy.types.Material:
    """Create an emissive material (neon glow effect)."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()

    output   = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value    = (*color, 1.0)
    emission.inputs['Strength'].default_value = strength

    mat.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return mat


def make_glass_material(name: str, color: tuple) -> bpy.types.Material:
    """Dark tinted glass for windows."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()

    output  = nodes.new('ShaderNodeOutputMaterial')
    bsdf    = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value    = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value      = 0.0
    bsdf.inputs['Roughness'].default_value     = 0.05
    bsdf.inputs['Alpha'].default_value         = 0.3
    mat.blend_method = 'BLEND'

    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    return mat


def add_neon_strip(
    parent_obj: bpy.types.Object,
    width: float, height: float,
    x=0, y=0, z=0,
    color=(0, 1, 0.5),
    strength=4.0,
    name='neon_strip'
) -> bpy.types.Object:
    """Add a glowing neon strip (flat plane with emissive material)."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    strip = bpy.context.active_object
    strip.name = name
    strip.scale    = (width, 0.05, height)
    strip.location = (x, y, z)
    bpy.ops.object.transform_apply(scale=True)

    mat = make_emissive_material(f'mat_{name}', color, strength)
    strip.data.materials.append(mat)

    strip.parent = parent_obj
    return strip


def add_logo_panel(
    parent_obj: bpy.types.Object,
    x=0, y=0, z=0,
    rot_z=0,
    scale=1.0,
    color=(0, 1, 0.5),
    name='logo_panel'
) -> bpy.types.Object:
    """
    Add a stylised NOVA logo panel — N shape approximated with 3 planes.
    This is a placeholder shape; replace with a proper mesh if you want text.
    """
    container = new_empty(name, x, y, z)
    container.parent = parent_obj

    mat = make_emissive_material(f'mat_{name}', color, strength=5.0)

    # Left vertical bar
    bpy.ops.mesh.primitive_cube_add(size=1)
    left = bpy.context.active_object
    left.scale = (0.08 * scale, 0.02 * scale, 0.4 * scale)
    left.location = (-0.18 * scale, 0, 0)
    left.data.materials.append(mat)
    left.parent = container
    bpy.ops.object.transform_apply(scale=True)

    # Right vertical bar
    bpy.ops.mesh.primitive_cube_add(size=1)
    right = bpy.context.active_object
    right.scale = (0.08 * scale, 0.02 * scale, 0.4 * scale)
    right.location = (0.18 * scale, 0, 0)
    right.data.materials.append(mat)
    right.parent = container
    bpy.ops.object.transform_apply(scale=True)

    # Diagonal connector (approximate N diagonal)
    bpy.ops.mesh.primitive_cube_add(size=1)
    diag = bpy.context.active_object
    diag.scale = (0.05 * scale, 0.02 * scale, 0.45 * scale)
    diag.location = (0, 0, 0)
    diag.rotation_euler = (0, 0, math.radians(20))
    diag.data.materials.append(mat)
    diag.parent = container
    bpy.ops.object.transform_apply(scale=True, rotation=True)

    container.rotation_euler[2] = math.radians(rot_z)
    return container


def new_empty(name: str, x=0, y=0, z=0) -> bpy.types.Object:
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(x, y, z))
    e = bpy.context.active_object
    e.name = name
    return e


def add_window_row(
    parent_obj: bpy.types.Object,
    count: int,
    start_x: float, start_z: float,
    spacing: float, y_offset: float,
    win_w=0.12, win_h=0.18,
    color=(0, 0.8, 1.0),
    name_prefix='window'
):
    """Add a row of glowing windows to a building face."""
    mat = make_emissive_material(f'mat_{name_prefix}', color, strength=2.0)
    for i in range(count):
        bpy.ops.mesh.primitive_plane_add(size=1)
        win = bpy.context.active_object
        win.name = f'{name_prefix}_{i}'
        win.scale = (win_w, 0.01, win_h)
        win.location = (start_x + i * spacing, y_offset, start_z)
        win.data.materials.append(mat)
        win.parent = parent_obj
        bpy.ops.object.transform_apply(scale=True)


# ══════════════════════════════════════════════════════════════════════════════
# LIB — export.py
# ══════════════════════════════════════════════════════════════════════════════

def export_glb(filename: str, selected_only=False):
    """Export current scene (or selection) as GLB to the custom output dir."""
    out_path = os.path.join(OUT_DIR, f'{filename}.glb')
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=selected_only,
        export_animations=True,
        export_materials='EXPORT',
        export_apply=True,          # apply all modifiers
        export_yup=True,            # Three.js uses Y-up
        export_texcoords=True,
        export_normals=True,
        export_colors=True,
    )
    print(f'  ✓ Exported: {out_path}')
    return out_path


# ══════════════════════════════════════════════════════════════════════════════
# ZONE BUILDERS
# ══════════════════════════════════════════════════════════════════════════════

def build_trading_floor():
    """
    Nova Tower — Finance district landmark.
    Skyscraper + NOVA logo + green neon window strips + LP pool sculpture.
    """
    print('\n[trading_floor] Building Nova Tower...')
    scene_clear()

    # ── Base tower ──────────────────────────────────────────────────────────
    tower = import_glb('commercial', 'building-skyscraper-a')
    place(tower, x=0, y=0, z=0, scale=1.0)
    fix_pivot_to_base(tower)

    # ── NOVA logo on south face ─────────────────────────────────────────────
    add_logo_panel(tower, x=0, y=-0.52, z=2.8, color=(0.0, 1.0, 0.53), scale=0.9, name='nova_logo_s')
    add_logo_panel(tower, x=0, y= 0.52, z=2.8, color=(0.0, 1.0, 0.53), scale=0.9, name='nova_logo_n')

    # ── Neon strips: green horizontal bands every floor ─────────────────────
    for floor in range(6):
        z = 0.4 + floor * 0.55
        add_neon_strip(tower, width=0.9, height=0.04,
                       x=0, y=-0.51, z=z,
                       color=(0.0, 1.0, 0.53), strength=3.0,
                       name=f'neon_s_{floor}')
        add_neon_strip(tower, width=0.9, height=0.04,
                       x=0, y= 0.51, z=z,
                       color=(0.0, 1.0, 0.53), strength=3.0,
                       name=f'neon_n_{floor}')

    # ── Window rows ─────────────────────────────────────────────────────────
    for floor in range(8):
        z = 0.5 + floor * 0.48
        add_window_row(tower, count=5, start_x=-0.4, start_z=z,
                       spacing=0.2, y_offset=-0.50,
                       color=(0.0, 1.0, 0.53), name_prefix=f'win_f_{floor}')

    # ── Antenna spire ────────────────────────────────────────────────────────
    bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.8, location=(0, 0, 4.8))
    spire = bpy.context.active_object
    spire.name = 'antenna_spire'
    mat = make_emissive_material('mat_spire', (1.0, 0.2, 0.2), strength=8.0)
    spire.data.materials.append(mat)
    spire.parent = tower

    export_glb('nova-tower')
    print('[trading_floor] ✓ nova-tower.glb')


    # ── LP Pool (separate asset) ─────────────────────────────────────────────
    print('[trading_floor] Building LP Pool...')
    scene_clear()

    bpy.ops.mesh.primitive_cylinder_add(radius=0.8, depth=0.12, vertices=32, location=(0, 0, 0.06))
    base = bpy.context.active_object
    base.name = 'pool_base'
    mat_base = bpy.data.materials.new('mat_pool_base')
    mat_base.use_nodes = True
    mat_base.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.04, 0.08, 0.1, 1.0)
    mat_base.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.3
    mat_base.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.2
    base.data.materials.append(mat_base)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.75, minor_radius=0.04, location=(0, 0, 0.13))
    rim = bpy.context.active_object
    rim.name = 'pool_rim'
    mat_rim = make_emissive_material('mat_pool_rim', (0.0, 1.0, 0.53), strength=4.0)
    rim.data.materials.append(mat_rim)

    # Inner glow disc
    bpy.ops.mesh.primitive_circle_add(radius=0.5, fill_type='NGON', location=(0, 0, 0.13))
    glow = bpy.context.active_object
    glow.name = 'pool_glow'
    mat_glow = make_emissive_material('mat_pool_glow', (0.0, 0.6, 0.4), strength=1.5)
    glow.data.materials.append(mat_glow)

    export_glb('lp-pool')
    print('[trading_floor] ✓ lp-pool.glb')


def build_intel_hub():
    """
    Satellite Array — Intel district landmark.
    Tower + satellite dishes + blinking antenna + data pillars.
    """
    print('\n[intel_hub] Building Satellite Array...')
    scene_clear()

    tower = import_glb('industrial', 'building-b')
    place(tower, scale=0.9)
    fix_pivot_to_base(tower)

    # ── Satellite dishes (3) ─────────────────────────────────────────────────
    for i, (x, y, z, rot) in enumerate([(-0.3, -0.4, 2.2, 30), (0.3, -0.4, 1.8, -20), (0, 0.5, 2.5, 0)]):
        # Dish arm
        bpy.ops.mesh.primitive_cylinder_add(radius=0.02, depth=0.3, location=(x, y, z))
        arm = bpy.context.active_object
        arm.rotation_euler = (math.radians(40), 0, math.radians(rot))
        bpy.ops.object.transform_apply(rotation=True)
        arm.parent = tower

        # Dish bowl (UV sphere flattened)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, location=(x, y - 0.18, z + 0.12))
        dish = bpy.context.active_object
        dish.scale.y = 0.15  # flatten into dish shape
        bpy.ops.object.transform_apply(scale=True)
        mat_dish = make_emissive_material(f'mat_dish_{i}', (0.0, 0.78, 1.0), strength=0.5)
        dish.data.materials.append(mat_dish)
        dish.parent = tower

    # ── Blue neon strips ─────────────────────────────────────────────────────
    for strip_z in [0.6, 1.2, 1.8, 2.4]:
        add_neon_strip(tower, width=0.85, height=0.03,
                       x=0, y=-0.42, z=strip_z,
                       color=(0.0, 0.78, 1.0), strength=3.5,
                       name=f'blue_strip_{strip_z}')

    # ── Blinking antenna light ────────────────────────────────────────────────
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.04, location=(0, 0, 3.1))
    blinker = bpy.context.active_object
    blinker.name = 'antenna_blinker'
    mat_blink = make_emissive_material('mat_blink', (1.0, 0.2, 0.2), strength=10.0)
    blinker.data.materials.append(mat_blink)
    blinker.parent = tower

    export_glb('satellite-array')
    print('[intel_hub] ✓ satellite-array.glb')

    # ── Data Pillar (separate) ────────────────────────────────────────────────
    print('[intel_hub] Building Data Pillar...')
    scene_clear()

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 2.0))
    pillar = bpy.context.active_object
    pillar.name = 'data_pillar'
    pillar.scale = (0.25, 0.25, 4.0)
    bpy.ops.object.transform_apply(scale=True)
    mat_dark = bpy.data.materials.new('mat_pillar_dark')
    mat_dark.use_nodes = True
    mat_dark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.04, 0.04, 0.08, 1.0)
    pillar.data.materials.append(mat_dark)

    # Vertical emissive strips on all 4 faces
    for face_rot in [0, 90, 180, 270]:
        add_neon_strip(pillar, width=0.05, height=3.6,
                       x=0.13 * math.cos(math.radians(face_rot)),
                       y=0.13 * math.sin(math.radians(face_rot)),
                       z=0,
                       color=(0.0, 0.78, 1.0), strength=4.0,
                       name=f'data_strip_{face_rot}')

    export_glb('data-pillar')
    print('[intel_hub] ✓ data-pillar.glb')


def build_command_center():
    """
    Nova HQ — Most imposing building. Purple. Two towers + bridge.
    """
    print('\n[command_center] Building Nova HQ...')
    scene_clear()

    # ── Tower A ──────────────────────────────────────────────────────────────
    t_a = import_glb('commercial', 'building-skyscraper-c')
    place(t_a, x=-0.7, y=0, z=0, scale=1.0)
    fix_pivot_to_base(t_a)

    # ── Tower B ──────────────────────────────────────────────────────────────
    t_b = import_glb('commercial', 'building-skyscraper-d')
    place(t_b, x=0.7, y=0, z=0, scale=1.0)
    fix_pivot_to_base(t_b)

    # ── Connecting bridge at mid-height ──────────────────────────────────────
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 2.0))
    bridge = bpy.context.active_object
    bridge.name = 'bridge'
    bridge.scale = (1.4, 0.3, 0.12)
    bpy.ops.object.transform_apply(scale=True)
    mat_bridge = bpy.data.materials.new('mat_bridge')
    mat_bridge.use_nodes = True
    mat_bridge.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.15, 0.05, 0.25, 1.0)
    mat_bridge.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.6
    bridge.data.materials.append(mat_bridge)

    # Bridge neon underside
    add_neon_strip(bridge, width=1.35, height=0.02,
                   x=0, y=0, z=-0.06,
                   color=(0.75, 0.25, 1.0), strength=5.0,
                   name='bridge_neon')

    # ── NOVA logo on bridge face ─────────────────────────────────────────────
    add_logo_panel(bridge, x=0, y=-0.16, z=0.1, color=(0.75, 0.25, 1.0), scale=0.6)

    # ── Purple neon strips on both towers ────────────────────────────────────
    for t_obj, x_offset in [(t_a, -0.7), (t_b, 0.7)]:
        for floor in range(7):
            z = 0.5 + floor * 0.5
            add_neon_strip(t_obj, width=0.8, height=0.035,
                           x=0, y=-0.45, z=z,
                           color=(0.75, 0.25, 1.0), strength=2.5,
                           name=f'purple_{x_offset}_{floor}')

    export_glb('nova-hq')
    print('[command_center] ✓ nova-hq.glb')


def build_launchpad():
    """
    Launch Pad — Pink/magenta. Octagonal platform + rocket.
    """
    print('\n[launchpad] Building Launch Pad...')
    scene_clear()

    # ── Octagonal platform ────────────────────────────────────────────────────
    bpy.ops.mesh.primitive_cylinder_add(
        radius=1.1, depth=0.18, vertices=8, location=(0, 0, 0.09))
    pad = bpy.context.active_object
    pad.name = 'launch_platform'
    mat_pad = bpy.data.materials.new('mat_launch_pad')
    mat_pad.use_nodes = True
    mat_pad.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.04, 0.06, 1.0)
    mat_pad.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.7
    mat_pad.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.3
    pad.data.materials.append(mat_pad)

    # Pad edge neon ring
    bpy.ops.mesh.primitive_torus_add(major_radius=1.05, minor_radius=0.03, location=(0, 0, 0.18))
    ring = bpy.context.active_object
    ring.name = 'pad_ring'
    mat_ring = make_emissive_material('mat_pad_ring', (1.0, 0.28, 0.72), strength=5.0)
    ring.data.materials.append(mat_ring)

    # Centre launch circle
    bpy.ops.mesh.primitive_circle_add(radius=0.4, fill_type='NGON', location=(0, 0, 0.19))
    centre = bpy.context.active_object
    mat_centre = make_emissive_material('mat_pad_centre', (1.0, 0.28, 0.72), strength=3.0)
    centre.data.materials.append(mat_centre)

    # Support struts (4x)
    for angle in [0, 90, 180, 270]:
        rad = math.radians(angle)
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.04, depth=0.3,
            location=(math.cos(rad) * 0.85, math.sin(rad) * 0.85, -0.06))
        strut = bpy.context.active_object
        strut.rotation_euler = (math.radians(15), 0, rad)
        bpy.ops.object.transform_apply(rotation=True)
        strut.parent = pad

    export_glb('launch-pad')
    print('[launchpad] ✓ launch-pad.glb')

    # ── Rocket ─────────────────────────────────────────────────────────────
    print('[launchpad] Building Rocket...')
    scene_clear()

    # Body
    bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=1.2, location=(0, 0, 0.9))
    body = bpy.context.active_object
    body.name = 'rocket_body'
    mat_body = bpy.data.materials.new('mat_rocket')
    mat_body.use_nodes = True
    mat_body.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.9, 0.95, 1.0)
    mat_body.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.8
    body.data.materials.append(mat_body)

    # Nose cone
    bpy.ops.mesh.primitive_cone_add(radius1=0.18, radius2=0, depth=0.5, location=(0, 0, 1.75))
    nose = bpy.context.active_object
    nose.data.materials.append(mat_body)

    # Fins (4x)
    for angle in [0, 90, 180, 270]:
        rad = math.radians(angle)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(
            math.cos(rad) * 0.28, math.sin(rad) * 0.28, 0.22))
        fin = bpy.context.active_object
        fin.scale = (0.04, 0.22, 0.3)
        fin.rotation_euler[2] = rad
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        mat_fin = make_emissive_material(f'mat_fin_{angle}', (1.0, 0.28, 0.72), strength=1.0)
        fin.data.materials.append(mat_fin)

    # Engine bell
    bpy.ops.mesh.primitive_cone_add(radius1=0.25, radius2=0.1, depth=0.25, location=(0, 0, 0.17))
    engine = bpy.context.active_object
    engine.data.materials.append(mat_body)

    # Slight tilt — mid-launch feel
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = body
    for obj in bpy.context.selected_objects:
        obj.rotation_euler[0] = math.radians(5)

    export_glb('rocket')
    print('[launchpad] ✓ rocket.glb')


def build_watchtower():
    """
    Guard Tower — Orange. Industrial surveillance. Chimneys + warning lights.
    """
    print('\n[watchtower] Building Guard Tower...')
    scene_clear()

    base = import_glb('industrial', 'building-a')
    place(base, scale=1.0)
    fix_pivot_to_base(base)

    # Stack chimneys
    for offset_x, size in [(-0.3, 'large'), (0.3, 'medium')]:
        chimney = import_glb('industrial', f'chimney-{size}')
        place(chimney, x=offset_x, y=0.2, z=0, scale=0.8)
        chimney.parent = base

    # Warning light strips (orange)
    for z in [0.8, 1.6, 2.4]:
        add_neon_strip(base, width=0.9, height=0.04,
                       x=0, y=-0.45, z=z,
                       color=(1.0, 0.58, 0.0), strength=3.0,
                       name=f'warning_{z}')

    # Rotating radar dish placeholder (static — rotation handled in Three.js)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.25, location=(0, 0, 3.2))
    radar = bpy.context.active_object
    radar.scale.y = 0.1
    bpy.ops.object.transform_apply(scale=True)
    mat_radar = bpy.data.materials.new('mat_radar')
    mat_radar.use_nodes = True
    mat_radar.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.7, 0.7, 0.7, 1.0)
    mat_radar.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.9
    radar.data.materials.append(mat_radar)
    radar.parent = base

    export_glb('guard-tower')
    print('[watchtower] ✓ guard-tower.glb')


def build_agora():
    """
    Community Plaza — Gold/yellow. Open space, plaza, community feel.
    """
    print('\n[agora] Building Community Plaza...')
    scene_clear()

    # Plaza base
    bpy.ops.mesh.primitive_cylinder_add(radius=1.5, depth=0.08, vertices=6, location=(0, 0, 0.04))
    plaza = bpy.context.active_object
    plaza.name = 'agora_plaza'
    mat_plaza = bpy.data.materials.new('mat_agora_plaza')
    mat_plaza.use_nodes = True
    mat_plaza.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.1, 0.06, 1.0)
    mat_plaza.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.1
    mat_plaza.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    plaza.data.materials.append(mat_plaza)

    # Hexagon border glow
    bpy.ops.mesh.primitive_torus_add(major_radius=1.45, minor_radius=0.035, location=(0, 0, 0.08))
    border = bpy.context.active_object
    mat_border = make_emissive_material('mat_agora_border', (1.0, 0.84, 0.0), strength=4.0)
    border.data.materials.append(mat_border)

    # Central obelisk
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.8))
    obelisk = bpy.context.active_object
    obelisk.name = 'agora_obelisk'
    obelisk.scale = (0.15, 0.15, 1.6)
    bpy.ops.object.transform_apply(scale=True)
    mat_obelisk = bpy.data.materials.new('mat_agora_obelisk')
    mat_obelisk.use_nodes = True
    mat_obelisk.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.15, 0.12, 0.04, 1.0)
    mat_obelisk.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.8
    obelisk.data.materials.append(mat_obelisk)

    add_logo_panel(obelisk, x=0, y=-0.08, z=0.5, color=(1.0, 0.84, 0.0), scale=0.5)

    export_glb('agora-plaza')
    print('[agora] ✓ agora-plaza.glb')


def build_burn_furnace():
    """
    Burn Furnace — Red/orange. Industrial fire. Smoke stacks + lava glow.
    """
    print('\n[burn_furnace] Building Burn Furnace...')
    scene_clear()

    base = import_glb('industrial', 'building-h')
    place(base, scale=1.0)
    fix_pivot_to_base(base)

    # Storage tank
    tank = import_glb('industrial', 'detail-tank')
    place(tank, x=0.6, y=0.2, z=0, scale=0.7)
    tank.parent = base

    # Flame glow at chimney tops
    for fx, fy, fz in [(-0.2, 0.3, 2.8), (0.2, 0.3, 3.1)]:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(fx, fy, fz))
        flame = bpy.context.active_object
        flame.scale = (1.0, 1.0, 1.5)
        bpy.ops.object.transform_apply(scale=True)
        mat_flame = make_emissive_material(f'mat_flame_{fx}', (1.0, 0.3, 0.0), strength=8.0)
        flame.data.materials.append(mat_flame)
        flame.parent = base

    # Red warning strips
    for z in [0.5, 1.2, 1.9]:
        add_neon_strip(base, width=0.85, height=0.04,
                       x=0, y=-0.43, z=z,
                       color=(1.0, 0.1, 0.1), strength=3.0,
                       name=f'red_strip_{z}')

    export_glb('burn-furnace')
    print('[burn_furnace] ✓ burn-furnace.glb')


# ── Street Props ───────────────────────────────────────────────────────────────

def build_crypto_atm():
    """
    Street-level crypto ATM kiosk.
    Small box with a glowing screen + Nova logo.
    Used as scatter prop in trading_floor and agora.
    """
    print('\n[crypto_atm] Building Crypto ATM...')
    scene_clear()

    # Body — upright box
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.6))
    body = bpy.context.active_object
    body.name = 'atm_body'
    body.scale = (0.35, 0.2, 1.2)
    bpy.ops.object.transform_apply(scale=True)

    mat_body = bpy.data.materials.new('mat_atm_body')
    mat_body.use_nodes = True
    mat_body.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.06, 0.06, 0.1, 1.0)
    mat_body.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.8
    mat_body.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.3
    body.data.materials.append(mat_body)

    # Screen — emissive plane on front face
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -0.11, 0.7))
    screen = bpy.context.active_object
    screen.scale = (0.22, 0.01, 0.35)
    bpy.ops.object.transform_apply(scale=True)
    mat_screen = make_emissive_material('mat_atm_screen', (0.0, 1.0, 0.53), strength=4.0)
    screen.data.materials.append(mat_screen)
    screen.parent = body

    # Card slot
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.11, 0.38))
    slot = bpy.context.active_object
    slot.scale = (0.12, 0.015, 0.02)
    bpy.ops.object.transform_apply(scale=True)
    mat_slot = make_emissive_material('mat_atm_slot', (1.0, 0.84, 0.0), strength=2.0)
    slot.data.materials.append(mat_slot)
    slot.parent = body

    # NOVA logo on top
    add_logo_panel(body, x=0, y=-0.11, z=1.1, color=(0.0, 1.0, 0.53), scale=0.25, name='atm_logo')

    # Base plate
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.03))
    base = bpy.context.active_object
    base.scale = (0.45, 0.3, 0.06)
    bpy.ops.object.transform_apply(scale=True)
    base.data.materials.append(mat_body)

    export_glb('crypto-atm')
    print('[crypto_atm] ✓ crypto-atm.glb')


# ── New Zones ──────────────────────────────────────────────────────────────────

def build_nova_bank():
    """
    Nova Bank — Treasury zone. Gold/dark. Vault aesthetic.
    """
    print('\n[nova_bank] Building Nova Bank...')
    scene_clear()

    # Monolithic cube base — bank should look solid, heavy
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.6))
    bank = bpy.context.active_object
    bank.name = 'bank_body'
    bank.scale = (1.1, 0.9, 1.2)
    bpy.ops.object.transform_apply(scale=True)

    mat_bank = bpy.data.materials.new('mat_bank')
    mat_bank.use_nodes = True
    mat_bank.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.07, 0.03, 1.0)
    mat_bank.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.9
    mat_bank.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.2
    bank.data.materials.append(mat_bank)

    # Columns (4x across the front)
    for col_x in [-0.38, -0.12, 0.12, 0.38]:
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.055, depth=1.15,
            location=(col_x, -0.46, 0.6))
        col = bpy.context.active_object
        col.data.materials.append(mat_bank)
        col.parent = bank

    # Gold horizontal band across facade
    add_neon_strip(bank, width=1.0, height=0.06,
                   x=0, y=-0.46, z=1.05,
                   color=(1.0, 0.84, 0.0), strength=3.5,
                   name='bank_gold_band')

    # Vault door indicator (circle on front)
    bpy.ops.mesh.primitive_circle_add(
        radius=0.22, fill_type='NGON', location=(0, -0.46, 0.5))
    vault_face = bpy.context.active_object
    mat_vault = make_emissive_material('mat_vault', (1.0, 0.84, 0.0), strength=2.0)
    vault_face.data.materials.append(mat_vault)
    vault_face.parent = bank

    # NOVA logo
    add_logo_panel(bank, x=0, y=-0.46, z=0.95,
                   color=(1.0, 0.84, 0.0), scale=0.5, name='bank_logo')

    # Flat roof with parapet
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.26))
    roof = bpy.context.active_object
    roof.scale = (1.15, 0.95, 0.06)
    bpy.ops.object.transform_apply(scale=True)
    roof.data.materials.append(mat_bank)
    roof.parent = bank

    export_glb('nova-bank')
    print('[nova_bank] ✓ nova-bank.glb')


# ══════════════════════════════════════════════════════════════════════════════
# MASTER RUNNER
# ══════════════════════════════════════════════════════════════════════════════

ZONE_BUILDERS = {
    'trading_floor':  build_trading_floor,
    'intel_hub':      build_intel_hub,
    'command_center': build_command_center,
    'launchpad':      build_launchpad,
    'watchtower':     build_watchtower,
    'agora':          build_agora,
    'burn_furnace':   build_burn_furnace,
    'crypto_atm':     build_crypto_atm,
    'nova_bank':      build_nova_bank,
}

def main():
    # Parse --zone argument if provided
    argv = sys.argv
    target_zone = None
    if '--' in argv:
        extra = argv[argv.index('--') + 1:]
        if '--zone' in extra:
            target_zone = extra[extra.index('--zone') + 1]

    print(f'\n{"="*60}')
    print('NovaUniverse Asset Pipeline')
    print(f'Output: {OUT_DIR}')
    print(f'{"="*60}')

    if target_zone:
        if target_zone not in ZONE_BUILDERS:
            print(f'Unknown zone: {target_zone}')
            print(f'Available: {list(ZONE_BUILDERS.keys())}')
            sys.exit(1)
        ZONE_BUILDERS[target_zone]()
    else:
        for zone_name, builder in ZONE_BUILDERS.items():
            try:
                builder()
            except Exception as e:
                print(f'  ✗ {zone_name} FAILED: {e}')
                import traceback; traceback.print_exc()

    print(f'\n{"="*60}')
    print('Pipeline complete.')
    print(f'Assets in: {OUT_DIR}')
    print(f'{"="*60}\n')


main()
