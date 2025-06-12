// calm-sort/main.js
// © 2023 Lead Game-Dev AI

"use strict";

// -----------------------------------------------------------------------------
// SECTION: Module-level Constants & State
// -----------------------------------------------------------------------------

const { Engine, Render, Runner, World, Bodies, Body, Events, Mouse, MouseConstraint, Composite } = Matter;

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Game state
let engine, world;
let draggedSphere = null;
let lastMoveTime = 0;
const moveCooldown = 250; // ms between moves
let victory = false;
let victoryTime = 0;
const confetti = [];
const moveHistory = [];
const MAX_UNDO = 5;

// Visuals & Palette
const PALETTE = {
    SKY_BLUE: '#BCDFFB',
    BLUSH_PINK: '#F8D4D8',
    SAND_BEIGE: '#F4E9D0',
    ACCENT_INDIGO: '#5E6CC5',
    SHADOW: 'rgba(0, 0, 0, 0.1)',
    LIGHT: 'rgba(255, 255, 255, 0.5)',
    HIGHLIGHT: 'rgba(255, 255, 255, 0.2)',
};

const SPHERE_COLORS = [
    '#ff6b6b', '#f9c74f', '#90be6d', '#43aa8b', '#577590',
    '#f8961e', '#277da1', '#f3722c', '#aacc00', '#6d23b6',
    '#0081a7', '#ea698b'
];

// Physics & Layout
const SPHERE_RADIUS = 22;
const TUBE_CAPACITY = 4;
const TUBE_WIDTH = SPHERE_RADIUS * 2.5;
const TUBE_WALL_THICKNESS = 10;
const FLOOR_HEIGHT = 30;

// Audio
let audioCtx;
let ambientPad, rollGain;
const clackSounds = [];


// -----------------------------------------------------------------------------
// SECTION: Initialization
// -----------------------------------------------------------------------------

/**
 * Main entry point. Sets up the canvas, engine, audio, and starts the game.
 */
function init() {
    setupCanvas();
    setupPhysics();
    setupAudio();
    createLevel();
    setupInputListeners();

    // Start the game loop
    Engine.run(engine);
    requestAnimationFrame(renderLoop);

    // Fade in ambient sound
    if (ambientPad) {
        const now = audioCtx.currentTime;
        ambientPad.gain.setValueAtTime(0, now);
        ambientPad.gain.linearRampToValueAtTime(0.1, now + 5);
    }
}

/**
 * Sets canvas dimensions and handles resizing.
 */
function setupCanvas() {
    function resize() {
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;
        // When resizing, we need to rebuild the level with new dimensions
        createLevel(); 
    }
    window.addEventListener('resize', resize);
    resize();
}

/**
 * Initializes the Matter.js physics engine and world.
 */
function setupPhysics() {
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 1.6;
    engine.timing.timeScale = 1.2;
}


// -----------------------------------------------------------------------------
// SECTION: Audio Generation
// -----------------------------------------------------------------------------

/**
 * Initializes the Web Audio API context and creates procedural sounds.
 */
function setupAudio() {
    // Audio context must be started by user gesture. We'll try here, and again on first click.
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        createAmbientPad();
        createRollSound();
        // Pre-generate a few clack sounds for variety
        for (let i = 0; i < 5; i++) {
            clackSounds.push(createClackSound());
        }
    } catch (e) {
        console.warn("Web Audio API not supported or context creation failed.");
    }
}

/**
 * Ensures the audio context is running (required by modern browsers).
 */
function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

/**
 * Creates a low, ambient sine wave pad.
 */
function createAmbientPad() {
    const oscillator = audioCtx.createOscillator();
    ambientPad = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(100, audioCtx.currentTime); // Low C
    oscillator.connect(ambientPad);
    ambientPad.connect(audioCtx.destination);
    oscillator.start();
}

/**
 * Creates the audio graph for a looping, filtered noise (rolling sound).
 */
function createRollSound() {
    const bufferSize = audioCtx.sampleRate * 2; // 2 seconds of noise
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);

    // Generate pink noise
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11; // (roughly) compensate for gain
        b6 = white * 0.115926;
    }
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    
    rollGain = audioCtx.createGain();
    rollGain.gain.setValueAtTime(0, audioCtx.currentTime);
    
    source.connect(rollGain).connect(audioCtx.destination);
    source.start();
}


/**
 * Returns a function that plays a randomized "clack" sound.
 */
function createClackSound() {
    return () => {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const pitch = 880 + (Math.random() - 0.5) * 200; // A5 with variance
        osc.frequency.setValueAtTime(pitch, now);
        
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.start(now);
        osc.stop(now + 0.15);
    };
}


