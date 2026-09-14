import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import '@babylonjs/core/Culling/ray';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { fieldContours } from './contours.ts';
import { arcLengthDashes } from './paths.ts';
import { finishMesh, mergeByMaterial, roundedOutline, roundedSlab, studioEnvironment, surface, textureCanvas } from './geometry.ts';
import { ringsAt, sampleRecording } from '../core/simulation.ts';
import type { WorkshopSession } from '../core/session.ts';
import type { Recording, RunEvent, Stage, Vec2 } from '../core/types.ts';

const STAR_HEIGHT = 1.18;
const GOLD = Color3.FromHexString('#dec390');
const LABEL_COLOR = '#b6a37d';

interface LensVisual { root: TransformNode; selection: Mesh }
interface RingVisual {
  root: TransformNode;
  hoop: TransformNode;
  material: PBRMaterial;
  ripple: Mesh;
  rippleMaterial: StandardMaterial;
  pulseAt: number;
}

export class Instrument {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly shadows: ShadowGenerator;
  private readonly brass: PBRMaterial;
  private readonly porcelain: PBRMaterial;
  private readonly darkBrass: PBRMaterial;
  private readonly sapphire: PBRMaterial;
  private readonly stageRoot: TransformNode;
  private readonly star: TransformNode;
  private readonly starHalo: Mesh;
  private readonly ghostMaterial: StandardMaterial;
  private lenses: LensVisual[] = [];
  private rings: RingVisual[] = [];
  private solutionMarks: Mesh[] = [];
  private contours: LinesMesh | null = null;
  private prediction: LinesMesh | null = null;
  private trail: LinesMesh | null = null;
  private ghost: LinesMesh | null = null;
  private lastPrediction: Recording | null = null;
  private lastRecording: Recording | null = null;
  private lastGhost: Recording | null = null;
  private trailTimes: number[] = [];
  private stage: Stage | null = null;
  private reducedMotion = false;
  private lastContourUpdate = -Infinity;
  private contoursDirty = false;
  private currentPlacements: readonly Vec2[] = [];
  private ringCount = -1;
  private frameTimes: number[] = [];
  private renderQuality = 'full';
  private slowFrames = 0;
  private staticCasters: Mesh[] = [];
  private stageMaterials: (PBRMaterial | StandardMaterial)[] = [];

  constructor(canvas: HTMLCanvasElement, reducedMotion: boolean) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    try {
      this.engine = new Engine(canvas, true, {
        stencil: true,
        preserveDrawingBuffer: false,
        premultipliedAlpha: false,
        disableWebGL2Support: false,
        powerPreference: 'high-performance',
      }, false);
    } catch (error) {
      throw new Error('WebGL 2の描画を開始できません。ブラウザーのハードウェアアクセラレーションを有効にし、対応する最新版のブラウザーで開いてください。', { cause: error });
    }
    if (this.engine.webGLVersion < 2) {
      this.engine.dispose();
      throw new Error('WebGL 2を利用できません。ブラウザーのハードウェアアクセラレーションを有効にし、Chrome・Edge・Firefox・Safariの最新版で開いてください。');
    }
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.environmentTexture = studioEnvironment(this.scene);
    this.scene.environmentIntensity = 0.72;
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure = 1.15;
    this.scene.imageProcessingConfiguration.contrast = 1.08;
    this.scene.skipPointerMovePicking = true;
    this.camera = new ArcRotateCamera('fixed-workbench', -1.91, 0.84, 38, Vector3.Zero(), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 100;
    this.camera.inputs.clear();

    const ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.4;
    ambient.diffuse = Color3.FromHexString('#c9e0eb');
    ambient.groundColor = Color3.FromHexString('#222d3d');
    const key = new DirectionalLight('warm-studio-window', new Vector3(0.35, -1, 0.45), this.scene);
    key.position = new Vector3(-9, 18, -10);
    key.diffuse = Color3.FromHexString('#ffe4b7');
    key.intensity = 2.6;
    this.shadows = new ShadowGenerator(1024, key);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
    this.shadows.bias = 0.002;
    this.shadows.normalBias = 0.025;
    this.shadows.setDarkness(0.3);
    this.shadows.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

    this.brass = surface(this.scene, 'satin-brass', '#c3a365', 0.8, 0.3);
    this.darkBrass = surface(this.scene, 'brushed-bronze', '#625440', 0.76, 0.46);
    this.porcelain = surface(this.scene, 'ivory-porcelain', '#dddace', 0.03, 0.3);
    this.porcelain.clearCoat.isEnabled = true;
    this.porcelain.clearCoat.intensity = 0.3;
    this.sapphire = surface(this.scene, 'optical-indigo', '#102c3d', 0.25, 0.18);
    this.sapphire.clearCoat.isEnabled = true;
    this.sapphire.clearCoat.intensity = 0.8;
    this.ghostMaterial = new StandardMaterial('solution-ink', this.scene);
    this.ghostMaterial.disableLighting = true;
    this.ghostMaterial.emissiveColor = GOLD;
    this.ghostMaterial.alpha = 0.25;
    this.stageRoot = new TransformNode('stage-apparatus', this.scene);
    this.createBoard();
    this.star = this.createStar();
    this.starHalo = this.createHalo();
    this.resize();
  }

