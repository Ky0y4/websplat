import {
    Application,
    Asset,
    AssetListLoader,
    Entity,
    FILLMODE_FILL_WINDOW,
    RESOLUTION_AUTO,
    XRTYPE_AR,
    XRSPACE_LOCALFLOOR,
    Vec3
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
const right = new Vec3();
const move = new Vec3();
const target = new Vec3();

// ----------------------------------------------------
// UPDATE
// ----------------------------------------------------

app.on("update", (dt) => {

    if (!leftController || !leftController.gamepad) {
        // decay velocity to zero if no controller
        velocity.lerp(velocity, Vec3.ZERO, smoothing * dt);
        return;
    }

    const axes = leftController.gamepad.axes;
    const buttons = leftController.gamepad.buttons;

    let x = 0;
    let y = 0;

    if (axes) {
        x = axes[0];
        y = axes[1];
        if (Math.abs(x) < 0.1) x = 0;
        if (Math.abs(y) < 0.1) y = 0;
    }

    // Camera-relative directions, flattened to horizontal plane
    forward.copy(camera.forward);
    forward.y = 0;
    forward.normalize();

    right.copy(camera.right);
    right.y = 0;
    right.normalize();

    move.set(0, 0, 0);
    move.add(right.clone().mulScalar(x));
    move.add(forward.clone().mulScalar(-y)); // stick up (negative y) = forward

    // Trigger = up, Grip = down (indices per xr-standard mapping)
    const trigger = buttons && buttons[0] ? buttons[0].pressed : false;
    const grip = buttons && buttons[1] ? buttons[1].pressed : false;

    if (trigger) move.y += 1;
    if (grip) move.y -= 1;

    if (move.length() > 1.0) {
        move.normalize();
    }

    target.copy(move).mulScalar(moveSpeed);
    velocity.lerp(velocity, target, smoothing * dt);

    // Move the WORLD opposite to simulated camera movement
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