// -----------------------------------------------------------------------------
// SECTION: Level Generation
// -----------------------------------------------------------------------------

/**
 * Clears the world and creates a new, solvable puzzle.
 */
function createLevel() {
    victory = false;
    World.clear(world, false);
    moveHistory.length = 0;

    const numColors = 4 + Math.floor(Math.random() * 3); // 4-6 colors
    const numTubes = numColors + 2;

    const levelColors = [...SPHERE_COLORS].sort(() => 0.5 - Math.random()).slice(0, numColors);
    
    // Create sphere pool
    const spherePool = [];
    for (const color of levelColors) {
        for (let i = 0; i < TUBE_CAPACITY; i++) {
            spherePool.push(color);
        }
    }
    // Shuffle the pool to create the puzzle
    for (let i = spherePool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [spherePool[i], spherePool[j]] = [spherePool[j], spherePool[i]];
    }

    // Create tubes and floor
    const totalTubesWidth = numTubes * TUBE_WIDTH + (numTubes - 1) * (TUBE_WIDTH / 2);
    let startX = (canvas.width / 2) - (totalTubesWidth / 2);
    const tubeHeight = TUBE_CAPACITY * SPHERE_RADIUS * 2 + SPHERE_RADIUS * 2;
    const tubeY = canvas.height - FLOOR_HEIGHT - tubeHeight / 2 - 20;

    const tubeGeometries = [];

    for (let i = 0; i < numTubes; i++) {
        const tubeX = startX + i * (TUBE_WIDTH + TUBE_WIDTH / 2);
        const tube = {
            x: tubeX,
            y: tubeY,
            height: tubeHeight,
            spheres: [],
            isTube: true
        };
        tubeGeometries.push(tube);
        
        const wallY = tube.y + SPHERE_RADIUS * 2; // Position walls lower for open top
        const wallHeight = tubeHeight - SPHERE_RADIUS * 2;

        // Left wall
        World.add(world, Bodies.rectangle(
            tube.x - TUBE_WIDTH / 2, wallY, TUBE_WALL_THICKNESS, wallHeight, 
            { isStatic: true, render: { visible: false }, label: 'tubeWall' }
        ));
        // Right wall
        World.add(world, Bodies.rectangle(
            tube.x + TUBE_WIDTH / 2, wallY, TUBE_WALL_THICKNESS, wallHeight, 
            { isStatic: true, render: { visible: false }, label: 'tubeWall' }
        ));
         // Bottom wall
        World.add(world, Bodies.rectangle(
            tube.x, tube.y + tubeHeight / 2 - TUBE_WALL_THICKNESS / 2, TUBE_WIDTH, TUBE_WALL_THICKNESS, 
            { isStatic: true, render: { visible: false }, label: 'tubeWall' }
        ));
    }
    
    // Add floor
    World.add(world, Bodies.rectangle(
        canvas.width / 2, canvas.height - FLOOR_HEIGHT / 2, canvas.width, FLOOR_HEIGHT, 
        { isStatic: true, render: { visible: false }, label: 'floor' }
    ));
    
    // Add tubes to world for rendering purposes (not physics)
    world.tubes = tubeGeometries;

    // Populate tubes with spheres
    for (let i = 0; i < spherePool.length; i++) {
        const tubeIndex = Math.floor(i / TUBE_CAPACITY);
        const sphereIndexInTube = i % TUBE_CAPACITY;
        
        const tube = world.tubes[tubeIndex];
        const color = spherePool[i];

        const sphere = Bodies.circle(
            tube.x,
            tube.y + tube.height / 2 - TUBE_WALL_THICKNESS - SPHERE_RADIUS - sphereIndexInTube * SPHERE_RADIUS * 2.1,
            SPHERE_RADIUS,
            {
                restitution: 0.15,
                friction: 0.02,
                mass: 1,
                render: { visible: false }, // Custom rendering
                label: 'sphere',
                customData: { color: color, homeTube: tube, isTop: false }
            }
        );
        tube.spheres.push(sphere);
        World.add(world, sphere);
    }
    updateTopSpheres();
}


// -----------------------------------------------------------------------------
// SECTION: Input Handling
// -----------------------------------------------------------------------------

/**
 * Sets up all user input event listeners.
 */