  private createBoard(): void {
    const meshes: Mesh[] = [];
    const lacquer = surface(this.scene, 'midnight-lacquer', '#102b38', 0.13, 0.59);
    const underside = surface(this.scene, 'dark-ceramic-foot', '#162631', 0.15, 0.6);
    finishMesh(roundedSlab('ceramic-case', 20.9, 13.5, -0.48, 0.23, 0.17, 1.05, this.scene), this.porcelain, meshes);
    finishMesh(roundedSlab('bronze-seam', 20.87, 13.47, -0.23, -0.15, 0.025, 1.04, this.scene), this.brass, meshes);
    finishMesh(roundedSlab('inset-brass-bezel', 20.15, 12.75, 0.2, 0.34, 0.045, 0.87, this.scene), this.brass, meshes);
    const playingSurface = finishMesh(roundedSlab('enamel-playing-surface', 19.99, 12.59, 0.26, 0.375, 0.035, 0.8, this.scene), lacquer, meshes);
    playingSurface.receiveShadows = true;

    for (const x of [-8.4, 8.4]) {
      for (const z of [-4.9, 4.9]) {
        const foot = finishMesh(MeshBuilder.CreateCylinder('turned-foot', {
          diameterTop: 1.25, diameterBottom: 0.95, height: 0.35, tessellation: 32,
        }, this.scene), underside, meshes);
        foot.position.set(x, -0.58, z);
        const collar = finishMesh(MeshBuilder.CreateTorus('foot-collar', {
          diameter: 1.05, thickness: 0.07, tessellation: 32,
        }, this.scene), this.brass, meshes);
        collar.position.set(x, -0.49, z);
      }
    }
    for (const x of [-9.4, 9.4]) {
      for (const z of [-5.75, 0, 5.75]) {
        const screw = finishMesh(MeshBuilder.CreateCylinder('slotted-brass-screw', {
          diameter: 0.19, height: 0.026, tessellation: 20,
        }, this.scene), this.brass, meshes);
        screw.position.set(x, 0.396, z);
        const slot = finishMesh(MeshBuilder.CreateBox('screw-slot', {
          width: 0.112, depth: 0.026, height: 0.006,
        }, this.scene), this.darkBrass, meshes);
        slot.position.set(x, 0.412, z);
        slot.rotation.y = 0.6;
      }
    }
    const border = roundedOutline(18.8, 11.55, 0.45).map((p) => new Vector3(p.x, 0.384, p.z));
    border.push(border[0]!.clone());
    const borderLine = MeshBuilder.CreateLines('engraved-inner-border', { points: border, useVertexAlpha: true }, this.scene);
    borderLine.color = GOLD;
    borderLine.alpha = 0.18;
    borderLine.isPickable = false;
    this.createEngravings();
    this.staticCasters = mergeByMaterial(meshes, 'workbench');
    for (const mesh of this.staticCasters) {
      mesh.receiveShadows = true;
      mesh.freezeWorldMatrix();
      this.shadows.addShadowCaster(mesh);
    }

    const { texture: shadowTexture, context } = textureCanvas(this.scene, 'contact-shadow', 256);
    const gradient = context.createRadialGradient(128, 128, 18, 128, 128, 124);
    gradient.addColorStop(0, 'rgba(0,0,0,0.65)');
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.36)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    shadowTexture.hasAlpha = true;
    shadowTexture.update();
    const shadowMaterial = new StandardMaterial('contact-shadow-mat', this.scene);
    shadowMaterial.disableLighting = true;
    shadowMaterial.diffuseTexture = shadowTexture;
    shadowMaterial.emissiveColor = Color3.White();
    shadowMaterial.useAlphaFromDiffuseTexture = true;
    const shadow = finishMesh(MeshBuilder.CreateGround('soft-table-shadow', {
      width: 29, height: 20,
    }, this.scene), shadowMaterial);
    shadow.position.set(0.4, -0.79, 0.5);
  }

  private createEngravings(): void {
    const { texture, context: ctx } = textureCanvas(this.scene, 'hand-engraved-dial', 2048, 1280);
    ctx.clearRect(0, 0, 2048, 1280);
    ctx.strokeStyle = 'rgba(186,169,124,0.30)';
    ctx.fillStyle = 'rgba(186,169,124,0.56)';
    ctx.lineWidth = 1;
    ctx.font = '15px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 80; i++) {
      const x = 88 + i * 23.4;
      const long = i % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(x, 52);
      ctx.lineTo(x, long ? 70 : 60);
      ctx.moveTo(x, 1228);
      ctx.lineTo(x, long ? 1210 : 1220);
      ctx.stroke();
      if (i % 10 === 0) ctx.fillText(String(i / 10).padStart(2, '0'), x, 96);
    }
    for (let y = 180; y < 1150; y += 110) {
      for (let x = 170; x < 1950; x += 115) {
        ctx.strokeStyle = 'rgba(134,166,177,0.17)';
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
        ctx.stroke();
      }
    }
    ctx.textAlign = 'left';
    ctx.font = '19px Georgia';
    ctx.fillText('O R B I T A L', 108, 1175);
    ctx.font = '12px monospace';
    ctx.fillText('CELESTIAL INSTRUMENT  /  FIXED GRAVITY', 108, 1200);
    ctx.textAlign = 'right';
    ctx.fillText('35° 40′ N  /  139° 42′ E', 1940, 1180);
    ctx.fillText('STUDIES IN RESONANCE  —  No. 001', 1940, 1200);
    texture.hasAlpha = true;
    texture.update();
    const material = new StandardMaterial('engraving-ink', this.scene);
    material.disableLighting = true;
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.useAlphaFromDiffuseTexture = true;
    const plane = finishMesh(MeshBuilder.CreateGround('engraved-face', {
      width: 19.4, height: 12.05,
    }, this.scene), material);
    plane.position.y = 0.381;
  }

  private plate(text: string, position: Vector3, width = 1.45): Mesh {
    const { texture, context: ctx } = textureCanvas(this.scene, `inscription-${text}`, 256, 80);
    ctx.clearRect(0, 0, 256, 80);
    ctx.font = '22px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(text, 128, 48);
    texture.hasAlpha = true;
    texture.update();
    const material = new StandardMaterial(`inscription-ink-${text}`, this.scene);
    this.stageMaterials.push(material);
    material.disableLighting = true;
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.useAlphaFromDiffuseTexture = true;
    const plate = finishMesh(MeshBuilder.CreateGround(`plate-${text}`, {
      width, height: width / 3.2,
    }, this.scene), material);
    plate.position.copyFrom(position);
    plate.parent = this.stageRoot;
    return plate;
  }

  setStage(stage: Stage): void {
    this.clearPaths();
    this.contours?.dispose();
    this.contours = null;
    for (const child of this.stageRoot.getChildren()) child.dispose(false);
    for (const material of this.stageMaterials) material.dispose(false, true);
    this.stageMaterials = [];
    this.shadows.getShadowMap()!.renderList = [...this.staticCasters];
    this.lenses = [];
    this.rings = [];
    this.solutionMarks = [];
    this.stage = stage;
    this.ringCount = -1;
    stage.lenses.forEach((lens, index) => {
      this.lenses.push(this.createLens(index, lens.label));
      const mark = finishMesh(MeshBuilder.CreateTorus(`solution-${index}`, {
        diameter: 1.85, thickness: 0.024, tessellation: 64,
      }, this.scene), this.ghostMaterial);
      mark.position.set(lens.solution.x, 0.39, lens.solution.y);
      mark.parent = this.stageRoot;
      mark.setEnabled(false);
      this.solutionMarks.push(mark);
    });
    stage.rings.forEach((_, index) => this.rings.push(this.createRing(stage, index)));
    this.createLauncher(stage);
    this.createCatcher(stage);
    this.refreshShadows();
  }

  private createLens(index: number, label: string): LensVisual {
    const root = new TransformNode(`lens-${index}`, this.scene);
    root.parent = this.stageRoot;
    const parts: Mesh[] = [];
    const cylinder = (name: string, diameter: number, height: number, y: number, material: PBRMaterial) => {
      const mesh = finishMesh(MeshBuilder.CreateCylinder(name, {
        diameter, height, tessellation: 64,
      }, this.scene), material, parts);
      mesh.position.y = y;
      return mesh;
    };
    cylinder('machined-lens-base', 1.62, 0.14, 0.46, this.darkBrass);
    cylinder('porcelain-lens-body', 1.36, 0.24, 0.61, this.porcelain);
    cylinder('brass-lens-crown', 1.45, 0.07, 0.76, this.brass);
    const glass = finishMesh(MeshBuilder.CreateSphere('polished-optical-lens', {
      diameter: 1.2, segments: 24,
    }, this.scene), this.sapphire, parts);
    glass.position.y = 0.79;
    glass.scaling.y = 0.22;
    const rim = finishMesh(MeshBuilder.CreateTorus('fine-lens-rim', {
      diameter: 1.21, thickness: 0.047, tessellation: 64,
    }, this.scene), this.brass, parts);
    rim.position.y = 0.8;
    for (let i = 0; i < 32; i++) {
      const angle = i / 32 * Math.PI * 2;
      const tick = finishMesh(MeshBuilder.CreateBox('milled-grip', {
        width: 0.025, height: 0.07, depth: i % 4 === 0 ? 0.15 : 0.085,
      }, this.scene), this.brass, parts);
      tick.position.set(Math.sin(angle) * 0.735, 0.795, Math.cos(angle) * 0.735);
      tick.rotation.y = angle;
    }
    const middle = finishMesh(MeshBuilder.CreateTorus('optical-reticle', {
      diameter: 0.29, thickness: 0.022, tessellation: 32,
    }, this.scene), this.brass, parts);
    middle.position.y = 0.931;
    const pin = cylinder('reticle-center', 0.055, 0.022, 0.935, this.brass);
    pin.position.x = 0;
    for (const mesh of mergeByMaterial(parts, `lens-${index}`)) {
      mesh.parent = root;
      mesh.isPickable = true;
      mesh.metadata = { lensIndex: index };
      this.shadows.addShadowCaster(mesh);
    }
    const selectMaterial = new StandardMaterial(`selected-lens-${index}`, this.scene);
    this.stageMaterials.push(selectMaterial);
    selectMaterial.disableLighting = true;
    selectMaterial.emissiveColor = GOLD;
    selectMaterial.alpha = 0.6;
    const selection = finishMesh(MeshBuilder.CreateTorus(`lens-selection-${index}`, {
      diameter: 1.91, thickness: 0.018, tessellation: 80,
    }, this.scene), selectMaterial);
    selection.position.y = 0.389;
    selection.parent = root;
    const plaque = this.plate(`LENS ${label}`, new Vector3(0, 0.39, -1.1), 1.4);
    plaque.parent = root;
    return { root, selection };
  }

  private createRing(stage: Stage, index: number): RingVisual {
    const data = stage.rings[index]!;
    const root = new TransformNode(`resonator-${index}`, this.scene);
    root.parent = this.stageRoot;
    root.position.set(data.position.x, 0, data.position.y);
    const hoop = new TransformNode(`resonator-hoop-${index}`, this.scene);
    hoop.parent = root;
    hoop.rotation.y = -Math.atan2(data.normal.y, data.normal.x);
    const foot = finishMesh(MeshBuilder.CreateCylinder(`resonator-foot-${index}`, {
      diameter: 0.83, height: 0.12, tessellation: 48,
    }, this.scene), this.porcelain);
    foot.position.y = 0.445;
    foot.parent = root;
    const collar = finishMesh(MeshBuilder.CreateTorus(`resonator-foot-rim-${index}`, {
      diameter: 0.81, thickness: 0.043, tessellation: 48,
    }, this.scene), this.brass);
    collar.position.y = 0.49;
    collar.parent = root;
    this.shadows.addShadowCaster(foot);
    const material = surface(this.scene, `resonant-gold-${index}`, '#d1b27a', 0.8, 0.28);
    this.stageMaterials.push(material);
    const outer = finishMesh(MeshBuilder.CreateTorus(`resonant-ring-${index}`, {
      diameter: 1.5, thickness: 0.11, tessellation: 80,
    }, this.scene), material);
    outer.position.y = STAR_HEIGHT;
    outer.rotation.z = Math.PI / 2;
    outer.parent = hoop;
    const inner = finishMesh(MeshBuilder.CreateTorus(`porcelain-ring-inlay-${index}`, {
      diameter: 1.35, thickness: 0.04, tessellation: 64,
    }, this.scene), this.porcelain);
    inner.position.y = STAR_HEIGHT;
    inner.rotation.z = Math.PI / 2;
    inner.parent = hoop;
    this.shadows.addShadowCaster(outer);
    this.shadows.addShadowCaster(inner);
    this.plate(`${String(index + 1).padStart(2, '0')} / ${data.note}`, new Vector3(data.position.x, 0.39, data.position.y - 0.82), 1.5);
    const rippleMaterial = new StandardMaterial(`resonance-wave-${index}`, this.scene);
    this.stageMaterials.push(rippleMaterial);
    rippleMaterial.disableLighting = true;
    rippleMaterial.emissiveColor = GOLD;
    rippleMaterial.alpha = 0;
    const ripple = finishMesh(MeshBuilder.CreateTorus(`wave-${index}`, {
      diameter: 1.9, thickness: 0.018, tessellation: 64,
    }, this.scene), rippleMaterial);
    ripple.position.y = 0.391;
    ripple.parent = root;
    ripple.setEnabled(false);
    return { root, hoop, material, ripple, rippleMaterial, pulseAt: -Infinity };
  }

  private createLauncher(stage: Stage): void {
    const parts: Mesh[] = [];
    const root = new TransformNode('star-launcher', this.scene);
    root.parent = this.stageRoot;
    root.position.set(stage.launch.position.x, 0, stage.launch.position.y);
    root.rotation.y = -Math.atan2(stage.launch.velocity.y, stage.launch.velocity.x);
    const base = finishMesh(MeshBuilder.CreateCylinder('launcher-ceramic', {
      diameter: 1.3, height: 0.22, tessellation: 48,
    }, this.scene), this.porcelain, parts);
    base.position.y = 0.51;
    const rim = finishMesh(MeshBuilder.CreateTorus('launcher-bezel', {
      diameter: 1.3, thickness: 0.065, tessellation: 48,
    }, this.scene), this.brass, parts);
    rim.position.y = 0.62;
    for (const z of [-0.24, 0.24]) {
      const rail = finishMesh(roundedSlab('launch-rail', 1.43, 0.12, 0.62, 0.93, 0.045, 0.055, this.scene), this.brass, parts);
      rail.position.set(0.14, 0, z);
    }
    const dial = finishMesh(MeshBuilder.CreateCylinder('launch-dial', {
      diameter: 0.5, height: 0.11, tessellation: 32,
    }, this.scene), this.sapphire, parts);
    dial.position.set(-0.2, 0.68, 0);
    for (const mesh of mergeByMaterial(parts, 'launcher')) {
      mesh.parent = root;
      this.shadows.addShadowCaster(mesh);
    }
    this.plate('DEPARTURE', new Vector3(stage.launch.position.x, 0.39, stage.launch.position.y - 1.0), 1.7);
  }

  private createCatcher(stage: Stage): void {
    const parts: Mesh[] = [];
    const root = new TransformNode('receiving-cup', this.scene);
    root.parent = this.stageRoot;
    root.position.set(stage.catcher.position.x, 0, stage.catcher.position.y);
    const foot = finishMesh(MeshBuilder.CreateCylinder('cup-foot', {
      diameterTop: 0.68, diameterBottom: 1.3, height: 0.23, tessellation: 48,
    }, this.scene), this.brass, parts);
    foot.position.y = 0.5;
    const shape = [
      new Vector3(0, 0.59, 0), new Vector3(0.5, 0.59, 0), new Vector3(0.88, 0.73, 0),
      new Vector3(1.02, 1.0, 0), new Vector3(1.01, 1.05, 0),
      new Vector3(0.91, 1.06, 0), new Vector3(0.79, 0.85, 0),
      new Vector3(0.44, 0.73, 0), new Vector3(0, 0.73, 0),
    ];
    finishMesh(MeshBuilder.CreateLathe('porcelain-receiving-bowl', {
      shape, tessellation: 72, sideOrientation: Mesh.DOUBLESIDE,
    }, this.scene), this.porcelain, parts);
    const rim = finishMesh(MeshBuilder.CreateTorus('cup-gold-lip', {
      diameter: 1.96, thickness: 0.045, tessellation: 72,
    }, this.scene), this.brass, parts);
    rim.position.y = 1.052;
    const inset = finishMesh(MeshBuilder.CreateCylinder('cup-indigo-inlay', {
      diameter: 0.6, height: 0.02, tessellation: 48,
    }, this.scene), this.sapphire, parts);
    inset.position.y = 0.743;
    for (const mesh of mergeByMaterial(parts, 'catcher')) {
      mesh.parent = root;
      this.shadows.addShadowCaster(mesh);
    }
    this.plate('ARRIVAL', new Vector3(stage.catcher.position.x, 0.39, stage.catcher.position.y - 1.29), 1.6);
  }

  private createStar(): TransformNode {
    const root = new TransformNode('travelling-star', this.scene);
    const material = surface(this.scene, 'starlight-pearl', '#fff1cf', 0.15, 0.18);
    material.emissiveColor = Color3.FromHexString('#ffcc83').scale(0.9);
    const star = finishMesh(MeshBuilder.CreateSphere('star-pearl', {
      diameter: 0.23, segments: 16,
    }, this.scene), material);
    star.parent = root;
    return root;
  }

  private createHalo(): Mesh {
    const { texture, context: ctx } = textureCanvas(this.scene, 'starlight-falloff', 128);
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,237,194,0.7)');
    gradient.addColorStop(0.15, 'rgba(255,209,132,0.24)');
    gradient.addColorStop(0.45, 'rgba(255,193,106,0.06)');
    gradient.addColorStop(1, 'rgba(255,188,99,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    texture.hasAlpha = true;
    texture.update();
    const material = new StandardMaterial('gentle-starlight', this.scene);
    material.disableLighting = true;
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.useAlphaFromDiffuseTexture = true;
    const halo = finishMesh(MeshBuilder.CreatePlane('star-halo', { size: 1.35 }, this.scene), material);
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.parent = this.star;
    return halo;
  }

  sync(session: WorkshopSession, showHint: boolean): void {
    this.currentPlacements = session.placements;
    this.lenses.forEach((lens, i) => {
      const position = session.placements[i]!;
      if (lens.root.position.x !== position.x || lens.root.position.z !== position.y) {
        lens.root.position.set(position.x, 0, position.y);
        this.contoursDirty = true;
        this.refreshShadows();
      }
      lens.selection.setEnabled(session.canEdit && session.selectedLens === i);
    });
    this.solutionMarks.forEach((mark) => mark.setEnabled(showHint && session.canEdit));
    if (this.lastPrediction !== session.prediction) {
      this.prediction?.dispose();
      this.prediction = this.makePath('predicted-silk', session.prediction, true);
      this.prediction.color = GOLD;
      this.prediction.alpha = 0.46;
      this.lastPrediction = session.prediction;
      this.contoursDirty = true;
    }
    if (this.lastRecording !== session.recording) {
      this.trail?.dispose();
      this.trail = session.recording ? this.makePath('played-silk', session.recording, false) : null;
      if (this.trail) {
        this.trail.color = Color3.FromHexString('#f4d6a0');
        this.trail.alpha = 0.9;
      }
      this.trailTimes = session.recording ? this.pathSamples(session.recording).map((s) => s.time) : [];
      this.lastRecording = session.recording;
    }
    if (this.lastGhost !== session.ghost) {
      this.ghost?.dispose();
      this.ghost = session.ghost ? this.makePath('previous-silk', session.ghost, false) : null;
      if (this.ghost) {
        this.ghost.color = Color3.FromHexString('#92acb4');
        this.ghost.alpha = 0.17;
      }
      this.lastGhost = session.ghost;
    }
    this.prediction?.setEnabled(session.phase === 'editing');
    this.ghost?.setEnabled(session.phase === 'editing');
    this.trail?.setEnabled(session.phase !== 'editing');
    this.canvas.style.cursor = session.canEdit ? 'grab' : 'default';
  }

  private pathSamples(recording: Recording) {
    return recording.samples.filter((_, i) => i % 2 === 0 || i === recording.samples.length - 1);
  }

  private makePath(name: string, recording: Recording, dashed: boolean): LinesMesh {
    const samples = this.pathSamples(recording);
    const toWorld = (point: Vec2) => new Vector3(point.x, STAR_HEIGHT, point.y);
    const line = dashed
      ? MeshBuilder.CreateLineSystem(name, {
        lines: arcLengthDashes(samples.map((sample) => sample.position)).map((segment) => segment.map(toWorld)),
        useVertexAlpha: true,
      }, this.scene)
      : MeshBuilder.CreateLines(name, { points: samples.map((sample) => toWorld(sample.position)), useVertexAlpha: true }, this.scene);
    line.isPickable = false;
    return line;
  }

  react(event: RunEvent, now: number): void {
    if (event.kind === 'ring') this.rings[event.index]!.pulseAt = now;
  }

  clearPulses(): void {
    for (const ring of this.rings) ring.pulseAt = -Infinity;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) this.clearPulses();
  }

  render(session: WorkshopSession, now: number, delta: number): void {
    if (this.contoursDirty && now - this.lastContourUpdate > 0.06 && this.stage) {
      this.contours?.dispose();
      const lines = fieldContours(this.stage, this.currentPlacements);
      this.contours = lines.length ? MeshBuilder.CreateLineSystem('equipotential-engraving', { lines, useVertexAlpha: true }, this.scene) : null;
      if (this.contours) {
        this.contours.color = Color3.FromHexString('#859f9e');
        this.contours.alpha = 0.11;
        this.contours.isPickable = false;
      }
      this.contoursDirty = false;
      this.lastContourUpdate = now;
    }
    const editing = session.phase === 'editing';
    const recording = session.recording ?? session.prediction;
    const sample = sampleRecording(editing ? session.prediction : recording, editing ? 0 : session.time);
    this.star.position.set(sample.position.x, STAR_HEIGHT, sample.position.y);
    const caught = !editing && session.time >= recording.duration && recording.outcome === 'caught';
    this.star.scaling.setAll(caught ? 0.6 : 1);
    this.starHalo.visibility = caught ? 0.45 : 1;
    const count = editing ? 0 : ringsAt(recording, session.time);
    if (this.ringCount !== count) {
      this.rings.forEach((ring, i) => {
        ring.material.emissiveColor = i < count ? GOLD.scale(0.22) : Color3.Black();
      });
      this.ringCount = count;
    }
    if (this.trail?.subMeshes?.[0]) {
      let segments = 0;
      while (segments + 1 < this.trailTimes.length && this.trailTimes[segments + 1]! <= session.time) segments++;
      this.trail.subMeshes[0].indexCount = segments * 2;
    }
    for (const ring of this.rings) {
      const age = now - ring.pulseAt;
      const active = age >= 0 && age < 0.85 && !this.reducedMotion && session.isAdvancing;
      ring.ripple.setEnabled(active);
      if (active) {
        ring.ripple.scaling.setAll(1 + age * 2.4);
        ring.rippleMaterial.alpha = (1 - age / 0.85) * 0.36;
        const shake = Math.sin(age * 38) * Math.exp(-age * 8) * 0.045;
        ring.hoop.rotation.x = shake;
      } else {
        ring.hoop.rotation.x = 0;
      }
    }
    this.scene.render();
    if (delta > 0) {
      this.frameTimes.push(delta * 1000);
      if (this.frameTimes.length > 180) this.frameTimes.shift();
      if (this.frameTimes.length === 180 && this.meanFrameTime > 22) this.slowFrames++;
      else this.slowFrames = 0;
      if (this.slowFrames > 240 && this.renderQuality === 'full') {
        // Only rendering changes: the same fixed-step recording remains untouched.
        this.scene.shadowsEnabled = false;
        this.renderQuality = 'light';
        this.slowFrames = 0;
      }
    }
  }

  private get meanFrameTime(): number {
    return this.frameTimes.length ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length : 0;
  }

  diagnostics() {
    return {
      fps: this.meanFrameTime ? Math.round(1000 / this.meanFrameTime) : 0,
      frameMs: Number(this.meanFrameTime.toFixed(2)),
      renderWidth: this.engine.getRenderWidth(),
      renderHeight: this.engine.getRenderHeight(),
      dpr: window.devicePixelRatio,
      webgl: this.engine.webGLVersion,
      renderer: this.engine.getGlInfo().renderer,
      quality: this.renderQuality,
      meshes: this.scene.meshes.length,
      materials: this.scene.materials.length,
      textures: this.scene.textures.length,
      ready: this.scene.isReady(),
      predictionVertices: this.prediction?.getTotalVertices() ?? 0,
    };
  }

  project(position: Vec2, height = 0.85): Vec2 {
    const viewport = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const point = Vector3.Project(new Vector3(position.x, height, position.y), Matrix.Identity(),
      this.scene.getTransformMatrix(), viewport);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: point.x * rect.width / this.engine.getRenderWidth(),
      y: point.y * rect.height / this.engine.getRenderHeight(),
    };
  }

  boardPoint(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ray = this.scene.createPickingRay(clientX - rect.left, clientY - rect.top, Matrix.Identity(), this.camera);
    const distance = ray.intersectsPlane(Plane.FromPositionAndNormal(new Vector3(0, 0.85, 0), Vector3.Up()));
    if (distance === null || distance < 0) return null;
    const point = ray.origin.add(ray.direction.scale(distance));
    return { x: point.x, y: point.z };
  }

  pickLens(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const pick = this.scene.pick(clientX - rect.left, clientY - rect.top,
      (mesh) => mesh.metadata?.lensIndex !== undefined);
    const index: unknown = pick?.pickedMesh?.metadata?.lensIndex;
    return typeof index === 'number' ? index : null;
  }

  resize(): void {
    this.engine.resize();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const narrow = width < 800;
    const sidebar = narrow ? 0 : width < 1150 ? 255 : 315;
    const scale = Math.max(12, Math.min((width - sidebar - 110) / 25,
      (height - (narrow ? 350 : 345)) / (narrow ? 14 : 15)));
    this.camera.orthoLeft = -width / scale / 2;
    this.camera.orthoRight = width / scale / 2;
    this.camera.orthoTop = height / scale / 2;
    this.camera.orthoBottom = -height / scale / 2;
    const alpha = -1.91;
    const right = new Vector3(-Math.sin(alpha), 0, Math.cos(alpha));
    const target = right.scale(-sidebar / scale / 2);
    target.y = narrow ? 1.0 : 0.15;
    this.camera.setTarget(target);
    this.camera.alpha = alpha;
    this.camera.beta = 0.84;
    this.camera.radius = 38;
    this.scene.updateTransformMatrix(true);
    this.refreshShadows();
  }

  private refreshShadows(): void {
    this.shadows.getShadowMap()?.resetRefreshCounter();
  }

  private clearPaths(): void {
    this.prediction?.dispose();
    this.trail?.dispose();
    this.ghost?.dispose();
    this.prediction = this.trail = this.ghost = null;
    this.lastPrediction = this.lastRecording = this.lastGhost = null;
    this.trailTimes = [];
  }

  dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}
