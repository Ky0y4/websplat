import {
    Application,
    Asset,
    AssetListLoader,
    Entity,
    FILLMODE_FILL_WINDOW,
    RESOLUTION_AUTO,
    XRTYPE_AR,
    XRSPACE_LOCALFLOOR
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

camera.setPosition(0.3, 0.7, 2.5);

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

// ----------------------------------------------------
// UPDATE
// ----------------------------------------------------

app.on("update", (dt) => {

    if (!leftController)
        return;

    if (!leftController.gamepad)
        return;

    const axes = leftController.gamepad.axes;

    if (!axes)
        return;

    // Left stick
    const x = axes[0];
    const y = axes[1];

    // Deadzone
    if (Math.abs(x) < 0.1 && Math.abs(y) < 0.1)
        return;

    // Move the entire room
    splatRoot.translateLocal(
        x * moveSpeed * dt,
        0,
        y * moveSpeed * dt
    );

});

// ----------------------------------------------------

app.xr.on("end", () => {

    camera.script.enabled = true;

});