function setupInputListeners() {
    let pointerStartPos = { x: 0, y: 0 };
    
    canvas.addEventListener('pointerdown', (e) => {
        resumeAudio(); // Ensure audio is playing on first interaction
        if (victory) {
            createLevel();
            return;
        }

        if (draggedSphere) return;

        const now = Date.now();
        if (now - lastMoveTime < moveCooldown) return;
        
        const mousePos = { x: e.clientX * window.devicePixelRatio, y: e.clientY * window.devicePixelRatio };
        const bodies = Composite.allBodies(world);
        
        for (const body of bodies) {
            if (body.label === 'sphere' && body.customData.isTop) {
                 if (Matter.Vector.magnitude(Matter.Vector.sub(body.position, mousePos)) < SPHERE_RADIUS * 2) {
                    draggedSphere = body;
                    pointerStartPos = mousePos;
                    recordMove(draggedSphere);
                    break;
                }
            }
        }
        
        if (draggedSphere) {
            Body.setStatic(draggedSphere, true);
            if (rollGain) rollGain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.1);
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!draggedSphere) return;

        const mousePos = { x: e.clientX * window.devicePixelRatio, y: e.clientY * window.devicePixelRatio };
        Body.setPosition(draggedSphere, mousePos);
        
        // Modulate roll sound by velocity
        const velocity = Matter.Vector.magnitude(Matter.Vector.sub(mousePos, pointerStartPos));
        if (rollGain) {
            const targetGain = Math.min(0.5, 0.1 + velocity / 1000);
            rollGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.05);
        }
        pointerStartPos = mousePos;
    });

    canvas.addEventListener('pointerup', () => {
        if (!draggedSphere) return;

        Body.setStatic(draggedSphere, false);
        
        let droppedInTube = false;
        for (const tube of world.tubes) {
            if (tube.spheres.length < TUBE_CAPACITY &&
                Math.abs(draggedSphere.position.x - tube.x) < TUBE_WIDTH / 2) {
                
                const topSphereInTarget = getTopSphere(tube);
                if (!topSphereInTarget || topSphereInTarget.customData.color === draggedSphere.customData.color) {
                    Body.setPosition(draggedSphere, { x: tube.x, y: draggedSphere.position.y });
                    Body.setVelocity(draggedSphere, { x: 0, y: 0 });
                    
                    if (draggedSphere.customData.homeTube) {
                        const oldTube = world.tubes.find(t => t.spheres.includes(draggedSphere));
                        if(oldTube) oldTube.spheres = oldTube.spheres.filter(s => s !== draggedSphere);
                    }
                    
                    tube.spheres.push(draggedSphere);
                    draggedSphere.customData.homeTube = tube;
                    droppedInTube = true;
                    break;
                }
            }
        }
        
        if (!droppedInTube) {
            const oldTube = world.tubes.find(t => t.spheres.includes(draggedSphere));
            if (oldTube) oldTube.spheres = oldTube.spheres.filter(s => s !== draggedSphere);
            draggedSphere.customData.homeTube = null; // It's on the floor now
        }
        
        draggedSphere = null;
        lastMoveTime = Date.now();
        if (rollGain) rollGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
        
        setTimeout(() => {
            updateTopSpheres();
            checkVictory();
        }, 100);
    });

    // Undo listener
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoMove();
        }
    });

    // Physics collision events for audio
    Events.on(engine, 'collisionStart', (event) => {
        for (const pair of event.pairs) {
            const { bodyA, bodyB } = pair;
            if ((bodyA.label === 'sphere' && bodyB.label === 'sphere') ||
                (bodyA.label === 'sphere' && (bodyB.label === 'tubeWall' || bodyB.label === 'floor'))) {
                
                // Play a random clack sound
                const clack = clackSounds[Math.floor(Math.random() * clackSounds.length)];
                if (clack) clack();

                // Haptic feedback
                if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
                break; // Only one sound per collision event
            }
        }
    });
}


// -----------------------------------------------------------------------------
// SECTION: Game Logic & State Management
// -----------------------------------------------------------------------------

/**
 * Finds the topmost sphere in each tube and on the floor and flags it.
 */
function updateTopSpheres() {
    const allSpheres = Composite.allBodies(world).filter(b => b.label === 'sphere');
    allSpheres.forEach(s => s.customData.isTop = false);

    // Update top spheres in tubes
    for (const tube of world.tubes) {
        const topSphere = getTopSphere(tube);
        if (topSphere) {
            topSphere.customData.isTop = true;
        }
    }

    // All spheres on the floor are draggable
    const floorSpheres = allSpheres.filter(s => !s.customData.homeTube);
    floorSpheres.forEach(s => {
        // A sphere is on the floor if it's below the tubes and not moving much
        if (s.position.y > canvas.height - FLOOR_HEIGHT - SPHERE_RADIUS * 1.5 && s.speed < 0.1) {
            s.customData.isTop = true;
        }
    });
}

