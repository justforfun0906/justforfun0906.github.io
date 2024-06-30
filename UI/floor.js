// Platforms
const platforms = [
    { x: 0, y: 350, width: 800, height: 50, canDropThrough: false },
    { x: 300, y: 250, width: 200, height: 20, canDropThrough: true }
];
//Simple texture function
function createSimpleTexture(color1, color2, size) {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = size * 2;
    textureCanvas.height = size * 2;
    const textureCtx = textureCanvas.getContext('2d');

    textureCtx.fillStyle = color1;
    textureCtx.fillRect(0, 0, size * 2, size * 2);
    textureCtx.fillStyle = color2;
    textureCtx.fillRect(0, 0, size, size);
    textureCtx.fillRect(size, size, size, size);

    return ctx.createPattern(textureCanvas, 'repeat');
}
const floorTexture = createSimpleTexture('#8B4513', '#6B3E0C', 10);
const platformTexture = createSimpleTexture('#7C1213', '#62CE3C', 10);

function DrawPlatforms(ctx) {
    for (let platform of platforms) {
        if (platform.canDropThrough) {
            ctx.fillStyle = platformTexture;
        } else {
            ctx.fillStyle = floorTexture;
        }
        ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    }
}

export { platforms, DrawPlatforms };