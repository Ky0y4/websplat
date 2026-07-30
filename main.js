import {
    Application,
    Asset,
    AssetListLoader,
    Entity,
    FILLMODE_FILL_WINDOW,
    RESOLUTION_AUTO,
    XRTYPE_AR,
    XRSPACE_LOCALFLOOR,
    Vec3,
    XRDEPTHSENSINGUSAGE_GPU,
    XRDEPTHSENSINGFORMAT_F32,
    XREYE_NONE,
    TYPE_FLOAT32,
    PIXELFORMAT_R32F,
    Mat4
} from 'playcanvas';

// ----------------------------------------------------
// Create application
// ----------------------------------------------------

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const app = new Application(canvas, {
    graphicsDeviceOptions: {
        antialias: false,
        alpha: true
    }
});

app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);
app.start();

window.addEventListener('resize', () => app.resizeCanvas());

// ----------------------------------------------------
// Load assets
// ----------------------------------------------------

const assets = [
    new Asset('camera-controls', 'script', {
        url: 'https://cdn.jsdelivr.net/npm/playcanvas/scripts/esm/camera-controls.mjs'
    }),

    new Asset('vrlab', 'gsplat', {
        url: './streamed/lod-meta.json'
    })
];

const loader = new AssetListLoader(assets, app.assets);
await new Promise(resolve => loader.load(resolve));

// ----------------------------------------------------
// Camera
// ----------------------------------------------------

const camera = new Entity('Camera');

camera.setPosition(0.5, 2, 0);

camera.addComponent('camera', {
    clearColor: [0, 0, 0, 0]
});

camera.addComponent('script');
camera.script.create('cameraControls');

app.root.addChild(camera);

// ----------------------------------------------------
// SPLAT ROOT
// ----------------------------------------------------

const splatRoot = new Entity("SplatRoot");
app.root.addChild(splatRoot);
splatRoot.setPosition(0, 0, 0);

// ----------------------------------------------------
// SPLAT
// ----------------------------------------------------

const splat = new Entity("Vr Lab");

// Your current import offsets
splat.setPosition(0, -0.7, 0);
splat.setEulerAngles(0, 0, 180);

splat.addComponent("gsplat", {
    asset: assets[1]
});

splatRoot.addChild(splat);


// ----------------------------------------------------
// GSPLAT DEPTH OCCLUSION SETUP 
// ----------------------------------------------------
// Give every splat a per-splat "distance from camera" value
app.scene.gsplat.varyings.add([
    { name: 'camDist', type: TYPE_FLOAT32, components: 1 }
]);

// --- Vertex chunk: compute each splat's distance from the camera ---
const gsplatVS = `
uniform vec3 uCameraPosition; // camera position, pre-converted to splat model space

void modifySplatCenter(inout vec3 center) {
    float d = length(center - uCameraPosition);
    setVaryingCamDist(d);
}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    // no changes needed
}

void modifySplatColor(vec3 center, inout vec4 color) {
    // no changes needed — this is the per-splat VS hook, separate from your fragment PS hook
}
`;
// --- Fragment chunk: compare against real-world depth, fade alpha ---
const gsplatPS = `
uniform mat4 matrix_depth_uv;
uniform float depth_raw_to_meters;

#ifdef XRDEPTH_ARRAY
    uniform int view_index;
    uniform highp sampler2DArray depthMap;
#else
    uniform sampler2D depthMap;
#endif

void modifySplatColor(vec2 gaussianUV, inout vec4 color) {
    float splatDist = getVaryingCamDist();

    vec2 uvScreen = gl_FragCoord.xy * uScreenSize.zw;

    #ifdef XRDEPTH_ARRAY
        // two eyes packed side by side in normalized screen space
        uvScreen = uvScreen * vec2(2.0, 1.0) - vec2(float(view_index), 0.0);
        vec2 uvNorm = (matrix_depth_uv * vec4(uvScreen, 0.0, 1.0)).xy;
        vec3 uv = vec3(uvNorm, view_index);
    #else
        vec2 uv = (matrix_depth_uv * vec4(uvScreen.x, 1.0 - uvScreen.y, 0.0, 1.0)).xy;
    #endif

    #ifdef XRDEPTH_FLOAT
        #ifdef XRDEPTH_ARRAY
            float realDist = texture(depthMap, uv).r * depth_raw_to_meters;
        #else
            float realDist = texture2D(depthMap, uv).r * depth_raw_to_meters;
        #endif
    #else
        #ifdef XRDEPTH_ARRAY
            vec2 packed = texture(depthMap, uv).ra;
        #else
            vec2 packed = texture2D(depthMap, uv).ra;
        #endif
        float realDist = dot(packed, vec2(255.0, 256.0 * 255.0)) * depth_raw_to_meters;
    #endif

    float margin = 0.05;
    float occlusion = clamp((splatDist - realDist) / margin, 0.0, 1.0);
    color.a *= (1.0 - occlusion);
}
`;