/**
 * Gets the sphere with the minimum y-position in a given tube.
 * @param {object} tube - The tube object.
 * @returns {Matter.Body|null} The topmost sphere body or null.
 */
function getTopSphere(tube) {
    if (tube.spheres.length === 0) return null;
    return tube.spheres.reduce((top, s) => s.position.y < top.position.y ? s : top, tube.spheres[0]);
}

/**
 * Checks if the puzzle has been solved.
 */
function checkVictory() {
    if (victory) return;

    for (const tube of world.tubes) {
        if (tube.spheres.length > 0 && tube.spheres.length < TUBE_CAPACITY) {
            return; // A tube is partially filled, not solved.
        }
        if (tube.spheres.length === TUBE_CAPACITY) {
            const firstColor = tube.spheres[0].customData.color;
            for (let i = 1; i < tube.spheres.length; i++) {
                if (tube.spheres[i].customData.color !== firstColor) {
                    return; // Colors are not homogenous.
                }
            }
        }
    }
    // If we get here, all tubes are either empty or full of one color.
    victory = true;
    victoryTime = Date.now();
    createConfetti();
}

/**
 * Stores the state of a sphere before it's moved.
 * @param {Matter.Body} sphere - The sphere being moved.
 */
function recordMove(sphere) {
    const oldTube = world.tubes.find(t => t.spheres.includes(sphere));
    moveHistory.push({
        sphere: sphere,
        fromTube: oldTube,
        position: { ...sphere.position },
    });
    if (moveHistory.length > MAX_UNDO) {
        moveHistory.shift();
    }
}

/**
 * Reverts the last move made by the player.
 */
function undoMove() {
    if (moveHistory.length === 0 || draggedSphere) return;

    const lastMove = moveHistory.pop();
    const { sphere, fromTube, position } = lastMove;
    
    // Remove sphere from its current tube, if any
    const currentTube = world.tubes.find(t => t.spheres.includes(sphere));
    if (currentTube) {
        currentTube.spheres = currentTube.spheres.filter(s => s !== sphere);
    }

    // Add it back to its original tube
    if (fromTube) {
        fromTube.spheres.push(sphere);
        sphere.customData.homeTube = fromTube;
    } else {
        sphere.customData.homeTube = null;
    }
    
    // Reset physics state
    Body.setStatic(sphere, false);
    Body.setPosition(sphere, position);
    Body.setVelocity(sphere, { x: 0, y: 0 });
    
    updateTopSpheres();
}


// -----------------------------------------------------------------------------
// SECTION: Rendering
// -----------------------------------------------------------------------------

/**
 * The main render loop, called by requestAnimationFrame.
 */
function renderLoop(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background texture (faint Perlin-noise speckle)
    drawBackgroundNoise();

    // Set isometric-style transform
    const isoYScale = 0.6;
    const centerX = canvas.width / 2;
    const centerY = canvas.height * 0.4;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    
    // Render tubes
    if (world.tubes) {
        world.tubes.forEach(tube => {
            const screenX = tube.x - centerX;
            const screenY = (tube.y - centerY) * isoYScale;
            drawTube(screenX, screenY, TUBE_WIDTH, tube.height, isoYScale);
        });
    }

    // Render drop highlights
    if (draggedSphere) {
        world.tubes.forEach(tube => {
            if (tube.spheres.length < TUBE_CAPACITY) {
                const topSphereInTarget = getTopSphere(tube);
                if (!topSphereInTarget || topSphereInTarget.customData.color === draggedSphere.customData.color) {
                    const screenX = tube.x - centerX;
                    const screenY = (tube.y - centerY) * isoYScale;
                    drawTubeHighlight(screenX, screenY, TUBE_WIDTH, tube.height, isoYScale);
                }
            }
        });
    }

    // Render spheres
    const allBodies = Composite.allBodies(world);
    allBodies.filter(b => b.label === 'sphere').forEach(sphere => {
        const screenX = sphere.position.x - centerX;
        const screenY = (sphere.position.y - centerY) * isoYScale;
        drawSphere(screenX, screenY, SPHERE_RADIUS, isoYScale, sphere.customData.color, sphere.angle);
    });
    
    ctx.restore();

    // Render victory state
    if (victory) {
        renderVictory(time);
    }
    
    requestAnimationFrame(renderLoop);
}

/**
 * Draws a single sphere with an isometric look.
 * @param {number} x - Center x-coordinate.
 * @param {number} y - Center y-coordinate.
 * @param {number} r - Radius.
 * @param {number} yScale - Vertical scale for isometry.
 * @param {string} color - Fill color.
 */
