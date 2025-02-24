//import tube from './UI/tube.js';
import {tube, DrawTube } from './UI/tube.js';
import {platforms, DrawPlatforms} from './UI/floor.js';
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Player
const player = {
    x: 50,
    y: 200,
    width: 30,
    height: 30,
    speed: 0.5,
    jumpForce: 12,
    velocityX: 0,
    velocityY: 0,
    isJumping: false,
    friction: 0.9,
    maxSpeed: 4,
    canJump: false,
    jumpAnimation: {
        progress: 0,
        duration: 15,
        squashFactor: 0.8,
        stretchFactor: 1.2
    }
};


// Key states
const keys = {
    a: false,
    s: false,
    d: false,
    ' ': false
};

// Jump key state
let jumpKeyPressed = false;

// Scene object
const scene = {
    current: 'main',
    scenes: {
        main: {
            tubeX: 750
        },
        second: {
            tubeX: 0
        }
    },
    text : {
        main: 'Main Scene',
        second: 'Second Scene'
    }
};


// Game loop
function gameLoop() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply player movement
    if (keys.a) {
        player.velocityX -= player.speed;
    }
    if (keys.d) {
        player.velocityX += player.speed;
    }

    // Apply friction
    player.velocityX *= player.friction;
    
    // Limit speed
    player.velocityX = Math.max(Math.min(player.velocityX, player.maxSpeed), -player.maxSpeed);

    // Update player position
    player.x += player.velocityX;
    player.y += player.velocityY;

    // Apply gravity
    player.velocityY += 0.5;

    // indicate the scene
    if(scene.current === 'main') {
        ctx.font = "bold 24px Arial";
        ctx.textAlign = "center";
        ctx.fillText(scene.text.main, canvas.width/2, 50);
    } else {
        ctx.font = "bold 24px Arial";
        ctx.textAlign = "center";
        ctx.fillText(scene.text.second, canvas.width/2, 50);
    }

    // Handle jumping
    if (keys[' '] && player.canJump && !jumpKeyPressed) {
        player.velocityY = -player.jumpForce;
        player.isJumping = true;
        player.canJump = false;
        jumpKeyPressed = true;
        player.jumpAnimation.progress = player.jumpAnimation.duration;
    }

    // Check collision with platforms
    player.canJump = false;
    for (let platform of platforms) {
        if (player.x < platform.x + platform.width &&
            player.x + player.width > platform.x &&
            player.y + player.height > platform.y &&
            player.y < platform.y + platform.height) {
            
            if (player.y + player.height < platform.y + player.velocityY) {
                if (!(keys.s && platform.canDropThrough)) {
                    player.y = platform.y - player.height;
                    player.velocityY = 0;
                    player.isJumping = false;
                    player.canJump = true;
                }
            }
        }
    }

    // Check collision with tube
    if (player.x < tube.x + tube.width &&
        player.x + player.width > tube.x &&
        player.y + player.height > tube.y &&
        player.y < tube.y + tube.height) {
        switchScene();
    }

    // Prevent player from going off-screen
    player.x = Math.max(0, Math.min(player.x, canvas.width - player.width));
    if (player.y > canvas.height) {
        player.y = 0; // Wrap to top if falls off bottom
    }

    // Draw platforms
    DrawPlatforms(ctx);

    // Draw tube
    DrawTube(ctx);

    // Draw player with jump animation
    ctx.fillStyle = 'blue';
    let drawHeight = player.height;
    let drawY = player.y;

    if (player.jumpAnimation.progress > 0) {
        const animationProgress = player.jumpAnimation.progress / player.jumpAnimation.duration;
        const squashStretchFactor = player.isJumping
            ? 1 + (player.jumpAnimation.stretchFactor - 1) * (1 - animationProgress)
            : 1 - (1 - player.jumpAnimation.squashFactor) * (1 - animationProgress);
        
        drawHeight = player.height * squashStretchFactor;
        drawY = player.y + player.height - drawHeight;
        
        player.jumpAnimation.progress--;
    }

    ctx.fillRect(player.x, drawY, player.width, drawHeight);

    // Request next frame
    requestAnimationFrame(gameLoop);
}

// Key events
document.addEventListener('keydown', (e) => {
    if (e.key in keys) {
        keys[e.key] = true;
    }
    e.preventDefault(); // Prevent default browser actions for these keys
});

document.addEventListener('keyup', (e) => {
    if (e.key in keys) {
        keys[e.key] = false;
        if (e.key === ' ') {
            jumpKeyPressed = false; // Reset jump key state when spacebar is released
        }
    }
});

// Function to switch scene
function switchScene() {
    if (scene.current === 'main') {
        scene.current = 'second';
    } else {
        scene.current = 'main';
    }

    // Update tube position based on the current scene
    tube.x = scene.scenes[scene.current].tubeX;

    // Reset player position
    player.x = 50;
    player.y = 200;
    player.velocityX = 0;
    player.velocityY = 0;
}

// Start the game
gameLoop();