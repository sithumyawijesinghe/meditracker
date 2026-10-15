/* three-viewer.js - Interactive Medi Tracker 3D model renderer */

let scene, camera, renderer, controls;
let containerServos = [];
let liquidPumpMesh;
let liquidStreamParticles = [];
let espLed;
let oledCtx, oledTexture;

function init3DViewer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // 1. Scene Setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  // 2. Camera Setup
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 18, 32);

  // 3. Renderer Setup
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 4. Orbit Controls
  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
  }

  // 5. Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(15, 25, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  scene.add(dirLight);

  const bluePoint = new THREE.PointLight(0x3b82f6, 1.5, 30);
  bluePoint.position.set(-10, 8, 10);
  scene.add(bluePoint);

  const emeraldPoint = new THREE.PointLight(0x10b981, 1.5, 30);
  emeraldPoint.position.set(10, 8, 10);
  scene.add(emeraldPoint);

  // 6. Build the 3D IoT Dispenser Model
  buildIoTDispenserModel();

  // 7. Window Resize Listener
  window.addEventListener('resize', onWindowResize);

  // 8. Animation Loop
  animate();
}

function buildIoTDispenserModel() {
  const mainGroup = new THREE.Group();

  // --- Base Station Chassis ---
  const baseGeo = new THREE.BoxGeometry(24, 3, 14);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.3,
    metalness: 0.6
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = 1.5;
  baseMesh.receiveShadow = true;
  baseMesh.castShadow = true;
  mainGroup.add(baseMesh);

  // Base metallic trim
  const trimGeo = new THREE.BoxGeometry(24.2, 0.3, 14.2);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.2, metalness: 0.9 });
  const trimMesh = new THREE.Mesh(trimGeo, trimMat);
  trimMesh.position.y = 3.0;
  mainGroup.add(trimMesh);

  // --- Front OLED Display Screen ---
  const oledCanvas = document.createElement('canvas');
  oledCanvas.width = 256;
  oledCanvas.height = 128;
  oledCtx = oledCanvas.getContext('2d');
  drawOledScreen("DISPENSER READY", "SSID: ESW");

  oledTexture = new THREE.CanvasTexture(oledCanvas);
  const oledMat = new THREE.MeshBasicMaterial({ map: oledTexture });
  const oledGeo = new THREE.PlaneGeometry(5, 2.5);
  const oledMesh = new THREE.Mesh(oledGeo, oledMat);
  oledMesh.position.set(-5, 1.8, 7.02);
  mainGroup.add(oledMesh);

  // Screen bezel
  const bezelGeo = new THREE.BoxGeometry(5.4, 2.9, 0.1);
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.1 });
  const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);
  bezelMesh.position.set(-5, 1.8, 6.96);
  mainGroup.add(bezelMesh);

  // --- ESP32 Microcontroller Module Visual ---
  const espGroup = new THREE.Group();
  espGroup.position.set(7, 1.8, 7.05);

  const espBoardGeo = new THREE.BoxGeometry(3.5, 2.2, 0.2);
  const espBoardMat = new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 0.4 });
  const espBoard = new THREE.Mesh(espBoardGeo, espBoardMat);
  espGroup.add(espBoard);

  // ESP32 Metal shield box
  const chipGeo = new THREE.BoxGeometry(1.2, 1.5, 0.3);
  const chipMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
  const chip = new THREE.Mesh(chipGeo, chipMat);
  chip.position.set(-0.6, 0, 0.1);
  espGroup.add(chip);

  // Wi-Fi LED Indicator (Glowing)
  const ledGeo = new THREE.SphereGeometry(0.15, 16, 16);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
  espLed = new THREE.Mesh(ledGeo, ledMat);
  espLed.position.set(1.2, 0.6, 0.15);
  espGroup.add(espLed);

  mainGroup.add(espGroup);

  // --- 4 Tablet Container Towers & Servo Motors ---
  const containerPositions = [-8, -3, 2, 7];
  const containerColors = [0x10b981, 0x3b82f6, 0xf59e0b, 0x8b5cf6];

  for (let i = 0; i < 4; i++) {
    const cGroup = new THREE.Group();
    const xPos = containerPositions[i];
    cGroup.position.set(xPos, 3.1, -2);

    // Servo Motor Block
    const servoGeo = new THREE.BoxGeometry(2.2, 2.5, 2.2);
    const servoMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.4, metalness: 0.5 });
    const servoMesh = new THREE.Mesh(servoGeo, servoMat);
    servoMesh.position.y = 1.25;
    servoMesh.castShadow = true;
    cGroup.add(servoMesh);
    containerServos.push(servoMesh);

    // Container Glass Cylinder
    const cylGeo = new THREE.CylinderGeometry(1.4, 1.4, 5.5, 32);
    const cylMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.85,
      opacity: 1,
      transparent: true,
      roughness: 0.1,
      ior: 1.5
    });
    const cylMesh = new THREE.Mesh(cylGeo, cylMat);
    cylMesh.position.y = 5.25;
    cylMesh.castShadow = true;
    cGroup.add(cylMesh);

    // Top Lid
    const lidGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.4, 32);
    const lidMat = new THREE.MeshStandardMaterial({ color: containerColors[i], roughness: 0.3, metalness: 0.6 });
    const lidMesh = new THREE.Mesh(lidGeo, lidMat);
    lidMesh.position.y = 8.2;
    cGroup.add(lidMesh);

    // Pills Inside
    const pillGroup = new THREE.Group();
    const pillGeo = new THREE.CapsuleGeometry(0.25, 0.5, 8, 16);
    const pillMat = new THREE.MeshStandardMaterial({ color: containerColors[i], roughness: 0.2 });

    for (let p = 0; p < 8; p++) {
      const pill = new THREE.Mesh(pillGeo, pillMat);
      pill.rotation.z = Math.random() * Math.PI;
      pill.rotation.x = Math.random() * Math.PI;
      pill.position.set(
        (Math.random() - 0.5) * 1.2,
        3.0 + p * 0.5,
        (Math.random() - 0.5) * 1.2
      );
      pillGroup.add(pill);
    }
    cGroup.add(pillGroup);

    // Chute Output Funnel below servo
    const chuteGeo = new THREE.ConeGeometry(1.2, 1.2, 16);
    const chuteMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const chuteMesh = new THREE.Mesh(chuteGeo, chuteMat);
    chuteMesh.rotation.x = Math.PI;
    chuteMesh.position.y = -0.4;
    cGroup.add(chuteMesh);

    mainGroup.add(cGroup);
  }

  // --- Liquid Dispenser Module ---
  const liqGroup = new THREE.Group();
  liqGroup.position.set(10.5, 3.1, -1);

  // Liquid Pump Frame
  const pumpFrameGeo = new THREE.CylinderGeometry(1.8, 1.8, 7, 32);
  const pumpFrameMat = new THREE.MeshPhysicalMaterial({
    color: 0x3b82f6,
    transmission: 0.8,
    transparent: true,
    roughness: 0.1
  });
  const pumpFrame = new THREE.Mesh(pumpFrameGeo, pumpFrameMat);
  pumpFrame.position.y = 4.5;
  liqGroup.add(pumpFrame);

  // Liquid Inside Bottle
  const liqLevelGeo = new THREE.CylinderGeometry(1.7, 1.7, 5, 32);
  const liqLevelMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.1, transparent: true, opacity: 0.85 });
  liquidPumpMesh = new THREE.Mesh(liqLevelGeo, liqLevelMat);
  liquidPumpMesh.position.y = 3.5;
  liqGroup.add(liquidPumpMesh);

  // Dispensing Tube & Nozzle
  const tubeGeo = new THREE.CylinderGeometry(0.15, 0.15, 4, 16);
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3 });
  const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
  tubeMesh.position.set(-1.8, 2, 2.5);
  tubeMesh.rotation.z = Math.PI / 6;
  liqGroup.add(tubeMesh);

  // Medicine Cup on base tray
  const cupGeo = new THREE.CylinderGeometry(1.2, 0.9, 2, 32);
  const cupMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, transparent: true, opacity: 0.7 });
  const cupMesh = new THREE.Mesh(cupGeo, cupMat);
  cupMesh.position.set(-2.5, -1.6, 3.2);
  liqGroup.add(cupMesh);

  mainGroup.add(liqGroup);

  // --- Collection Tray on Base ---
  const trayGeo = new THREE.BoxGeometry(20, 0.4, 5);
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
  const trayMesh = new THREE.Mesh(trayGeo, trayMat);
  trayMesh.position.set(-1, 3.1, 3.5);
  mainGroup.add(trayMesh);

  scene.add(mainGroup);
}

