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
  private tweenGroup: Group | null = null;
  private gui: GUI;
  private axisHelper: THREE.AxesHelper;
  private mbr: MinimumBoundingRectangle;
  private aabb: THREE.Box3;
  private mbrBox: THREE.Box3Helper | null = null;
  private aabbBox: THREE.Box3Helper;
  private mbrLines: THREE.LineSegments | null = null;
  private debugLines: THREE.LineSegments;
  private currentStepIndex: number = -1;
  private calipersSteps: Array<{
    edge: [THREE.Vector2, THREE.Vector2],
    rect: {
      center: THREE.Vector2,
      width: number,
      height: number,
      angle: number
    },
    area: number,
    isMinimum?: boolean
  }> = [];
  private currentEdgeLine: THREE.Line;
  private debugMaterial: THREE.LineBasicMaterial;
  private currentEdgeMaterial: THREE.LineBasicMaterial;

  private config = {
    showAxis: false,
    showAABB: false,
    showMBR: false,
    showHull: false,
    showCalipers: false,
    topView: true,
    autoPlay: false,
    stepDelay: 500
  }

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
    this.gui = new GUI();
    this.initGUI();

    // 坐标轴助手
    this.axisHelper = new THREE.AxesHelper(100);
    this.axisHelper.visible = this.config.showAxis;
    this.scene.add(this.axisHelper);

    // MBR 和 AABB 设置
    this.mbr = new MinimumBoundingRectangle();
    this.aabb = new THREE.Box3();

    // 只保留 AABB 的 Box3Helper
    this.aabbBox = new THREE.Box3Helper(new THREE.Box3(), 0xff0000);
    this.scene.add(this.aabbBox);
    this.aabbBox.visible = this.config.showAABB;

    // 初始化 MBR 线框
    const mbrGeometry = new THREE.BufferGeometry();
    const mbrMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 2
    });
    this.mbrLines = new THREE.LineSegments(mbrGeometry, mbrMaterial);
    this.scene.add(this.mbrLines);
    this.mbrLines.visible = this.config.showMBR;

    // 设置顶视图
    if (this.config.topView) {
      this.camera.position.set(0, 20, 0.001);
      this.camera.lookAt(0, 0, 0);
    } else {
      this.camera.position.set(20, 20, 20);
      this.camera.lookAt(0, 0, 0);
    }

    // 开始动画循环
    this.animate();

    // 只添加一次初始点集
    this.addRandomPoint();

    // 初始化调试线条，使用更细的线条
    const debugGeometry = new THREE.BufferGeometry();
    this.debugMaterial = new THREE.LineBasicMaterial({
      color: 0xffff00,
      linewidth: 2,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false
    });
    this.debugLines = new THREE.LineSegments(debugGeometry, this.debugMaterial);
    this.scene.add(this.debugLines);
    this.debugLines.visible = false;
    this.debugLines.renderOrder = 2;

    // 初始化当前边的高亮显示
    const currentEdgeGeometry = new THREE.BufferGeometry();
    this.currentEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000,
      linewidth: 3,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false
    });
    this.currentEdgeLine = new THREE.Line(currentEdgeGeometry, this.currentEdgeMaterial);
    this.scene.add(this.currentEdgeLine);
    this.currentEdgeLine.visible = false;
  }

  private initGUI(): void {
    // 视图控制
    this.gui.add(this.config, 'topView').name('Top View').onChange((value: boolean) => {
      if (value) {
        this.animateCamera(new THREE.Vector3(0, 20, 0.001), new THREE.Vector3(0, 0, 0));
      } else {
        this.animateCamera(new THREE.Vector3(20, 20, 20), new THREE.Vector3(0, 0, 0));
      }
    });

    // 点的操作
    this.gui.add({ addPoint: this.addRandomPoint.bind(this) }, 'addPoint').name('Add Point');
    this.gui.add({ removePoint: this.removeRandomPoint.bind(this) }, 'removePoint').name('Remove Point');

    // 显示控制
    const displayFolder = this.gui.addFolder('Display');

    displayFolder.add(this.config, 'showAxis').name('Axis').onChange((value: boolean) => {
      this.axisHelper.visible = value;
    });

    displayFolder.add(this.config, 'showAABB').name('AABB').onChange((value: boolean) => {
      this.aabbBox.visible = value;
    });

    displayFolder.add(this.config, 'showMBR').name('MBR').onChange((value: boolean) => {
      if (this.mbrLines) {
        this.mbrLines.visible = value;
      }
    });

    displayFolder.add(this.config, 'showHull').name('Convex Hull').onChange((value: boolean) => {
      this.hullVisible = value;
      if (value) {
        this.updateHull();
      } else {
        this.scene.remove(this.hullLine);
        this.scene.remove(this.hullMesh);
      }
    });

    // 默认展开显示控制文件夹
    displayFolder.open();

    // 添加旋转卡尺控制文件夹
    const calipersFolder = this.gui.addFolder('Rotating Calipers');

    calipersFolder.add(this.config, 'showCalipers').name('Show Process').onChange((value: boolean) => {
      this.debugLines.visible = value;
      this.currentEdgeLine.visible = value;
      if (value) {
        this.startCalipersVisualization();
      } else {
        this.currentStepIndex = -1;
        this.updateDebugLines();
      }
    });

    calipersFolder.add(this.config, 'autoPlay').name('Auto Play').onChange((value: boolean) => {
      if (value) {
        this.autoPlayCalipers();
      }
    });

    calipersFolder.add(this.config, 'stepDelay', 100, 2000).name('Step Delay');

    calipersFolder.add({
      nextStep: () => {
        if (this.config.showCalipers) {
          this.nextCalipersStep();
        }
      }
    }, 'nextStep').name('Next Step');

    calipersFolder.add({
      prevStep: () => {
        if (this.config.showCalipers) {
          this.prevCalipersStep();
        }
      }
    }, 'prevStep').name('Previous Step');

    calipersFolder.add({
      reset: () => {
        if (this.config.showCalipers) {
          this.currentStepIndex = -1;
          this.updateDebugLines();
        }
      }
    }, 'reset').name('Reset');
  }

  private addRandomPoint(): void {
    // 如果是第一批点，生成基础点集
    if (this.points.length === 0) {
      const angle = Math.PI / 6; // 30度倾角
      const mainAxisLength = 8;  // 主轴长度
      const spread = 2;         // 点的横向分散程度
      const height = 3;         // 高度范围

      // 生成主轴上的点，并添加随机偏移
      const numPoints = 15;     // 初始点的数量
      const points: number[] = [];

      for (let i = 0; i < numPoints; i++) {
        // 在主轴上均匀分布
        const t = (i / (numPoints - 1)) * 2 - 1; // -1 到 1

        // 基础位置（在主轴上）
        const baseX = t * mainAxisLength * Math.cos(angle);
        const baseZ = t * mainAxisLength * Math.sin(angle);

        // 添加横向随机偏移
        const offset = (Math.random() - 0.5) * spread;
        // 偏移方向垂直于主轴
        const offsetX = offset * Math.cos(angle + Math.PI/2);
        const offsetZ = offset * Math.sin(angle + Math.PI/2);

        // 随机高度
        const y = (Math.random() - 0.5) * height;

        points.push(
          baseX + offsetX,
          y,
          baseZ + offsetZ
        );
      }

      // 添加这些点
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i];
        const y = points[i + 1];
        const z = points[i + 2];

        this.points.push(x, y, z);
        const pointGeometry = new THREE.SphereGeometry(0.1, 16, 16);
        const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
        pointMesh.position.set(x, y, z);
        this.scene.add(pointMesh);
        this.pointMeshes.push(pointMesh);
      }
    } else {
      // 添加新的随机点
      const angle = Math.PI / 6;
      const mainAxisLength = 8;
      const spread = 3;  // 稍微增加新点的分散程度

      // 随机选择主轴上的位置
      const t = Math.random() * 2 - 1; // -1 到 1

      // 基础位置
      const baseX = t * mainAxisLength * Math.cos(angle);
      const baseZ = t * mainAxisLength * Math.sin(angle);

      // 添加较大的随机偏移
      const offset = (Math.random() - 0.5) * spread;
      // 偏��方向垂直于主轴
      const offsetX = offset * Math.cos(angle + Math.PI/2);
      const offsetZ = offset * Math.sin(angle + Math.PI/2);

      // 随机高度
      const y = (Math.random() - 0.5) * 3;

      const x = baseX + offsetX;
      const z = baseZ + offsetZ;

      this.points.push(x, y, z);
      const pointGeometry = new THREE.SphereGeometry(0.1, 16, 16);
      const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
      pointMesh.position.set(x, y, z);
      this.scene.add(pointMesh);
      this.pointMeshes.push(pointMesh);
    }

    this.updateMBR();
    this.updateBoundingBoxes(this.points);
    this.updateHull();
    // 如果正在显示旋转卡尺，则更新可视化
    if (this.config.showCalipers) {
      this.startCalipersVisualization();
      // 重新开始动画
      if (this.config.autoPlay) {
        this.currentStepIndex = -1;
        this.autoPlayCalipers();
      } else {
        // 显示第一步
        this.currentStepIndex = 0;
        this.updateDebugLines();
      }
    }
  }

  private removeRandomPoint(): void {
    if (this.points.length < 3) return;
    this.points.splice(-3, 3);
    const pointMesh = this.pointMeshes.pop();
    if (pointMesh) {
      this.scene.remove(pointMesh);
    }
    this.updateMBR();
    this.updateBoundingBoxes(this.points);
    this.updateHull();
    // 如果正在显示旋转卡尺，则更新可视化
    if (this.config.showCalipers) {
      this.startCalipersVisualization();
      // 重新开始动画
      if (this.config.autoPlay) {
        this.currentStepIndex = -1;
        this.autoPlayCalipers();
      } else {
        // 显示第一步
        this.currentStepIndex = 0;
        this.updateDebugLines();
      }
    }
  }

  private updateMBR(): void {
    if (!this.mbrLines) return;

    const mbr = new MinimumBoundingRectangle().fromPoints(this.points);

    // 创建包围盒的12条边的顶点
    const vertices: number[] = [];
    const indices: number[] = [];

    // 在本地坐标系中创建顶点
    const corners = [
      new THREE.Vector3(-mbr.halfSizes.x, -mbr.halfSizes.y, -mbr.halfSizes.z),
      new THREE.Vector3(mbr.halfSizes.x, -mbr.halfSizes.y, -mbr.halfSizes.z),
      new THREE.Vector3(mbr.halfSizes.x, mbr.halfSizes.y, -mbr.halfSizes.z),
      new THREE.Vector3(-mbr.halfSizes.x, mbr.halfSizes.y, -mbr.halfSizes.z),
      new THREE.Vector3(-mbr.halfSizes.x, -mbr.halfSizes.y, mbr.halfSizes.z),
      new THREE.Vector3(mbr.halfSizes.x, -mbr.halfSizes.y, mbr.halfSizes.z),
      new THREE.Vector3(mbr.halfSizes.x, mbr.halfSizes.y, mbr.halfSizes.z),
      new THREE.Vector3(-mbr.halfSizes.x, mbr.halfSizes.y, mbr.halfSizes.z),
    ];

    // 应用变换
    const transform = new THREE.Matrix4();
    transform.copy(mbr.rotation);
    transform.setPosition(mbr.center);

    // 变换顶点到世界坐标系
    corners.forEach(v => {
      v.applyMatrix4(transform);
      vertices.push(v.x, v.y, v.z);
    });

    // 定义边的索引
    const edgeIndices = [
      0, 1, 1, 2, 2, 3, 3, 0,  // 前面
      4, 5, 5, 6, 6, 7, 7, 4,  // 后面
      0, 4, 1, 5, 2, 6, 3, 7   // 连接边
    ];

    // 更新几何体
    this.mbrLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.mbrLines.geometry.setIndex(edgeIndices);
    this.mbrLines.geometry.computeBoundingSphere();

    if (this.hullVisible) {
      this.updateHull();
    }
  }

  private updateHull(): void {
    if (!this.config.showHull) return;

    const mbr = new MinimumBoundingRectangle().fromPoints(this.points);
    const hull = mbr.grahamScan(
      Array.from({ length: this.points.length / 3 }, (_, i) =>
        new THREE.Vector2(this.points[i * 3], this.points[i * 3 + 2])
      )
    );

    // 更新凸包线框
    const hullGeometry = new THREE.BufferGeometry().setFromPoints(
      hull.map(p => new THREE.Vector3(p.x, 0, p.y))
    );
    hullGeometry.setIndex([...Array(hull.length).keys(), 0]);
    const hullLineMaterial = new THREE.LineBasicMaterial({
      color: 0x0000ff,
      linewidth: 2
    });

    // 更新凸包面
    const vertices: number[] = [];
    const indices: number[] = [];
    const center = new THREE.Vector2(0, 0);
    hull.forEach(p => center.add(p));
    center.divideScalar(hull.length);

    vertices.push(center.x, 0, center.y);
    hull.forEach(p => vertices.push(p.x, 0, p.y));

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

    // 移除旧的凸包
    this.scene.remove(this.hullLine);
    this.scene.remove(this.hullMesh);

    // 添加新的凸包
    this.hullLine = new THREE.Line(hullGeometry, hullLineMaterial);
    this.hullMesh = new THREE.Mesh(hullShapeGeometry, hullShapeMaterial);

    this.scene.add(this.hullMesh);
    this.scene.add(this.hullLine);
  }

  private animateCamera(targetPosition: THREE.Vector3, targetLookAt: THREE.Vector3): void {
    const duration = 1000;
    this.tweenGroup = new Group();

    // 相机位置动画
    const tweenPos = new Tween(this.camera.position)
      .to({
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z
      }, duration)
      .easing(Easing.Cubic.InOut)
      .start();

    // 控制器目标点动画
    const tweenTarget = new Tween(this.controls.target)
      .to({
        x: targetLookAt.x,
        y: targetLookAt.y,
        z: targetLookAt.z
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

  public updateBoundingBoxes(points: number[]) {
    // 更新MBR
    this.mbr.fromPoints(points);

    // 更新AABB
    const tempVector = new THREE.Vector3();
    this.aabb.makeEmpty();
    for (let i = 0; i < points.length; i += 3) {
      tempVector.set(points[i], points[i + 1], points[i + 2]);
      this.aabb.expandByPoint(tempVector);
    }
    this.aabbBox.box.copy(this.aabb);
  }

  private startCalipersVisualization(): void {
    // 重置步骤
    this.currentStepIndex = -1;
    this.calipersSteps = [];

    // 获取XZ平面上的点
    const points2D = Array.from({ length: this.points.length / 3 }, (_, i) =>
      new THREE.Vector2(this.points[i * 3], this.points[i * 3 + 2])
    );

    // 计算凸包
    const hull = new MinimumBoundingRectangle().grahamScan(points2D);

    // 对每条边进行检查
    for (let i = 0; i < hull.length; i++) {
      const p1 = hull[i];
      const p2 = hull[(i + 1) % hull.length];

      // 计算边的方向向量并归一化
      const edge = new THREE.Vector2(p2.x - p1.x, p2.y - p1.y).normalize();
      const perpendicular = new THREE.Vector2(-edge.y, edge.x);

      // 计算支撑线
      let minProj1 = Infinity, maxProj1 = -Infinity;
      let minProj2 = Infinity, maxProj2 = -Infinity;

      for (const p of hull) {
        const proj1 = p.dot(edge);
        const proj2 = p.dot(perpendicular);
        minProj1 = Math.min(minProj1, proj1);
        maxProj1 = Math.max(maxProj1, proj1);
        minProj2 = Math.min(minProj2, proj2);
        maxProj2 = Math.max(maxProj2, proj2);
      }

      const width = maxProj1 - minProj1;
      const height = maxProj2 - minProj2;
      const area = width * height;

      // 保存这一步的信息
      this.calipersSteps.push({
        edge: [p1, p2],
        rect: {
          center: new THREE.Vector2(
            (minProj1 + maxProj1) / 2 * edge.x + (minProj2 + maxProj2) / 2 * perpendicular.x,
            (minProj1 + maxProj1) / 2 * edge.y + (minProj2 + maxProj2) / 2 * perpendicular.y
          ),
          width,
          height,
          angle: Math.atan2(edge.y, edge.x)
        },
        area
      });
    }

    // 找到最小面积的步骤并标记
    const minArea = Math.min(...this.calipersSteps.map(step => step.area));
    this.calipersSteps.forEach(step => {
      step.isMinimum = step.area === minArea;
    });

    // 初始化显示第一步
    this.currentStepIndex = 0;
    this.updateDebugLines();
  }

  private updateDebugLines(): void {
    if (this.currentStepIndex < 0 || !this.calipersSteps.length) {
        this.debugLines.visible = false;
        this.currentEdgeLine.visible = false;
        return;
    }

    const step = this.calipersSteps[this.currentStepIndex];
    const { edge, rect } = step;

    // 确保材质是可见的，并设置合适的透明度
    this.debugMaterial.opacity = 0.8;  // 增加透明度使其更容易看见
    this.currentEdgeMaterial.opacity = 1;
    this.debugLines.visible = true;
    this.currentEdgeLine.visible = true;

    // 设置渲染顺序
    this.debugLines.renderOrder = 999;
    this.currentEdgeLine.renderOrder = 1000;

    // 显示矩形
    this.showRectangle(rect);

    // 显示当前边
    const edgeDir = new THREE.Vector2()
        .subVectors(edge[1], edge[0])
        .normalize();

    const extendLength = 10; // 减小延伸长度，使其更容易看清
    const startPoint = new THREE.Vector2()
        .copy(edge[0])
        .sub(edgeDir.clone().multiplyScalar(extendLength));
    const endPoint = new THREE.Vector2()
        .copy(edge[1])
        .add(edgeDir.clone().multiplyScalar(extendLength));

    const edgeVertices = [
        new THREE.Vector3(startPoint.x, 0, startPoint.y),
        new THREE.Vector3(endPoint.x, 0, endPoint.y)
    ];

    this.currentEdgeLine.geometry.setFromPoints(edgeVertices);
  }

  private showRectangle(rect: { center: THREE.Vector2; width: number; height: number; angle: number }): void {
    const cos = Math.cos(rect.angle);
    const sin = Math.sin(rect.angle);
    const hw = rect.width / 2;
    const hh = rect.height / 2;

    // 计算矩形的四个顶点
    const vertices = [
        new THREE.Vector3(
            rect.center.x - hw * cos - hh * sin,
            0,
            rect.center.y - hw * sin + hh * cos
        ),
        new THREE.Vector3(
            rect.center.x + hw * cos - hh * sin,
            0,
            rect.center.y + hw * sin + hh * cos
        ),
        new THREE.Vector3(
            rect.center.x + hw * cos + hh * sin,
            0,
            rect.center.y + hw * sin - hh * cos
        ),
        new THREE.Vector3(
            rect.center.x - hw * cos + hh * sin,
            0,
            rect.center.y - hw * sin - hh * cos
        )
    ];

    // 创建线段索引，形成完整的矩形
    const indices = [
        0, 1,
        1, 2,
        2, 3,
        3, 0
    ];

    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(vertices);
    geometry.setIndex(indices);

    this.debugLines.geometry.dispose();
    this.debugLines.geometry = geometry;

    // 设置渲染顺序，确保在其他对象之上
    this.debugLines.renderOrder = 999;
  }

  private nextCalipersStep(): void {
    if (this.currentStepIndex < this.calipersSteps.length - 1) {
      this.currentStepIndex++;
      this.updateDebugLines();
    }
  }

  private prevCalipersStep(): void {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.updateDebugLines();
    }
  }

  private autoPlayCalipers(): void {
    if (!this.config.autoPlay) return;

    // 添加过渡动画
    const duration = this.config.stepDelay * 0.8; // 留出一些时间给动画完成

    this.nextCalipersStep();
    if (this.currentStepIndex < this.calipersSteps.length - 1) {
      setTimeout(() => this.autoPlayCalipers(), this.config.stepDelay);
    } else {
      this.config.autoPlay = false;
      // 最后一步特殊处理
      if (this.calipersSteps[this.currentStepIndex].isMinimum) {
        // 如果是最小面积，添加特殊效果
        new Tween(this.debugMaterial)
          .to({ color: new THREE.Color(0x00ff00) }, 500)
          .start();
      }
    }
  }
}

