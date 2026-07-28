import { Application, Asset, AssetListLoader, Entity, FILLMODE_FILL_WINDOW, RESOLUTION_AUTO, XRTYPE_AR, XRSPACE_LOCALFLOOR } from 'playcanvas';

// Create application
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const app = new Application(canvas, {
    graphicsDeviceOptions: {
        antialias: false,
        alpha: true          // needed so the camera feed can show through in AR
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
camera.addComponent('camera', {
    clearColor: [0, 0, 0, 0]   // transparent so AR passthrough shows
});
camera.addComponent('script');
camera.script.create('cameraControls');
app.root.addChild(camera);

// Create splat entity
const splat = new Entity('Vr Lab');
splat.setPosition(0, -0.7, 0);
splat.setEulerAngles(0, 0, 180);
splat.addComponent('gsplat', { asset: assets[1] });
app.root.addChild(splat);

// --- AR button setup ---
const button = document.createElement('button');
button.textContent = 'Enter AR';
button.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;padding:12px 24px;font-size:16px;';
document.body.appendChild(button);

button.addEventListener('click', () => {
    if (app.xr.supported && app.xr.isAvailable(XRTYPE_AR)) {
        camera.script.enabled = false; // disable orbit/touch controls while in AR
        camera.camera.startXr(XRTYPE_AR, XRSPACE_LOCALFLOOR, {
            callback: (err) => {
                if (err) {
                    console.error('Failed to start AR:', err);
                }
            }
        });
    } else {
        alert('AR is not supported on this device/browser.');
    }
});

app.xr.on('end', () => {
    camera.script.enabled = true; // re-enable orbit controls when AR session ends
});