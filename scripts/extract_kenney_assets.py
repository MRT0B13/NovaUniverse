#!/usr/bin/env python3
"""
Nova Universe — Kenney Asset Extractor
Run from the NovaUniverse repo root:
  python3 scripts/extract_kenney_assets.py

Works with EITHER:
  1. Zip files in ./kenney-zips/  (original Kenney downloads)
  2. Already-extracted directories in ./src/texturepacks/  (what we have)

Outputs to: public/kenney/
  models/characters/   — character-a.glb through character-r.glb
  models/cars/         — sedan.glb, taxi.glb, police.glb etc.
  models/commercial/   — building-a.glb ... building-skyscraper-e.glb
  models/industrial/   — building-a.glb ... chimney-large.glb
  models/suburban/     — building-type-a.glb ... tree-large.glb
  models/roads/        — road-*.glb, light-*.glb etc.
  textures/            — colormap.png per pack, texture-a.png ... texture-r.png (characters)
"""

import zipfile, os, shutil, glob

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.join(SCRIPT_DIR, '..')
OUT_DIR    = os.path.join(ROOT_DIR, 'public', 'kenney')

# ── Zip-based extraction (original script) ─────────────────────────────────

ZIPS = {
    'characters': 'kenney_blocky-characters_20.zip',
    'cars':       'kenney_car-kit.zip',
    'commercial': 'kenney_city-kit-commercial_2_1.zip',
    'industrial': 'kenney_city-kit-industrial_1_0.zip',
    'suburban':   'kenney_city-kit-suburban_20.zip',
}

# ── Directory-based extraction (extracted texturepacks) ────────────────────

DIRS = {
    'characters': 'kenney_blocky-characters_20',
    'cars':       'kenney_car-kit',
    'commercial': 'kenney_city-kit-commercial_2.1',
    'industrial': 'kenney_city-kit-industrial_1.0',
    'suburban':   'kenney_city-kit-suburban_20',
    'roads':      'kenney_city-kit-roads',
}

def extract_from_zip(zip_path, category):
    dest_models = os.path.join(OUT_DIR, 'models', category)
    dest_tex    = os.path.join(OUT_DIR, 'textures')
    os.makedirs(dest_models, exist_ok=True)
    os.makedirs(dest_tex, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as z:
        for member in z.namelist():
            name = os.path.basename(member)
            if not name:
                continue
            if name.endswith('.glb') and 'GLB format' in member:
                target = os.path.join(dest_models, name)
                with z.open(member) as src, open(target, 'wb') as dst:
                    dst.write(src.read())
            elif name.endswith('.png') and 'Textures' in member and 'Preview' not in member:
                target = os.path.join(dest_tex, f'{category}_{name}' if name == 'colormap.png' else name)
                with z.open(member) as src, open(target, 'wb') as dst:
                    dst.write(src.read())

    glb_count = len([f for f in os.listdir(dest_models) if f.endswith('.glb')])
    print(f'  {category:12s}  {glb_count} GLB files → public/kenney/models/{category}/')

def extract_from_dir(pack_dir, category):
    dest_models = os.path.join(OUT_DIR, 'models', category)
    dest_tex    = os.path.join(OUT_DIR, 'textures')
    os.makedirs(dest_models, exist_ok=True)
    os.makedirs(dest_tex, exist_ok=True)

    glb_dir = os.path.join(pack_dir, 'Models', 'GLB format')
    if not os.path.isdir(glb_dir):
        print(f'  ⚠  No GLB format directory in {pack_dir}')
        return

    # Copy GLB models
    for f in os.listdir(glb_dir):
        if f.endswith('.glb') and not f.endswith(':Zone.Identifier'):
            src = os.path.join(glb_dir, f)
            dst = os.path.join(dest_models, f)
            shutil.copy2(src, dst)

    # Copy textures from GLB format/Textures
    tex_dir = os.path.join(glb_dir, 'Textures')
    if os.path.isdir(tex_dir):
        for f in os.listdir(tex_dir):
            if f.endswith('.png') and not f.endswith(':Zone.Identifier') and 'Preview' not in f:
                src = os.path.join(tex_dir, f)
                # Prefix colormap with category to avoid name collisions
                dst_name = f'{category}_{f}' if f == 'colormap.png' else f
                dst = os.path.join(dest_tex, dst_name)
                shutil.copy2(src, dst)

    glb_count = len([f for f in os.listdir(dest_models) if f.endswith('.glb')])
    print(f'  {category:12s}  {glb_count} GLB files → public/kenney/models/{category}/')

if __name__ == '__main__':
    print('Extracting Kenney assets...\n')

    # Try zip files first
    zip_dir = os.path.join(ROOT_DIR, 'kenney-zips')
    found_zips = False
    if os.path.isdir(zip_dir):
        for category, zip_name in ZIPS.items():
            zip_path = os.path.join(zip_dir, zip_name)
            if os.path.exists(zip_path):
                found_zips = True
                extract_from_zip(zip_path, category)
            else:
                print(f'  ⚠  Missing: kenney-zips/{zip_name}')

    # If no zips found, try extracted directories
    if not found_zips:
        print('  No zip files found, using extracted texturepacks...\n')
        texpack_dir = os.path.join(ROOT_DIR, 'src', 'texturepacks')
        for category, dir_name in DIRS.items():
            pack_dir = os.path.join(texpack_dir, dir_name)
            if os.path.isdir(pack_dir):
                extract_from_dir(pack_dir, category)
            else:
                print(f'  ⚠  Missing: src/texturepacks/{dir_name}')

    print('\nTextures:')
    tex_dir = os.path.join(OUT_DIR, 'textures')
    if os.path.isdir(tex_dir):
        for f in sorted(os.listdir(tex_dir)):
            if not f.endswith(':Zone.Identifier'):
                print(f'  {f}')

    print(f'\nDone. Assets in public/kenney/')