const sceneMat = app.scene.gsplat.material;
sceneMat.getShaderChunks('glsl').set('gsplatModifyVS', gsplatVS);
sceneMat.getShaderChunks('glsl').set('gsplatModifyPS', gsplatPS);
sceneMat.update();

// ----------------------------------------------------
// XR BUTTON
// ----------------------------------------------------

const button = document.createElement('button');

button.textContent = 'Enter AR';

button.style.cssText =
`
position:fixed;
bottom:20px;
left:50%;
transform:translateX(-50%);
z-index:10;
padding:12px 24px;
font-size:16px;
`;

document.body.appendChild(button);

button.addEventListener('click', () => {
    if (app.xr.supported && app.xr.isAvailable(XRTYPE_AR)) {
        camera.script.enabled = false;

        camera.camera.startXr(
            XRTYPE_AR,
            XRSPACE_LOCALFLOOR,
            {
                depthSensing: {
                    usagePreference: XRDEPTHSENSINGUSAGE_GPU,
                    dataFormatPreference: XRDEPTHSENSINGFORMAT_F32
                },
                callback: (err) => {
                    if (err) console.error(err);
                }
            }
        );
    } else {
        alert("AR not supported");
    }
});

// ----------------------------------------------------
// CONTROLLERS
// ----------------------------------------------------

let leftController = null;
let rightController = null;

app.xr.input.on("add", (inputSource) => {

    console.log("Controller connected:", inputSource.handedness);

    if (inputSource.handedness === "left")
        leftController = inputSource;

    if (inputSource.handedness === "right")
        rightController = inputSource;

});

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------

const moveSpeed = 1.0;
const smoothing = 5.0; // higher = snappier, lower = floatier

let velocity = new Vec3();

// scratch vectors (avoid allocating every frame)
const forward = new Vec3();
const move = new Vec3();
const target = new Vec3();

const worldToModel = new Mat4();
const camPosModel = new Vec3();
const camPosArray = new Float32Array(3);

// ----------------------------------------------------
// UPDATE
// ----------------------------------------------------

app.on("update", (dt) => {

    if (app.xr.active && app.xr.views.availableDepth) {
        const view = app.xr.views.list[0];
        if (view && view.textureDepth) {
            const sceneMat = app.scene.gsplat.material;
            const isStereo = view.eye !== XREYE_NONE;

            sceneMat.setParameter('depthMap', view.textureDepth);
            sceneMat.setParameter('matrix_depth_uv', view.depthUvMatrix.data);
            sceneMat.setParameter('depth_raw_to_meters', view.depthValueToMeters ?? 1.0);
            sceneMat.setDefine('XRDEPTH_ARRAY', isStereo);
            sceneMat.setDefine('XRDEPTH_FLOAT', app.xr.views.depthPixelFormat === PIXELFORMAT_R32F);
        }
    }
    worldToModel.copy(splat.getWorldTransform()).invert();
    worldToModel.transformPoint(camera.getPosition(), camPosModel);
    camPosArray[0] = camPosModel.x;
    camPosArray[1] = camPosModel.y;
    camPosArray[2] = camPosModel.z;
    app.scene.gsplat.material.setParameter('uCameraPosition', camPosArray);

    if (!leftController || !leftController.gamepad) {
        velocity.lerp(velocity, Vec3.ZERO, smoothing * dt);
        return;
    }

    const axes = leftController.gamepad.axes;
    const buttons = leftController.gamepad.buttons;

    let y = 0; // vertical, from joystick

    if (axes && axes.length >= 2) {
        // thumbstick is always the LAST two axes per xr-standard spec
        y = axes[axes.length - 1];
        if (Math.abs(y) < 0.1) y = 0;
    }

    // Camera-relative forward, flattened to horizontal plane
    forward.copy(camera.forward);
    forward.y = 0;
    forward.normalize();

    move.set(0, 0, 0);

    // Trigger = forward, Grip = backward (per xr-standard: buttons[0]=trigger, buttons[1]=grip)
    const trigger = buttons && buttons[0] ? buttons[0].pressed : false;
    const grip = buttons && buttons[1] ? buttons[1].pressed : false;

    if (trigger) move.add(forward);
    if (grip) move.sub(forward);

    // Joystick Y = vertical
    move.y += -y; // stick up = up; flip sign if inverted

    if (move.length() > 1.0) {
        move.normalize();
    }

    target.copy(move).mulScalar(moveSpeed);
    velocity.lerp(velocity, target, smoothing * dt);

    const delta = velocity.clone().mulScalar(-dt);
    splatRoot.setPosition(
        splatRoot.getPosition().x + delta.x,
        splatRoot.getPosition().y + delta.y,
        splatRoot.getPosition().z + delta.z
    );

});

// ----------------------------------------------------

app.xr.on("end", () => {

    camera.script.enabled = true;

});