function drawOledScreen(line1, line2) {
  if (!oledCtx) return;
  oledCtx.fillStyle = '#0f172a';
  oledCtx.fillRect(0, 0, 256, 128);

  // Draw border
  oledCtx.strokeStyle = '#10b981';
  oledCtx.lineWidth = 4;
  oledCtx.strokeRect(4, 4, 248, 120);

  // Draw text
  oledCtx.fillStyle = '#34d399';
  oledCtx.font = 'bold 20px monospace';
  oledCtx.fillText(line1, 16, 45);

  oledCtx.fillStyle = '#60a5fa';
  oledCtx.font = '16px monospace';
  oledCtx.fillText(line2, 16, 80);

  oledCtx.fillStyle = '#94a3b8';
  oledCtx.font = '12px monospace';
  oledCtx.fillText("STATUS: 200 OK | ESP32", 16, 108);

  if (oledTexture) oledTexture.needsUpdate = true;
}

// 3D Servo Motor Animation for Dispensing Pill
function animateContainerDispense(containerIndex) {
  if (containerIndex < 0 || containerIndex >= containerServos.length) return;
  const servo = containerServos[containerIndex];

  let startRot = servo.rotation.y;
  let targetRot = startRot + Math.PI / 2;
  let startTime = performance.now();

  function step(now) {
    let elapsed = (now - startTime) / 1000;
    if (elapsed < 0.6) {
      servo.rotation.y = startRot + (targetRot - startRot) * (elapsed / 0.6);
      requestAnimationFrame(step);
    } else {
      servo.rotation.y = targetRot;
    }
  }
  requestAnimationFrame(step);

  // Flash Screen with Dispense Info
  drawOledScreen(`CONT ${containerIndex + 1} DISPENSED`, "SERVO 90 DEG");
}

