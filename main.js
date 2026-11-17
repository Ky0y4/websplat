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
    Quat,
    Color,
    StandardMaterial
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

    new Asset('wall', 'gsplat', {
        url: './wallsl/lod-meta.json'
    })
];


const loader = new AssetListLoader(assets, app.assets);
await new Promise(resolve => loader.load(resolve));

// ----------------------------------------------------
// Camera Rig
// ----------------------------------------------------

const rig = new Entity('Rig');
app.root.addChild(rig);

rig.setPosition(0.5, 2, 0);


// Camera
const camera = new Entity('Camera');

camera.addComponent('camera', {
    clearColor: [0, 0, 0, 0]
});

camera.addComponent('script');
camera.script.create('cameraControls');


// Camera becomes child of rig
rig.addChild(camera); 

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

        camera.script.cameraControls.enabled = false;

        camera.camera.startXr(
            XRTYPE_AR,
            XRSPACE_LOCALFLOOR,
            {
                callback: (err) => {
                    if (err) {
                        console.error(err);
                    }
                }
            }
        );

    } else {
        alert("AR not supported");
    }

});

// ----------------------------------------------------
// LIGHTING
// ----------------------------------------------------

const light = new Entity('Light');
light.addComponent('light', {
    type: 'directional',
    color: new Color(1, 1, 1),
    intensity: 5
});
light.setEulerAngles(45, 30, 0); // angle it so surfaces aren't flat-lit
app.root.addChild(light);

// ----------------------------------------------------
// CONTROLLERS
// ----------------------------------------------------

let leftController = null;
let rightController = null;
const activeControllers = [];

