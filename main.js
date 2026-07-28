import { Application, Asset, AssetListLoader, Entity, FILLMODE_FILL_WINDOW, RESOLUTION_AUTO } from 'playcanvas';

// Create application
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const app = new Application(canvas, {
    graphicsDeviceOptions: {
        antialias: false
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
        url: './vrlabdensed100k.sog'
    })
];

const loader = new AssetListLoader(assets, app.assets);
await new Promise(resolve => loader.load(resolve));

// Create camera entity
const camera = new Entity('Camera');
camera.setPosition(0, 0, 2.5);
camera.addComponent('camera');
camera.addComponent('script');
camera.script.create('cameraControls');
app.root.addChild(camera);

// Create splat entity
const splat = new Entity('Vr Lab');
splat.setPosition(0, -0.7, 0);
splat.setEulerAngles(0, 0, 180);
splat.addComponent('gsplat', { asset: assets[1] });
app.root.addChild(splat);
