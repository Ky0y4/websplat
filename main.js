import { Application, Asset, AssetListLoader, Entity, FILLMODE_FILL_WINDOW, RESOLUTION_AUTO, XRTYPE_AR, XRSPACE_LOCALFLOOR, XRSPACE_VIEWER } from 'playcanvas';

// Create application
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

// Load assets
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

// Create camera entity
const camera = new Entity('Camera');
camera.setPosition(0, 0, 2.5);
camera.addComponent('camera', { clearColor: [0, 0, 0, 0] });
camera.addComponent('script');
camera.script.create('cameraControls');
app.root.addChild(camera);

// Create splat entity — starts disabled until placed
const splat = new Entity('Vr Lab');
splat.setEulerAngles(0, 0, 180);
splat.enabled = false;
app.root.addChild(splat);
splat.addComponent('gsplat', { asset: assets[1] });

// --- AR button setup ---
const button = document.createElement('button');
button.textContent = 'Enter AR';
button.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;padding:12px 24px;font-size:16px;';
document.body.appendChild(button);

// --- Placement state ---
let hitTestSource = null;
let lastHitPosition = null;
let lastHitRotation = null;
let hasPlaced = false;

button.addEventListener('click', () => {
    if (app.xr.supported && app.xr.isAvailable(XRTYPE_AR)) {
        camera.script.enabled = false;
        camera.camera.startXr(XRTYPE_AR, XRSPACE_LOCALFLOOR, {
            callback: (err) => {
                if (err) console.error('Failed to start AR:', err);
            }
        });
    } else {
        alert('AR is not supported on this device/browser.');
    }
});

app.xr.on('start', () => {
    hasPlaced = false;
    splat.enabled = false;

    // Probe forward from wherever the user is looking (headset or phone)
    app.xr.hitTest.start({
        spaceType: XRSPACE_VIEWER,
        callback: (err, source) => {
            if (err) {
                console.error('Hit test failed to start:', err);
                return;
            }
            hitTestSource = source;
            hitTestSource.on('result', (position, rotation) => {
                lastHitPosition = position.clone();
                lastHitRotation = rotation.clone();
            });
        }
    });

    // Tap/trigger to place the splat at the last known hit location
    app.xr.input.on('selectstart', () => {
        if (!hasPlaced && lastHitPosition) {
            splat.setPosition(lastHitPosition);
            splat.setRotation(lastHitRotation);
            splat.enabled = true;
            hasPlaced = true;

            // stop probing once placed — saves resources
            if (hitTestSource) {
                hitTestSource.remove();
                hitTestSource = null;
            }
        }
    });
});

app.xr.on('end', () => {
    camera.script.enabled = true;
    if (hitTestSource) {
        hitTestSource.remove();
        hitTestSource = null;
    }
    hasPlaced = false;
    splat.enabled = false;
});