// 3D Liquid Pouring Animation
function animateLiquidPour() {
  if (!liquidPumpMesh) return;

  // Animate liquid stream particle dropping
  const particleGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const particleMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });

  for (let i = 0; i < 15; i++) {
    setTimeout(() => {
      const p = new THREE.Mesh(particleGeo, particleMat);
      p.position.set(8.0, 4.5, 1.5);
      scene.add(p);

      let pStart = performance.now();
      function drop(now) {
        let t = (now - pStart) / 500;
        if (t < 1.0) {
          p.position.y = 4.5 - t * 4.0;
          requestAnimationFrame(drop);
        } else {
          scene.remove(p);
        }
      }
      requestAnimationFrame(drop);
    }, i * 120);
  }

  drawOledScreen("LIQUID DISPENSING", "PUMP 5000ms ON");
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  if (!container || !renderer || !camera) return;

  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);

  if (controls) controls.update();

  // Pulsate ESP LED
  if (espLed) {
    espLed.material.opacity = 0.6 + Math.sin(Date.now() * 0.005) * 0.4;
  }

  renderer.render(scene, camera);
}

// Export global triggers
window.init3DViewer = init3DViewer;
window.animateContainerDispense = animateContainerDispense;
window.animateLiquidPour = animateLiquidPour;
window.updateOledScreen = drawOledScreen;
