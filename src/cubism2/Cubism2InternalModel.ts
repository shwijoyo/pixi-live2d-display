import { InternalModelOptions } from '@/cubism-common';
import { CommonHitArea, CommonLayout, InternalModel } from '@/cubism-common/InternalModel';
import { Cubism2ModelSettings } from './Cubism2ModelSettings';
import { Cubism2MotionManager } from './Cubism2MotionManager';
import { Live2DEyeBlink } from './Live2DEyeBlink';
import { Live2DPhysics } from './Live2DPhysics';
import { Live2DPose } from './Live2DPose';

// prettier-ignore
const tempMatrixArray = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

/**
 * A wrapper of core model, which is `Live2DModelWebGL` from Live2D runtime library.
 */
export class Cubism2InternalModel extends InternalModel {
    settings: Cubism2ModelSettings;

    coreModel: Live2DModelWebGL;
    motionManager: Cubism2MotionManager;

    eyeBlink?: Live2DEyeBlink;
    physics?: Live2DPhysics;
    pose?: Live2DPose;

    /**
     * Live2D parameter index, cached for better performance.
     */
    eyeballXParamIndex: number;
    eyeballYParamIndex: number;
    angleXParamIndex: number;
    angleYParamIndex: number;
    angleZParamIndex: number;
    bodyAngleXParamIndex: number;
    breathParamIndex: number;

    textureFlipY = true;

    constructor(coreModel: Live2DModelWebGL, settings: Cubism2ModelSettings, options?: InternalModelOptions) {
        super();

        this.coreModel = coreModel;
        this.settings = settings;
        this.motionManager = new Cubism2MotionManager(settings, options);
        this.eyeBlink = new Live2DEyeBlink(coreModel);

        this.eyeballXParamIndex = coreModel.getParamIndex('PARAM_EYE_BALL_X');
        this.eyeballYParamIndex = coreModel.getParamIndex('PARAM_EYE_BALL_Y');
        this.angleXParamIndex = coreModel.getParamIndex('PARAM_ANGLE_X');
        this.angleYParamIndex = coreModel.getParamIndex('PARAM_ANGLE_Y');
        this.angleZParamIndex = coreModel.getParamIndex('PARAM_ANGLE_Z');
        this.bodyAngleXParamIndex = coreModel.getParamIndex('PARAM_BODY_ANGLE_X');
        this.breathParamIndex = coreModel.getParamIndex('PARAM_BREATH');

        this.init();
    }

    protected init() {
        super.init();

        if (this.settings.initParams) {
            this.settings.initParams.forEach(({ id, value }) => this.coreModel.setParamFloat(id, value));
        }
        if (this.settings.initOpacities) {
            this.settings.initOpacities.forEach(({ id, value }) => this.coreModel.setPartsOpacity(id, value));
        }

        this.coreModel.saveParam();
    }

    protected getSize(): [number, number] {
        return [this.coreModel.getCanvasWidth(), this.coreModel.getCanvasHeight()];
    }

    protected getLayout(): CommonLayout {
        const layout = this.settings.layout || {};

        return {
            ...layout,
            centerX: layout.center_x,
            centerY: layout.center_y,
        };
    }

    /** @override */
    updateWebGLContext(gl: WebGLRenderingContext, glContextID: number): void {
        const drawParamWebGL = this.coreModel.drawParamWebGL;

        drawParamWebGL.firstDraw = true;
        drawParamWebGL.setGL(gl);
        drawParamWebGL.glno = glContextID;

        // reset WebGL buffers
        for (const prop in drawParamWebGL) {
            if (drawParamWebGL.hasOwnProperty(prop) && (drawParamWebGL as any)[prop] instanceof WebGLBuffer) {
                (drawParamWebGL as any)[prop] = null;
            }
        }

        // a temporary workaround for the frame buffers bound to WebGL context in Live2D
        const clipManager = this.coreModel.getModelContext().clipManager;
        clipManager.curFrameNo = glContextID;
        clipManager.getMaskRenderTexture();
    }

    /** @override */
    bindTexture(index: number, texture: WebGLTexture): void {
        this.coreModel.setTexture(index, texture);
    }

    protected getHitAreaDefs(): CommonHitArea[] {
        return this.settings.hitAreas?.map(hitArea => ({
            id: hitArea.id,
            name: hitArea.name,
            index: this.coreModel.getDrawDataIndex(hitArea.id),
        })) || [];
    }

