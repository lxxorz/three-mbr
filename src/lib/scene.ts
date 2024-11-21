import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import { MinimumBoundingRectangle } from './mbr';
import { Tween, Group, Easing } from '@tweenjs/tween.js';


export class Scene3D {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private points: number[] = [];
  private pointMeshes: THREE.Mesh[] = [];
  private hullLine: THREE.Line;
  private hullMesh: THREE.Mesh;
  private mbrMesh: THREE.Mesh;
  private hullVisible: boolean = false;
  private mbrVisible: boolean = true;
  private tweenGroup: Group | null = null;
  constructor(container: HTMLElement) {
    // 初始化场景
    this.scene = new THREE.Scene();
    // 调整相机视角范围,确保能完整显示几何体
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = 10;
    this.camera = new THREE.OrthographicCamera(
      -viewSize * aspect,
      viewSize * aspect,
      viewSize,
      -viewSize,
      0.1,
      1000
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // 初始化控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    // 设置相机初始位置为斜视角,更好地观察3D效果
    this.camera.position.set(20, 20, 20);
    this.controls.target.set(0, 0, 0);
    this.camera.up.set(0, 1, 0);
    this.controls.update();

    // 初始化网格对象
    this.hullLine = new THREE.Line();
    this.hullMesh = new THREE.Mesh();
    this.mbrMesh = new THREE.Mesh();

    // 设置事件监听
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // 初始化GUI
    this.initGUI();

    // 开始动画循环
    this.animate();

    // 添加初始点
    for (let i = 0; i < 10; i++) {
      this.addRandomPoint();
    }
  }

  private initGUI(): void {
    const gui = new GUI();
    const cameraFolder = gui.addFolder('Camera');
    cameraFolder.add({ resetView: this.lookAtTop.bind(this) }, 'resetView').name('Top View');

    gui.add({ addPoint: this.addRandomPoint.bind(this) }, 'addPoint').name('Add Point');
    gui.add({ removePoint: this.removeRandomPoint.bind(this) }, 'removePoint').name('Remove Point');
    gui.add({
      toggleHull: () => {
        this.hullVisible = !this.hullVisible;
        if (this.hullVisible) {
          this.updateHull();
        } else {
          this.scene.remove(this.hullLine);
          this.scene.remove(this.hullMesh);
        }
      }
    }, 'toggleHull').name('Toggle Hull');
    gui.add({
      toggleMBR: () => {
        this.mbrVisible = !this.mbrVisible;
        if (this.mbrVisible) {
          this.scene.add(this.mbrMesh);
        } else {
          this.scene.remove(this.mbrMesh);
        }
      }
    }, 'toggleMBR').name('Toggle MBR');
  }

  private addRandomPoint(): void {
    const x = Math.random() * 10 - 5;
    const y = Math.random() * 10 - 5;
    const z = Math.random() * 10 - 5;
    this.points.push(x, y, z);

    const pointGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
    pointMesh.position.set(x, y, z);
    this.scene.add(pointMesh);
    this.pointMeshes.push(pointMesh);

    this.updateMBR();
  }

  private removeRandomPoint(): void {
    if (this.points.length < 3) return;
    this.points.splice(-3, 3);
    const pointMesh = this.pointMeshes.pop();
    if (pointMesh) {
      this.scene.remove(pointMesh);
    }
    this.updateMBR();
  }

  private updateMBR(): void {
    const mbr = new MinimumBoundingRectangle().fromPoints(this.points);

    const boxGeometry = new THREE.BoxGeometry(
      mbr.halfSizes.x * 2,
      mbr.halfSizes.y * 2,
      mbr.halfSizes.z * 2
    );
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.3
    });
    const newMbrMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    newMbrMesh.position.copy(mbr.center);
    newMbrMesh.setRotationFromMatrix(mbr.rotation);

    this.scene.remove(this.mbrMesh);
    this.mbrMesh = newMbrMesh;
    if (this.mbrVisible) {
      this.scene.add(this.mbrMesh);
    }

    if (this.hullVisible) {
      this.updateHull();
    }
  }

  private updateHull(): void {
    const mbr = new MinimumBoundingRectangle().fromPoints(this.points);
    const hull = mbr.grahamScan(
      this.points.map((_, i) => new THREE.Vector2(this.points[i * 3], this.points[i * 3 + 2]))
    );

    const hullGeometry = new THREE.BufferGeometry().setFromPoints(
      hull.map(p => new THREE.Vector3(p.x, 0, p.y))
    );
    hullGeometry.setIndex([...Array(hull.length).keys(), 0]);
    const hullLineMaterial = new THREE.LineBasicMaterial({
      color: 0x0000ff,
      linewidth: 2
    });

    const vertices: number[] = [];
    const indices: number[] = [];

    const center = new THREE.Vector2(0, 0);
    hull.forEach(p => {
      center.add(p);
    });
    center.divideScalar(hull.length);

    vertices.push(center.x, 0, center.y);
    hull.forEach(p => {
      vertices.push(p.x, 0, p.y);
    });

    for (let i = 0; i < hull.length; i++) {
      indices.push(0, i + 1, ((i + 1) % hull.length) + 1);
    }

    const hullShapeGeometry = new THREE.BufferGeometry();
    hullShapeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    hullShapeGeometry.setIndex(indices);
    hullShapeGeometry.computeVertexNormals();

    const hullShapeMaterial = new THREE.MeshBasicMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.scene.remove(this.hullLine);
    this.scene.remove(this.hullMesh);

    this.hullLine = new THREE.Line(hullGeometry, hullLineMaterial);
    this.hullMesh = new THREE.Mesh(hullShapeGeometry, hullShapeMaterial);

    if (this.hullVisible) {
      this.scene.add(this.hullMesh);
      this.scene.add(this.hullLine);
    }
  }

  private lookAtTop(): void {
    const duration = 1500;
    this.tweenGroup = new Group();

    // 保持与初始化时相同的视角范围
    const viewSize = 10;

    // 设置目标位置 - 保持与目标点的距离，只改变角度
    const targetPos = new THREE.Vector3(0, viewSize * 2, 0.001); // 高度是视角范围的2倍
    const targetTarget = new THREE.Vector3(0, 0, 0);

    // 相机位置动画
    const tweenPos = new Tween(this.camera.position)
      .to({
        x: targetPos.x,
        y: targetPos.y,
        z: targetPos.z
      }, duration)
      .easing(Easing.Cubic.InOut)
      .start();

    // 控制器目标点动画
    const tweenTarget = new Tween(this.controls.target)
      .to({
        x: targetTarget.x,
        y: targetTarget.y,
        z: targetTarget.z
      }, duration)
      .easing(Easing.Cubic.InOut)
      .start();

    this.tweenGroup.add(tweenPos);
    this.tweenGroup.add(tweenTarget);

    // 确保相机朝向正确
    this.camera.up.set(0, 1, 0);
  }

  private onWindowResize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = 20;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));
    if(this.tweenGroup) {
      this.tweenGroup.update();
    }

    if (this.controls.enabled) {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }
}
