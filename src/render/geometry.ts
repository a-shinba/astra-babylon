import { Engine } from '@babylonjs/core/Engines/engine';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

export function roundedOutline(width: number, depth: number, radius: number, steps = 12): VecXZ[] {
  const points: VecXZ[] = [];
  const centers = [
    [width / 2 - radius, depth / 2 - radius],
    [-width / 2 + radius, depth / 2 - radius],
    [-width / 2 + radius, -depth / 2 + radius],
    [width / 2 - radius, -depth / 2 + radius],
  ];
  centers.forEach(([x, z], corner) => {
    for (let i = 0; i <= steps; i++) {
      const angle = (corner * Math.PI) / 2 + (i / steps) * Math.PI / 2;
      points.push({ x: x! + Math.cos(angle) * radius, z: z! + Math.sin(angle) * radius });
    }
  });
  return points;
}

interface VecXZ { x: number; z: number }

export function roundedSlab(
  name: string, width: number, depth: number, bottom: number, top: number,
  bevel: number, radius: number, scene: Scene,
): Mesh {
  const rings = [
    { inset: bevel, y: bottom },
    { inset: 0, y: bottom + bevel },
    { inset: 0, y: top - bevel },
    { inset: bevel, y: top },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const count = roundedOutline(width, depth, radius).length;
  for (const ring of rings) {
    for (const point of roundedOutline(width - ring.inset * 2, depth - ring.inset * 2, radius - ring.inset)) {
      positions.push(point.x, ring.y, point.z);
    }
  }
  for (let level = 0; level < rings.length - 1; level++) {
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      const a = level * count + j;
      const b = level * count + next;
      const c = (level + 1) * count + j;
      const d = (level + 1) * count + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, bottom, 0);
  const topCenter = positions.length / 3;
  positions.push(0, top, 0);
  for (let j = 0; j < count; j++) {
    const next = (j + 1) % count;
    indices.push(bottomCenter, j, next);
    indices.push(topCenter, 3 * count + next, 3 * count + j);
  }
  // Babylon's default left-handed winding is opposite to the perimeter winding.
  for (let i = 0; i < indices.length; i += 3) {
    const next = indices[i + 1]!;
    indices[i + 1] = indices[i + 2]!;
    indices[i + 2] = next;
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = [];
  for (let i = 0; i < positions.length; i += 3) {
    data.uvs.push(positions[i]! / width + 0.5, positions[i + 2]! / depth + 0.5);
  }
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

export function finishMesh<T extends Mesh>(mesh: T, material: Material, collection?: Mesh[]): T {
  mesh.material = material;
  mesh.isPickable = false;
  collection?.push(mesh);
  return mesh;
}

export function mergeByMaterial(meshes: readonly Mesh[], name: string): Mesh[] {
  const groups = new Map<Material | null, Mesh[]>();
  for (const mesh of meshes) {
    const group = groups.get(mesh.material) ?? [];
    group.push(mesh);
    groups.set(mesh.material, group);
  }
  return [...groups.values()].map((group, index) => {
    const merged = group.length === 1 ? group[0]! : Mesh.MergeMeshes(group, true, true);
    if (!merged) throw new Error(`Could not construct ${name}.`);
    merged.name = `${name}-${index}`;
    merged.isPickable = false;
    return merged;
  });
}

export function surface(scene: Scene, name: string, hex: string, metallic: number, roughness: number): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(hex).toLinearSpace();
  material.metallic = metallic;
  material.roughness = roughness;
  return material;
}

export function textureCanvas(scene: Scene, name: string, width: number, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('手続きテクスチャを描画できません。ブラウザーの描画設定を確認してください。');
  const texture = new DynamicTexture(name, canvas, scene, false);
  return { texture, context };
}

export function studioEnvironment(scene: Scene): RawCubeTexture {
  const size = 64;
  const faces: Uint8Array[] = [];
  const warm = new Vector3(-0.45, 0.8, -0.4).normalize();
  const cool = new Vector3(0.7, 0.45, 0.5).normalize();
  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = 2 * (x + 0.5) / size - 1;
        const v = 2 * (y + 0.5) / size - 1;
        const directions = [
          new Vector3(1, -v, -u), new Vector3(-1, -v, u),
          new Vector3(u, 1, v), new Vector3(u, -1, -v),
          new Vector3(u, -v, 1), new Vector3(-u, -v, -1),
        ];
        const direction = directions[face]!.normalize();
        const sky = Math.max(0, direction.y);
        const key = Math.pow(Math.max(0, Vector3.Dot(direction, warm)), 16);
        const fill = Math.pow(Math.max(0, Vector3.Dot(direction, cool)), 24);
        const offset = (y * size + x) * 4;
        data[offset] = Math.min(255, 30 + sky * 90 + key * 180 + fill * 70);
        data[offset + 1] = Math.min(255, 38 + sky * 97 + key * 146 + fill * 92);
        data[offset + 2] = Math.min(255, 47 + sky * 106 + key * 108 + fill * 120);
        data[offset + 3] = 255;
      }
    }
    faces.push(data);
  }
  const texture = new RawCubeTexture(scene, faces, size, Engine.TEXTUREFORMAT_RGBA,
    Engine.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.gammaSpace = true;
  return texture;
}
