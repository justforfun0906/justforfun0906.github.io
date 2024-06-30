// Tube
const tube = {
    x: 750,
    y: 300,
    width: 50,
    height: 50
};
function DrawTube(ctx) {
    ctx.fillStyle = 'red';
    ctx.fillRect(tube.x, tube.y, tube.width, tube.height);
}
export { tube , DrawTube};