function drawSphere(x, y, r, yScale, color) {
    const ry = r * yScale;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(x, y + ry + 5, r * 0.9, ry * 0.4, 0, 0, 2 * Math.PI);
    ctx.fillStyle = PALETTE.SHADOW;
    ctx.fill();

    // Main sphere body with gradient
    const gradient = ctx.createRadialGradient(x - r * 0.2, y - ry * 0.3, r * 0.1, x, y, r);
    gradient.addColorStop(0, PALETTE.LIGHT);
    gradient.addColorStop(0.8, color);
    gradient.addColorStop(1, color);

    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();
}

/**
 * Draws a single tube with a 2.5D look.
 * @param {number} x - Center x-coordinate.
 * @param {number} y - Center y-coordinate.
 * @param {number} w - Width.
 * @param {number} h - Height.
 * @param {number} yScale - Vertical scale for isometry.
 */
function drawTube(x, y, w, h, yScale) {
    const rh = h * yScale;
    const rw = w / 2;
    const frontColor = PALETTE.SAND_BEIGE;
    const sideColor = '#e0d6be'; // Darker sand
    const topColor = '#fcf3e0';  // Lighter sand

    // Back ellipse (top rim)
    ctx.fillStyle = sideColor;
    ctx.beginPath();
    ctx.ellipse(x, y - rh / 2, rw, rw * yScale, 0, 0, 2 * Math.PI);
    ctx.fill();
    
    // Main body
    ctx.fillStyle = frontColor;
    ctx.fillRect(x - rw, y - rh / 2, w, rh);
    
    // Front ellipse (bottom)
    ctx.fillStyle = frontColor;
    ctx.beginPath();
    ctx.ellipse(x, y + rh / 2, rw, rw * yScale, 0, 0, Math.PI);
    ctx.fill();

    // Top rim (inner hole)
    ctx.fillStyle = PALETTE.SKY_BLUE;
    ctx.beginPath();
    ctx.ellipse(x, y - rh / 2, rw - TUBE_WALL_THICKNESS/2, (rw - TUBE_WALL_THICKNESS/2) * yScale, 0, 0, 2 * Math.PI);
    ctx.fill();
}

/**
 * Draws a highlight glow on a tube.
 */
function drawTubeHighlight(x, y, w, h, yScale) {
    const rh = h * yScale;
    const rw = w / 2;
    ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.2;
    ctx.fillStyle = PALETTE.HIGHLIGHT;
    ctx.beginPath();
    ctx.ellipse(x, y - rh / 2, rw, rw * yScale, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillRect(x - rw, y - rh / 2, w, rh);
    ctx.beginPath();
    ctx.ellipse(x, y + rh / 2, rw, rw * yScale, 0, 0, Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1.0;
}


/**
 * Renders a faint noise pattern on the background for texture.
 */
function drawBackgroundNoise() {
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const color = Math.random() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.1)';
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
}

// -----------------------------------------------------------------------------
// SECTION: Victory Animation
// -----------------------------------------------------------------------------

/**
 * Creates the initial state for the confetti particles.
 */
function createConfetti() {
    confetti.length = 0;
    const confettiColors = [...SPHERE_COLORS];
    for (let i = 0; i < 150; i++) {
        confetti.push({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * canvas.height,
            w: 5 + Math.random() * 10,
            h: 5 + Math.random() * 10,
            color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            speed: 2 + Math.random() * 3,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.2
        });
    }
}

/**
 * Renders the victory message and confetti animation.
 */
function renderVictory(time) {
    // Update and draw confetti
    confetti.forEach(p => {
        p.y += p.speed * (canvas.height / 800);
        p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        // Reset particle when it goes off-screen
        if (p.y > canvas.height + 20) {
            p.y = -20;
            p.x = Math.random() * canvas.width;
        }
    });

    // Draw "Solved!" text
    const elapsed = time - victoryTime;
    const fadeDuration = 500;
    const alpha = Math.min(1, elapsed / fadeDuration);
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ACCENT_INDIGO;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
    ctx.shadowBlur = 10;
    
    const fontSize = Math.min(canvas.width / 10, 80);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText('✓', canvas.width / 2, canvas.height * 0.4);

    const subFontSize = Math.min(canvas.width / 25, 24);
    ctx.font = `${subFontSize}px sans-serif`;
    ctx.fillText('Puzzle Solved', canvas.width / 2, canvas.height * 0.4 + fontSize*0.8);
    
    ctx.restore();
}


// -----------------------------------------------------------------------------
// SECTION: Entry Point
// -----------------------------------------------------------------------------

init();