    getDrawableIDs(): string[] {
        const arr: unknown = this.coreModel.getModelContext()._$aS;

        if (Array.isArray(arr) && arr.length) {
            // a type guard that predicates the argument is an instance of Live2DObfuscated.Unknown_b
            const isClassB = (
                (arg: any) => !!(arg as Live2DObfuscated.Unknown_b).getDrawDataID
            ) as (arg: any) => arg is Live2DObfuscated.Unknown_b;

            // let's do a fast check on the first item
            if (isClassB(arr[0])) {
                const ids = [];

                for (const item of arr) {
                    if (isClassB(item)) {
                        ids.push(item.getDrawDataID().id);
                    }
                }

                return ids;
            }
        }

        return [];
    }

    getDrawableIndex(id: string): number {
        return this.coreModel.getDrawDataIndex(id);
    }

    getDrawableVertices(drawIndex: number | string): Float32Array {
        if (typeof drawIndex === 'string') {
            drawIndex = this.coreModel.getDrawDataIndex(drawIndex);

            if (drawIndex === -1) throw new TypeError('Unable to find drawable ID: ' + drawIndex);
        }

        return this.coreModel.getTransformedPoints(drawIndex).slice();
    }

    update(dt: DOMHighResTimeStamp, now: DOMHighResTimeStamp): void {
        super.update(dt, now);

        const model = this.coreModel;

        this.emit('beforeMotionUpdate');

        const motionUpdated = this.motionManager.update(this.coreModel, now);

        this.emit('afterMotionUpdate');

        model.saveParam();

        if (!motionUpdated) {
            this.eyeBlink?.update(dt);
        }

        this.updateFocus();
        this.updateNaturalMovements(dt, now);

        this.physics?.update(now);
        this.pose?.update(dt);

        this.emit('beforeModelUpdate');

        model.update();
        model.loadParam();
    }

    updateFocus() {
        this.coreModel.addToParamFloat(this.eyeballXParamIndex, this.focusController.x);
        this.coreModel.addToParamFloat(this.eyeballYParamIndex, this.focusController.y);
        this.coreModel.addToParamFloat(this.angleXParamIndex, this.focusController.x * 30);
        this.coreModel.addToParamFloat(this.angleYParamIndex, this.focusController.y * 30);
        this.coreModel.addToParamFloat(this.angleZParamIndex, this.focusController.x * this.focusController.y * -30);
        this.coreModel.addToParamFloat(this.bodyAngleXParamIndex, this.focusController.x * 10);
    }

    updateNaturalMovements(dt: DOMHighResTimeStamp, now: DOMHighResTimeStamp) {
        const t = (now / 1000) * 2 * Math.PI;

        this.coreModel.addToParamFloat(this.angleXParamIndex, 15 * Math.sin(t / 6.5345) * 0.5);
        this.coreModel.addToParamFloat(this.angleYParamIndex, 8 * Math.sin(t / 3.5345) * 0.5);
        this.coreModel.addToParamFloat(this.angleZParamIndex, 10 * Math.sin(t / 5.5345) * 0.5);
        this.coreModel.addToParamFloat(this.bodyAngleXParamIndex, 4 * Math.sin(t / 15.5345) * 0.5);

        this.coreModel.setParamFloat(this.breathParamIndex, 0.5 + 0.5 * Math.sin(t / 3.2345));
    }

    draw(gl: WebGLRenderingContext, framebuffer?: WebGLFramebuffer): void {
        const matrix = this.drawingMatrix;

        // set given 3x3 matrix into a 4x4 matrix, with Y inverted
        tempMatrixArray[0] = matrix.a;
        tempMatrixArray[1] = matrix.b;
        tempMatrixArray[4] = matrix.c;
        tempMatrixArray[5] = matrix.d;
        tempMatrixArray[12] = matrix.tx;
        tempMatrixArray[13] = matrix.ty;

        this.coreModel.setMatrix(tempMatrixArray);
        this.coreModel.draw();
    }

    destroy() {
        super.destroy();

        // cubism2 core has a super dumb memory management so there's basically nothing much to do to release the model
        (this as Partial<this>).coreModel = undefined;
    }
}