app.xr.input.on("add", (inputSource) => {

    if (activeControllers.some(e => e._inputSource === inputSource)) {
        return;  
    }

    console.log("Controller connected:", inputSource.handedness);

    if (inputSource.handedness === "left")
        leftController = inputSource;

    if (inputSource.handedness === "right")
        rightController = inputSource;

    const entity = new Entity('Controller');
    entity._inputSource = inputSource;
    camera.addChild(entity);
    activeControllers.push(entity);

    const rayEntity = new Entity('Ray');
    rayEntity.addComponent('render', { type: 'cylinder' });
    rayEntity.setLocalScale(0.005, 5, 0.005);
    const rayMat = new StandardMaterial();
    rayMat.emissive = new Color(1, 1, 1);
    rayMat.update();
    rayEntity.render.meshInstances.forEach(mi => mi.material = rayMat);   // ← changed from [0] to all instances
    entity.addChild(rayEntity);
    entity._rayEntity = rayEntity;
    entity._rayMat = rayMat;

    const profileId = inputSource.profiles[0];
    const handedness = inputSource.handedness;
    const url = `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/${profileId}/${handedness}.glb`;

    app.assets.loadFromUrlAndFilename(url, 'controller.glb', 'container', (err, containerAsset) => {
        if (err) {
            console.error('Controller model load failed:', err);
            return;
        }
        const modelRoot = containerAsset.resource.instantiateRenderEntity();
        entity.addChild(modelRoot);
    });

    inputSource.once('remove', () => {
        const idx = activeControllers.indexOf(entity);
        if (idx !== -1) activeControllers.splice(idx, 1);
        entity.destroy();
    });

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

// ----------------------------------------------------
// SPLAT MANIPULATION
// ----------------------------------------------------
// Right grip (hold): grab the splat and move / turn it with your hand.
//                    Rotation is yaw-only so the splat always stays upright.
// X + A (hold):      scale the splat around the midpoint between your hands.
//                    Moving both hands while scaling also drags the splat.

const RAD_TO_DEG = 180 / Math.PI;

const grabState = {
    active: false,
    startYaw: 0,
    startOffset: new Vec3(),   // splat position - hand position, at grab start
    startRot: new Quat()       // splat rotation at grab start
};

const scaleState = {
    active: false,
    startDistance: 0,
    startScale: 1,
    startOffset: new Vec3()    // splat position - hands midpoint, at scale start
};

// scratch
const tmpDir = new Vec3();
const tmpVec = new Vec3();
const tmpMid = new Vec3();
const tmpQuat = new Quat();
const tmpQuat2 = new Quat();
const FORWARD = new Vec3(0, 0, -1);

function isPressed(src, index) {
    return !!(src && src.gamepad && src.gamepad.buttons &&
        src.gamepad.buttons[index] && src.gamepad.buttons[index].pressed);
}

function pulse(src, intensity = 0.5, ms = 40) {
    const actuator = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (actuator && actuator.pulse) actuator.pulse(intensity, ms);
}

// Heading of a rotation around the world up axis, in degrees.
// Returns null when pointing almost straight up/down (heading is undefined).
function getYaw(rot) {
    rot.transformVector(FORWARD, tmpDir);
    if (tmpDir.x * tmpDir.x + tmpDir.z * tmpDir.z < 1e-4) return null;
    return Math.atan2(-tmpDir.x, -tmpDir.z) * RAD_TO_DEG;
}

function updateSplatManipulation() {

    const leftPos = leftController && leftController.getPosition();
    const rightPos = rightController && rightController.getPosition();
    const rightRot = rightController && rightController.getRotation();

    // ---------- SCALE (X + A) — takes priority over grab ----------
    const wantScale = isPressed(leftController, 4) && isPressed(rightController, 4) && leftPos && rightPos;

    if (wantScale) {
        grabState.active = false;

        tmpMid.copy(leftPos).add(rightPos).mulScalar(0.5);
        const distance = leftPos.distance(rightPos);

        if (!scaleState.active) {
            if (distance < 1e-3) return;
            scaleState.active = true;
            scaleState.startDistance = distance;
            scaleState.startScale = splatRoot.getLocalScale().x;
            scaleState.startOffset.copy(splatRoot.getPosition()).sub(tmpMid);
            pulse(leftController);
            pulse(rightController);
        }

        const factor = distance / scaleState.startDistance;
        const s = scaleState.startScale * factor;
        splatRoot.setLocalScale(s, s, s);

        // Keep the point between your hands fixed on the splat
        tmpVec.copy(scaleState.startOffset).mulScalar(factor).add(tmpMid);
        splatRoot.setPosition(tmpVec);
        return;
    }
    scaleState.active = false;

    // ---------- GRAB (right grip) ----------
    const wantGrab = isPressed(rightController, 1) && rightPos && rightRot;

    if (!wantGrab) {
        grabState.active = false;
        return;
    }

    const yaw = getYaw(rightRot);

    // (Re)anchor on grab start, or once a valid heading appears if the
    // controller was pointing straight up/down when the grab began.
    if (!grabState.active || (grabState.startYaw === null && yaw !== null)) {
        if (!grabState.active) pulse(rightController);
        grabState.active = true;
        grabState.startYaw = yaw;
        grabState.startOffset.copy(splatRoot.getPosition()).sub(rightPos);
        grabState.startRot.copy(splatRoot.getRotation());
    }

    const deltaYaw = (yaw === null || grabState.startYaw === null) ? 0 : yaw - grabState.startYaw;
    tmpQuat.setFromEulerAngles(0, deltaYaw, 0);

    // position = hand + (rotated start offset)
    tmpQuat.transformVector(grabState.startOffset, tmpVec);
    tmpVec.add(rightPos);
    splatRoot.setPosition(tmpVec);

    // rotation = yawDelta * startRotation
    tmpQuat2.mul2(tmpQuat, grabState.startRot);
    splatRoot.setRotation(tmpQuat2);
}

// ----------------------------------------------------
// UPDATE
// ----------------------------------------------------

app.on("update", (dt) => {

    for (const entity of activeControllers) {
        const src = entity._inputSource;

        const pos = src.getPosition();
        const rot = src.getRotation();

        if (src.grip && pos && rot) {
            entity.enabled = true;
            entity.setPosition(pos);
            entity.setRotation(rot);
        } else {
            entity.enabled = false;
        }

        const ray = entity._rayEntity;
        const origin = src.getOrigin();
        const dir = src.getDirection();

        if (ray && origin && dir) {
            ray.setPosition(
                origin.x + dir.x * 2.5,
                origin.y + dir.y * 2.5,
                origin.z + dir.z * 2.5
            );
            ray.lookAt(
                origin.x + dir.x,
                origin.y + dir.y,
                origin.z + dir.z
            );
            ray.rotateLocal(-90, 0, 0);

            const isSelecting = src.selecting || (src.gamepad && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed);
            entity._rayMat.emissive.set(isSelecting ? 0 : 1, 1, isSelecting ? 0 : 1);
            entity._rayMat.update();
        }
    }

    // ----------------------------------------------------
    // TURNING
    // ----------------------------------------------------

    if (rightController && rightController.gamepad) {

        const rAxes = rightController.gamepad.axes;

        let rx = 0;

        if (rAxes && rAxes.length >= 2) {

            rx = rAxes[rAxes.length - 2];

            if (Math.abs(rx) < 0.1)
                rx = 0;
        }


        if (rx !== 0) {

            rig.rotateLocal(
                0,
                -rx * 90 * dt,
                0
            );

        }
    }

    // ----------------------------------------------------
    // GRAB / SCALE SPLAT
    // ----------------------------------------------------

    updateSplatManipulation();

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


    // Rig-relative forward
    forward.copy(rig.forward);
    forward.y = 0;
    forward.normalize();

    move.set(0,0,0);
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


    // move player instead of moving world
    rig.translate(
        velocity.clone().mulScalar(dt)
    );

});

// ----------------------------------------------------

app.xr.on("end", () => {

    camera.script.cameraControls.enabled = true;  

});

