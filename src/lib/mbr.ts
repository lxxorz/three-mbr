/**
 * base on https://en.wikipedia.org/wiki/Rotating_calipers
 */
import { Vector2, Vector3, Matrix4, Box3 } from 'three';

export class MinimumBoundingRectangle {
    public center: Vector3;
    public halfSizes: Vector3;
    public rotation: Matrix4;

    constructor() {
        this.center = new Vector3();
        this.halfSizes = new Vector3();
        this.rotation = new Matrix4();
    }

    public fromPoints(points: number[]): MinimumBoundingRectangle {
        if (points.length < 9) {
            console.warn('Not enough points for MBR calculation');
            return this;
        }

        // 1. 提取XZ平面的点和Y轴范围
        const points2D: Vector2[] = [];
        let minY = Infinity;
        let maxY = -Infinity;
        const tempVec = new Vector3();
        const epsilon = 1e-6;

        // 使用质心作为参考点以提高数值稳定性
        let centroidX = 0, centroidZ = 0;
        for (let i = 0; i < points.length; i += 3) {
            centroidX += points[i];
            centroidZ += points[i + 2];
        }
        centroidX /= points.length / 3;
        centroidZ /= points.length / 3;

        // 预处理：移除重复点并进行相对坐标转换
        const uniquePoints = new Map<string, Vector2>();
        for (let i = 0; i < points.length; i += 3) {
            // 相对于质心的坐标
            const rx = points[i] - centroidX;
            const y = points[i + 1];
            const rz = points[i + 2] - centroidZ;

            // 使用固定精度去重
            const key = `${Math.round(rx/epsilon)},${Math.round(rz/epsilon)}`;
            if (!uniquePoints.has(key)) {
                uniquePoints.set(key, new Vector2(rx, rz));
                points2D.push(uniquePoints.get(key)!);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                tempVec.add(new Vector3(points[i], y, points[i + 2]));
            }
        }

        if (points2D.length < 3) {
            console.warn('Not enough unique points for MBR calculation');
            return this;
        }

        // 2. 计算凸包
        const hull = this.grahamScan(points2D);

        // 3. 使用改进的旋转卡尺算法
        const result = this.enhancedRotatingCalipers(hull);

        // 4. 还原到原始坐标系统
        result.center.x += centroidX;
        result.center.y += centroidZ;

        // 5. 设置结果
        this.center.set(result.center.x, (minY + maxY) * 0.5, result.center.y);
        this.halfSizes.set(result.width * 0.5, (maxY - minY) * 0.5, result.height * 0.5);
        this.rotation.makeRotationY(-result.angle);

        return this;
    }

    private enhancedRotatingCalipers(hull: Vector2[]): {
        center: Vector2;
        width: number;
        height: number;
        angle: number;
    } {
        if (hull.length < 3) {
            return { center: new Vector2(), width: 0, height: 0, angle: 0 };
        }

        let minArea = Infinity;
        let bestRect = null;

        // 获取所有边的方向
        const edges = this.getUniqueEdgeDirections(hull);

        // 对每个方向进行检查
        for (const direction of edges) {
            // 计算垂直方向
            const perpendicular = new Vector2(-direction.y, direction.x);

            // 计算支撑线
            const { minProj: left, maxProj: right } = this.getExtremeProjections(hull, direction);
            const { minProj: bottom, maxProj: top } = this.getExtremeProjections(hull, perpendicular);

            const width = right - left;
            const height = top - bottom;
            const area = width * height;

            if (area < minArea) {
                minArea = area;
                const angle = Math.atan2(direction.y, direction.x);

                // 计算中心点
                const center = new Vector2(
                    (left + right) * direction.x / 2 + (bottom + top) * perpendicular.x / 2,
                    (left + right) * direction.y / 2 + (bottom + top) * perpendicular.y / 2
                );

                bestRect = { center, width, height, angle };
            }
        }

        return bestRect || { center: new Vector2(), width: 0, height: 0, angle: 0 };
    }

