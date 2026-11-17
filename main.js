import {
    Application,
    Asset,
    AssetListLoader,
    Entity,
    FILLMODE_FILL_WINDOW,
    RESOLUTION_AUTO,
    XRTYPE_AR,
    XRTYPE_VR,
    XRSPACE_LOCALFLOOR,
    Vec3,
    Quat,
    Ray,
    BoundingBox,
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
// SPLAT BUDGET
// ----------------------------------------------------
// Max splats drawn at once across the scene. The engine picks LOD levels
// per area to stay under this. Lower = smoother on headset, less detail.

const SPLAT_BUDGET_DESKTOP = 1500000;
const SPLAT_BUDGET_XR = 600000;

// Headset render resolution (1.0 = native). Splats are limited by how many
// pixels they cover, so this is the biggest lever when you're inside a
// large splat. Try 0.7 if it still lags, 0.9 if it looks too soft.
const XR_RESOLUTION_SCALE = 0.8;

function setSplatBudget(budget) {
    if (app.scene.gsplat && 'splatBudget' in app.scene.gsplat) {
        app.scene.gsplat.splatBudget = budget;
    }
}

setSplatBudget(SPLAT_BUDGET_DESKTOP);

// ----------------------------------------------------
// Load assets
// ----------------------------------------------------

const assets = [
    new Asset('camera-controls', 'script', {
        url: 'https://cdn.jsdelivr.net/npm/playcanvas/scripts/esm/camera-controls.mjs'
    }),

    new Asset('sci_east', 'gsplat', {
        url: './scieast/lod-meta.json'
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

// AR = passthrough: you see the real room behind the splat (and through any
//      thin / hollow spots in it).
// VR = no passthrough: the background is a solid colour, so holes in the
//      splat don't show reality.

const VR_BACKGROUND = new Color(0.1, 0.1, 0.12);   // background colour in VR mode
const AR_BACKGROUND = new Color(0, 0, 0, 0);        // transparent = passthrough

const xrButtons = document.createElement('div');
xrButtons.style.cssText = `
position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
z-index:10; display:flex; gap:12px;
`;
document.body.appendChild(xrButtons);

function makeXrButton(label, type) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'padding:12px 24px;font-size:16px;';
    btn.addEventListener('click', () => startXrSession(type));
    xrButtons.appendChild(btn);
}

makeXrButton('Enter AR', XRTYPE_AR);
makeXrButton('Enter VR', XRTYPE_VR);

function startXrSession(type) {
    if (!app.xr.supported || !app.xr.isAvailable(type)) {
        alert(`${type === XRTYPE_AR ? 'AR' : 'VR'} not supported on this device`);
        return;
    }

    camera.camera.clearColor = type === XRTYPE_AR ? AR_BACKGROUND : VR_BACKGROUND;
    camera.script.cameraControls.enabled = false;

    camera.camera.startXr(type, XRSPACE_LOCALFLOOR, {
        framebufferScaleFactor: XR_RESOLUTION_SCALE,
        callback: (err) => {
            if (err) {
                console.error(err);
                camera.camera.clearColor = AR_BACKGROUND;
                camera.script.cameraControls.enabled = true;
            }
        }
    });
}

// ----------------------------------------------------
// LIGHTING
// ----------------------------------------------------

// Ambient fills in faces turned away from the sun (otherwise they're black),
// and a moderate sun intensity stops lit faces clipping to yellow/white.
app.scene.ambientLight = new Color(0.45, 0.45, 0.45);

const light = new Entity('Light');
light.addComponent('light', {
    type: 'directional',
    color: new Color(1, 1, 1),
    intensity: 1.2
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
// Right grip (hold): grab the splat and move it with your hand.
//                    + right stick left/right: rotate (stays upright)
//                    + right stick up/down: push away / pull closer
// X + A (hold):      scale the splat around the midpoint between your hands.
//                    Moving both hands while scaling also drags the splat.

const RAD_TO_DEG = 180 / Math.PI;

const SPLAT_ROTATE_SPEED = 45;  // degrees / second (right stick while gripping)
const SPLAT_PUSH_SPEED = 2.0;   // metres / second (right stick while gripping)

const grabState = {
    active: false,
    yaw: 0,                    // rotation added with the stick during this grab
    push: new Vec3(),          // movement added with the stick during this grab
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

function updateSplatManipulation(dt) {

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
    // Hand movement moves the splat 1:1 (position only, no wrist twist, so a big
    // splat doesn't swing wildly). While gripping, the right stick:
    //   left/right -> rotate the splat around your hand
    //   up/down    -> push the splat away / pull it closer (for big moves)
    const wantGrab = isPressed(rightController, 1) && rightPos && rightRot;

    if (!wantGrab) {
        grabState.active = false;
        return;
    }

    if (!grabState.active) {
        grabState.active = true;
        grabState.yaw = 0;
        grabState.push.set(0, 0, 0);
        grabState.startOffset.copy(splatRoot.getPosition()).sub(rightPos);
        grabState.startRot.copy(splatRoot.getRotation());
        pulse(rightController);
    }

    const axes = rightController.gamepad && rightController.gamepad.axes;
    if (axes && axes.length >= 2) {
        let sx = axes[axes.length - 2];
        let sy = axes[axes.length - 1];
        if (Math.abs(sx) < 0.15) sx = 0;
        if (Math.abs(sy) < 0.15) sy = 0;

        grabState.yaw -= sx * SPLAT_ROTATE_SPEED * dt;

        if (sy !== 0) {
            // horizontal direction the controller points
            rightRot.transformVector(FORWARD, tmpDir);
            tmpDir.y = 0;
            if (tmpDir.lengthSq() > 1e-4) {
                tmpDir.normalize().mulScalar(-sy * SPLAT_PUSH_SPEED * dt); // stick up = away
                grabState.push.add(tmpDir);
            }
        }
    }

    tmpQuat.setFromEulerAngles(0, grabState.yaw, 0);

    // position = hand + (rotated start offset) + push
    tmpQuat.transformVector(grabState.startOffset, tmpVec);
    tmpVec.add(rightPos).add(grabState.push);
    splatRoot.setPosition(tmpVec);

    // rotation = stickYaw * startRotation
    tmpQuat2.mul2(tmpQuat, grabState.startRot);
    splatRoot.setRotation(tmpQuat2);
}

// ----------------------------------------------------
// MESHES
// ----------------------------------------------------
// Load .glb files from your device (button or drag & drop).
// Meshes are children of splatRoot so they stay put relative to the splat
// when you grab / scale it, but they're always kept at real-world size
// (1 unit = 1 metre), so scale the splat to real size first.
//
// In VR:
//   Point right laser at a mesh -> laser turns cyan
//   Right trigger (hold)        -> drag the mesh along the laser
//     + right stick left/right  -> rotate the mesh
//     + right stick up/down     -> push away / pull closer
//   B (right controller)        -> bring the last-added mesh in front of you
//   Y (left controller)         -> spawn a test box in front of you

const meshes = [];   // { entity, name, asset }

const meshGrab = {
    entry: null,
    distance: 0,
    offset: new Vec3(),     // mesh position - hit point, at grab start
    startRot: new Quat(),
    yaw: 0                  // extra rotation from the stick while held
};

const MESH_ROTATE_SPEED = 90;   // degrees / second
const MESH_PUSH_SPEED = 1.5;    // metres / second
const MESH_MIN_DISTANCE = 0.2;

const ray = new Ray();
const meshBox = new BoundingBox();
const hitPoint = new Vec3();
const meshTmp = new Vec3();
const meshTmpQuat = new Quat();
let prevBPressed = false;
let prevYPressed = false;
let boxCount = 0;

// ---------- UI ----------

const panel = document.createElement('div');
panel.style.cssText = `
position:fixed; top:12px; left:12px; z-index:10;
background:rgba(20,20,20,0.75); color:#fff; padding:10px 12px;
border-radius:8px; font:14px sans-serif; max-width:260px;
`;
panel.innerHTML = `
<button id="addMeshBtn" style="padding:8px 12px;font-size:14px;">Add mesh (.glb)</button>
<button id="addBoxBtn" style="padding:8px 12px;font-size:14px;">Add box</button>
<input id="meshFileInput" type="file" accept=".glb" multiple style="display:none">
<div style="margin-top:6px;opacity:0.7;font-size:12px;">or drag .glb files onto the page</div>
<ul id="meshList" style="list-style:none;padding:0;margin:8px 0 0;"></ul>
`;
document.body.appendChild(panel);

const fileInput = panel.querySelector('#meshFileInput');
const meshListEl = panel.querySelector('#meshList');

panel.querySelector('#addMeshBtn').addEventListener('click', () => fileInput.click());
panel.querySelector('#addBoxBtn').addEventListener('click', () => addBox());

fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) addMeshFromFile(file);
    fileInput.value = '';   // allow picking the same file again
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
        if (file.name.toLowerCase().endsWith('.glb')) addMeshFromFile(file);
    }
});

function refreshMeshList() {
    meshListEl.innerHTML = '';
    for (const entry of meshes) {
        const li = document.createElement('li');
        li.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px;';

        const label = document.createElement('span');
        label.textContent = entry.name;
        label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

        const bring = document.createElement('button');
        bring.textContent = 'Bring here';
        bring.title = 'Move in front of the camera';
        bring.addEventListener('click', () => placeInFront(entry.entity));

        const remove = document.createElement('button');
        remove.textContent = '✕';
        remove.title = 'Remove';
        remove.addEventListener('click', () => removeMesh(entry));

        li.append(label, bring, remove);
        meshListEl.appendChild(li);
    }
}

// ---------- load / place / remove ----------

// Simple test box: 1 m wide, 0.5 m tall, 0.5 m deep
const boxMat = new StandardMaterial();
boxMat.diffuse = new Color(1, 0.55, 0.1);
boxMat.useMetalness = true;
boxMat.metalness = 0;
boxMat.gloss = 0.2;      // matte, so highlights don't wash the colour out
boxMat.update();

function addBox() {
    boxCount++;
    const holder = new Entity(`Box ${boxCount}`);

    const box = new Entity('BoxShape');
    box.addComponent('render', { type: 'box', material: boxMat });
    box.setLocalScale(1, 0.5, 0.5);
    holder.addChild(box);

    splatRoot.addChild(holder);
    keepRealWorldSize(holder);
    placeInFront(holder);

    meshes.push({ entity: holder, name: `Box ${boxCount}`, asset: null });
    refreshMeshList();
}

function addMeshFromFile(file) {
    const url = URL.createObjectURL(file);

    app.assets.loadFromUrlAndFilename(url, file.name, 'container', (err, asset) => {
        URL.revokeObjectURL(url);

        if (err) {
            console.error('Mesh load failed:', err);
            alert(`Couldn't load ${file.name}: ${err}`);
            return;
        }

        const holder = new Entity(`Mesh: ${file.name}`);
        holder.addChild(asset.resource.instantiateRenderEntity());
        splatRoot.addChild(holder);

        keepRealWorldSize(holder);
        placeInFront(holder);

        meshes.push({ entity: holder, name: file.name, asset });
        refreshMeshList();
    });
}

function removeMesh(entry) {
    const idx = meshes.indexOf(entry);
    if (idx !== -1) meshes.splice(idx, 1);
    if (meshGrab.entry === entry) meshGrab.entry = null;
    entry.entity.destroy();
    if (entry.asset) {
        app.assets.remove(entry.asset);
        entry.asset.unload();
    }
    refreshMeshList();
}

// 1.5 m in front of the camera, facing the same way (yaw only)
function placeInFront(entity) {
    meshTmp.copy(camera.forward);
    meshTmp.y = 0;
    if (meshTmp.lengthSq() < 1e-4) meshTmp.set(0, 0, -1);
    meshTmp.normalize().mulScalar(1.5).add(camera.getPosition());
    entity.setPosition(meshTmp);

    const yaw = getYaw(camera.getRotation()) ?? 0;
    meshTmpQuat.setFromEulerAngles(0, yaw, 0);
    entity.setRotation(meshTmpQuat);
}

// Cancel out splatRoot's scale so meshes stay 1:1 with the real world
function keepRealWorldSize(entity) {
    const s = splatRoot.getLocalScale().x || 1;
    entity.setLocalScale(1 / s, 1 / s, 1 / s);
}

// ---------- ray picking ----------

// Returns { entry, distance } for the closest mesh hit by the ray, or null
function raycastMeshes(origin, dir) {
    ray.set(origin, dir);

    let best = null;
    let bestDist = Infinity;

    for (const entry of meshes) {
        let first = true;
        for (const render of entry.entity.findComponents('render')) {
            for (const mi of render.meshInstances) {
                if (first) { meshBox.copy(mi.aabb); first = false; }
                else meshBox.add(mi.aabb);
            }
        }
        if (first) continue;

        if (meshBox.intersectsRay(ray, hitPoint)) {
            const d = hitPoint.distance(origin);
            if (d < bestDist) {
                bestDist = d;
                best = entry;
            }
        }
    }

    return best ? { entry: best, distance: bestDist } : null;
}

function getControllerEntity(src) {
    return activeControllers.find(e => e._inputSource === src);
}

// ---------- per-frame ----------

function updateMeshes(dt) {

    for (const entry of meshes) keepRealWorldSize(entry.entity);

    const src = rightController;
    const origin = src && src.getOrigin();
    const dir = src && src.getDirection();

    // Y button (left): spawn a test box (on press, not hold)
    const yPressed = isPressed(leftController, 5);
    if (yPressed && !prevYPressed) {
        addBox();
        pulse(leftController, 0.3, 30);
    }
    prevYPressed = yPressed;

    // B button: bring last-added mesh in front of you (on press, not hold)
    const bPressed = isPressed(src, 5);
    if (bPressed && !prevBPressed && meshes.length) {
        placeInFront(meshes[meshes.length - 1].entity);
        pulse(src, 0.3, 30);
    }
    prevBPressed = bPressed;

    if (!origin || !dir) {
        meshGrab.entry = null;
        return;
    }

    const triggerHeld = isPressed(src, 0);

    // ---- not dragging: hover / start drag ----
    if (!meshGrab.entry) {
        const hit = raycastMeshes(origin, dir);

        const ctrl = getControllerEntity(src);
        if (hit && ctrl && ctrl._rayMat) {
            ctrl._rayMat.emissive.set(0, 1, 1);   // cyan = pointing at a mesh
            ctrl._rayMat.update();
        }

        if (hit && triggerHeld) {
            meshGrab.entry = hit.entry;
            meshGrab.distance = hit.distance;
            meshTmp.copy(dir).mulScalar(hit.distance).add(origin);
            meshGrab.offset.copy(hit.entry.entity.getPosition()).sub(meshTmp);
            meshGrab.startRot.copy(hit.entry.entity.getRotation());
            meshGrab.yaw = 0;
            pulse(src);
        }
        return;
    }

    // ---- dragging ----
    if (!triggerHeld) {
        meshGrab.entry = null;
        return;
    }

    // right stick: X = rotate, Y = push / pull
    const axes = src.gamepad && src.gamepad.axes;
    if (axes && axes.length >= 2) {
        let sx = axes[axes.length - 2];
        let sy = axes[axes.length - 1];
        if (Math.abs(sx) < 0.1) sx = 0;
        if (Math.abs(sy) < 0.1) sy = 0;

        meshGrab.yaw -= sx * MESH_ROTATE_SPEED * dt;
        meshGrab.distance = Math.max(
            MESH_MIN_DISTANCE,
            meshGrab.distance - sy * MESH_PUSH_SPEED * dt   // stick up (negative) = push away
        );
    }

    const entity = meshGrab.entry.entity;

    meshTmp.copy(dir).mulScalar(meshGrab.distance).add(origin).add(meshGrab.offset);
    entity.setPosition(meshTmp);

    meshTmpQuat.setFromEulerAngles(0, meshGrab.yaw, 0).mul(meshGrab.startRot);
    entity.setRotation(meshTmpQuat);

    const ctrl = getControllerEntity(src);
    if (ctrl && ctrl._rayMat) {
        ctrl._rayMat.emissive.set(0, 1, 0);   // green = dragging
        ctrl._rayMat.update();
    }
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


        // While dragging a mesh, the right stick rotates / pushes the mesh instead
        if (rx !== 0 && !meshGrab.entry && !grabState.active) {

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

    updateSplatManipulation(dt);

    // ----------------------------------------------------
    // MESHES
    // ----------------------------------------------------

    updateMeshes(dt);

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

app.xr.on("start", () => {

    setSplatBudget(SPLAT_BUDGET_XR);

    // Lower resolution at the edges of the view (Quest supports this)
    if ('fixedFoveation' in app.xr) {
        try { app.xr.fixedFoveation = 1; } catch (e) { /* not supported */ }
    }

});

app.xr.on("end", () => {

    camera.camera.clearColor = AR_BACKGROUND;

    camera.script.cameraControls.enabled = true;  

    setSplatBudget(SPLAT_BUDGET_DESKTOP);

});