    private getUniqueEdgeDirections(hull: Vector2[]): Vector2[] {
        const directions: Vector2[] = [];
        const epsilon = 1e-10;

        for (let i = 0; i < hull.length; i++) {
            const p1 = hull[i];
            const p2 = hull[(i + 1) % hull.length];
            const edge = new Vector2(p2.x - p1.x, p2.y - p1.y).normalize();

            // 检查是否已存在相似方向
            let isUnique = true;
            for (const dir of directions) {
                if (Math.abs(edge.dot(dir) - 1) < epsilon) {
                    isUnique = false;
                    break;
                }
            }
            if (isUnique) {
                directions.push(edge);
            }
        }

        return directions;
    }

    private getExtremeProjections(points: Vector2[], direction: Vector2): {
        minProj: number;
        maxProj: number;
    } {
        let minProj = Infinity;
        let maxProj = -Infinity;

        for (const point of points) {
            const proj = point.dot(direction);
            minProj = Math.min(minProj, proj);
            maxProj = Math.max(maxProj, proj);
        }

        return { minProj, maxProj };
    }

    private grahamScan(points: Vector2[]): Vector2[] {
        if (points.length < 3) return points;

        // 找到最下方的点
        let bottomPoint = points[0];
        let bottomIndex = 0;
        for (let i = 1; i < points.length; i++) {
            if (points[i].y < bottomPoint.y ||
               (points[i].y === bottomPoint.y && points[i].x < bottomPoint.x)) {
                bottomPoint = points[i];
                bottomIndex = i;
            }
        }

        // 按极角排序
        const sortedPoints = points
            .filter((_, i) => i !== bottomIndex)
            .sort((a, b) => {
                const angleA = Math.atan2(a.y - bottomPoint.y, a.x - bottomPoint.x);
                const angleB = Math.atan2(b.y - bottomPoint.y, b.x - bottomPoint.x);
                if (Math.abs(angleA - angleB) < 1e-10) {
                    // 如果角度相同，选择距离较近的点
                    const distA = a.distanceTo(bottomPoint);
                    const distB = b.distanceTo(bottomPoint);
                    return distA - distB;
                }
                return angleA - angleB;
            });
        sortedPoints.unshift(bottomPoint);

        // Graham扫描
        const stack = [sortedPoints[0], sortedPoints[1]];
        for (let i = 2; i < sortedPoints.length; i++) {
            while (stack.length >= 2 &&
                   this.crossProduct(stack[stack.length - 2],
                                   stack[stack.length - 1],
                                   sortedPoints[i]) <= 0) {
                stack.pop();
            }
            stack.push(sortedPoints[i]);
        }

        return stack;
    }

    private crossProduct(p1: Vector2, p2: Vector2, p3: Vector2): number {
        return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    }

    public toBox3(target: Box3): Box3 {
        const vertices = [
            new Vector3(-this.halfSizes.x, -this.halfSizes.y, -this.halfSizes.z),
            new Vector3(this.halfSizes.x, -this.halfSizes.y, -this.halfSizes.z),
            new Vector3(this.halfSizes.x, this.halfSizes.y, -this.halfSizes.z),
            new Vector3(-this.halfSizes.x, this.halfSizes.y, -this.halfSizes.z),
            new Vector3(-this.halfSizes.x, -this.halfSizes.y, this.halfSizes.z),
            new Vector3(this.halfSizes.x, -this.halfSizes.y, this.halfSizes.z),
            new Vector3(this.halfSizes.x, this.halfSizes.y, this.halfSizes.z),
            new Vector3(-this.halfSizes.x, this.halfSizes.y, this.halfSizes.z)
        ];

        vertices.forEach(vertex => {
            vertex.applyMatrix4(this.rotation).add(this.center);
        });

        return target.setFromPoints(vertices);
    }
}
