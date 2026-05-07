const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const madeCountEl = document.getElementById("made-count");

const court = {
  width: 1080,
  depth: 880,
  top: 64,
  scaleY: 0.56,
  zScale: 0.78,
  renderScale: 0.8,
};

const hoop = {
  x: 0,
  y: 68,
  z: 193,
  rimRadius: 28,
  backboardY: 38,
  backboardZ: 233,
};

const net = {
  swayX: 0,
  swayY: 0,
  vx: 0,
  vy: 0,
  phase: 0,
  activeTimer: 0,
  touchCooldown: 0,
};

const player = {
  x: -120,
  y: 560,
  vx: 0,
  vy: 0,
  facing: -Math.PI / 2,
  speed: 235 * 2 / 3,
  dashSpeed: 235,
  stride: 0,
  dribbleHand: 1,
  shootCooldown: 0,
  modelScale: 0.667,
};

const ball = {
  x: player.x + 24,
  y: player.y - 8,
  z: 18,
  vx: 0,
  vy: 0,
  vz: 0,
  r: 14,
  controlled: true,
  shot: false,
  scored: false,
};
const dribbleControl = {
  historyWindow: 0.5,
  moveDistanceThreshold: 32,
  moving: false,
  arcCenter: player.facing,
  arcSpan: Math.PI * 2,
  targetAngle: player.facing + Math.PI / 3,
  lastBounceLow: false,
  moveHistory: [],
};

const keys = new Set();
const acceleration = {
  key: "KeyI",
  prepDuration: 1.2,
  speedMultiplier: 1.5,
  maxTurnRate: Math.PI / 2,
  normalInputFadeMs: 250,
  phase: "idle",
  prepTimer: 0,
  lockX: 0,
  lockY: 0,
};
const inputAxes = {
  left: { keys: ["KeyA", "ArrowLeft"], value: 0, releasedAt: 0 },
  right: { keys: ["KeyD", "ArrowRight"], value: 0, releasedAt: 0 },
  up: { keys: ["KeyW", "ArrowUp"], value: 0, releasedAt: 0 },
  down: { keys: ["KeyS", "ArrowDown"], value: 0, releasedAt: 0 },
};
let lastT = performance.now();
let made = 0;
let message = "\u81ea\u7531\u7ec3\u4e60";
let messageTimer = 2.4;

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", fitCanvas);
fitCanvas();

window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
  updateInputAxisKey(event.code, true);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  updateInputAxisKey(event.code, false);
});

function view() {
  const rect = canvas.getBoundingClientRect();
  const bottomGap = Math.max(12, rect.height * 0.025);
  return {
    w: rect.width,
    h: rect.height,
    cx: rect.width * 0.5,
    top: rect.height - court.depth * court.scaleY * court.renderScale - bottomGap,
  };
}

function depthScale(y) {
  return 0.86 + (y / court.depth) * 0.2;
}

function project(x, y, z = 0) {
  const v = view();
  const s = depthScale(y) * court.renderScale;
  return {
    x: v.cx + x * s,
    y: v.top + y * court.scaleY * court.renderScale - z * court.zScale * court.renderScale,
    s,
  };
}

function screen(value) {
  return value * court.renderScale;
}

function playerModel(value) {
  return value * player.modelScale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleDelta(angle, center) {
  return Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
}

function clampAngleToArc(angle, center, span) {
  if (span >= Math.PI * 2 - 0.001) return angle;
  const halfSpan = span / 2;
  return center + clamp(angleDelta(angle, center), -halfSpan, halfSpan);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function updateInputAxisKey(code, pressed) {
  for (const axis of Object.values(inputAxes)) {
    if (!axis.keys.includes(code)) continue;
    if (pressed) {
      axis.value = 1;
      axis.releasedAt = 0;
    } else if (!axis.keys.some((key) => keys.has(key))) {
      axis.releasedAt = performance.now();
    }
  }
}

function updateInputAxisWeights(fadeMs = acceleration.normalInputFadeMs) {
  const now = performance.now();
  for (const axis of Object.values(inputAxes)) {
    if (axis.keys.some((key) => keys.has(key))) {
      axis.value = 1;
      axis.releasedAt = 0;
    } else if (axis.releasedAt > 0) {
      const elapsed = now - axis.releasedAt;
      axis.value = clamp(1 - elapsed / fadeMs, 0, 1);
      if (axis.value <= 0) axis.releasedAt = 0;
    } else {
      axis.value = 0;
    }
  }
}

function normalizeInput(ix, iy) {
  const mag = Math.hypot(ix, iy);
  if (mag <= 0.001) return { x: 0, y: 0, mag };
  const scale = mag > 1 ? 1 / mag : 1;
  return { x: ix * scale, y: iy * scale, mag };
}

function rotateAngleToward(current, target, maxDelta) {
  const delta = angleDelta(target, current);
  return current + clamp(delta, -maxDelta, maxDelta);
}

function wantsLockedPrepMovement(moving, ix, iy) {
  if (!moving) return false;
  return ix * acceleration.lockX + iy * acceleration.lockY > 0.5;
}

function updateAccelerationState(dt, wantsAcceleration, moving, ix, iy) {
  if (!wantsAcceleration) {
    acceleration.phase = "idle";
    acceleration.prepTimer = 0;
    acceleration.lockX = 0;
    acceleration.lockY = 0;
    return;
  }

  if (acceleration.phase === "idle") {
    acceleration.phase = "prepping";
    acceleration.prepTimer = 0;
    acceleration.lockX = moving ? ix : Math.cos(player.facing);
    acceleration.lockY = moving ? iy : Math.sin(player.facing);
    return;
  }

  if (acceleration.phase === "prepping") {
    acceleration.prepTimer += dt;
    if (acceleration.prepTimer >= acceleration.prepDuration) {
      acceleration.phase = "sprinting";
    }
  }

}

function kickNet(strength, dx = 0, dy = 0) {
  const mag = Math.hypot(dx, dy) || 1;
  net.vx += (dx / mag) * 95 * strength;
  net.vy += (dy / mag + 0.45) * 55 * strength;
  net.phase += 1.8 * strength;
  net.activeTimer = 5;
  net.touchCooldown = 0.12;
}

function updateNet(dt) {
  if (net.activeTimer <= 0) {
    net.swayX = 0;
    net.swayY = 0;
    net.vx = 0;
    net.vy = 0;
    net.phase = 0;
    net.touchCooldown = Math.max(0, net.touchCooldown - dt);
    return;
  }

  net.activeTimer = Math.max(0, net.activeTimer - dt);
  if (net.activeTimer <= 0) {
    net.swayX = 0;
    net.swayY = 0;
    net.vx = 0;
    net.vy = 0;
    net.phase = 0;
    net.touchCooldown = 0;
    return;
  }

  net.phase += dt * 9;
  net.swayX += net.vx * dt;
  net.swayY += net.vy * dt;
  net.vx += -net.swayX * 34 * dt;
  net.vy += -net.swayY * 38 * dt;
  const damping = Math.pow(0.002, dt);
  net.vx *= damping;
  net.vy *= damping;
  net.swayX *= Math.pow(0.018, dt);
  net.swayY *= Math.pow(0.014, dt);
  if (Math.abs(net.swayX) + Math.abs(net.swayY) + Math.abs(net.vx) + Math.abs(net.vy) < 0.08) {
    net.swayX = 0;
    net.swayY = 0;
    net.vx = 0;
    net.vy = 0;
  }
  net.touchCooldown = Math.max(0, net.touchCooldown - dt);
}

function resetBallToPlayer(text = "\u56de\u5230\u624b\u4e2d") {
  ball.controlled = true;
  ball.shot = false;
  ball.scored = false;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  message = text;
  messageTimer = 1.2;
}

function shoot() {
  if (!ball.controlled || player.shootCooldown > 0) return;

  const dx = hoop.x - ball.x;
  const dy = hoop.y - ball.y;
  const dist = Math.hypot(dx, dy);
  const time = clamp(0.82 + dist / 720, 0.88, 1.28);
  const targetZ = hoop.z + 8;
  const gravity = 760;

  ball.controlled = false;
  ball.shot = true;
  ball.scored = false;
  ball.vx = dx / time;
  ball.vy = dy / time;
  ball.vz = (targetZ - ball.z + 0.5 * gravity * time * time) / time;
  player.shootCooldown = 0.45;
  message = "\u6295\u7bee";
  messageTimer = 0.9;
}

function updatePlayerMoveHistory() {
  const now = performance.now() / 1000;
  dribbleControl.moveHistory.push({ t: now, x: player.x, y: player.y });
  while (
    dribbleControl.moveHistory.length > 1 &&
    now - dribbleControl.moveHistory[0].t > dribbleControl.historyWindow
  ) {
    dribbleControl.moveHistory.shift();
  }

  const oldest = dribbleControl.moveHistory[0];
  const dx = player.x - oldest.x;
  const dy = player.y - oldest.y;
  const displacement = Math.hypot(dx, dy);
  dribbleControl.moving = displacement > dribbleControl.moveDistanceThreshold;
  if (dribbleControl.moving) {
    dribbleControl.arcCenter = Math.atan2(dy, dx);
    dribbleControl.arcSpan = acceleration.phase === "sprinting" ? Math.PI * 2 / 3 : Math.PI;
    dribbleControl.targetAngle = clampAngleToArc(
      dribbleControl.targetAngle,
      dribbleControl.arcCenter,
      dribbleControl.arcSpan
    );
  } else {
    dribbleControl.arcSpan = Math.PI * 2;
  }
}

function pickDribbleTargetAngle() {
  const span = dribbleControl.arcSpan;
  if (span >= Math.PI * 2 - 0.001) {
    return dribbleControl.targetAngle + randomBetween(-Math.PI * 0.85, Math.PI * 0.85);
  }

  const halfSpan = span / 2;
  let offset = randomBetween(-halfSpan * 0.92, halfSpan * 0.92);
  if (Math.abs(offset) < Math.PI * 0.12) {
    offset += Math.sign(offset || randomBetween(-1, 1)) * Math.PI * 0.12;
  }
  return clampAngleToArc(dribbleControl.arcCenter + offset, dribbleControl.arcCenter, span);
}

function updateDribbleTarget(bounce) {
  const bounceLow = bounce < 0.08;
  if (bounceLow && !dribbleControl.lastBounceLow) {
    dribbleControl.targetAngle = pickDribbleTargetAngle();
  }
  dribbleControl.lastBounceLow = bounceLow;
}

function updatePlayer(dt) {
  updateInputAxisWeights(acceleration.normalInputFadeMs);
  let ix = inputAxes.right.value - inputAxes.left.value;
  let iy = inputAxes.down.value - inputAxes.up.value;

  const input = normalizeInput(ix, iy);
  ix = input.x;
  iy = input.y;
  const moving = input.mag > 0.001;
  updateAccelerationState(dt, keys.has(acceleration.key), moving, ix, iy);
  const prepMoving = acceleration.phase === "prepping" && wantsLockedPrepMovement(moving, ix, iy);
  const hasMovement = acceleration.phase === "prepping" ? prepMoving : moving;

  if (hasMovement) {
    if (acceleration.phase === "prepping") {
      ix = acceleration.lockX;
      iy = acceleration.lockY;
    }

    const speed = acceleration.phase === "sprinting" ? player.speed * acceleration.speedMultiplier : player.speed;
    if (acceleration.phase === "sprinting") {
      const targetAngle = moving ? Math.atan2(iy, ix) : Math.atan2(player.vy, player.vx);
      const currentAngle = Math.hypot(player.vx, player.vy) > 0.001 ? Math.atan2(player.vy, player.vx) : player.facing;
      const moveAngle = rotateAngleToward(currentAngle, targetAngle, acceleration.maxTurnRate * dt);
      player.vx = Math.cos(moveAngle) * speed;
      player.vy = Math.sin(moveAngle) * speed;
      player.facing = moveAngle;
    } else {
      player.vx = ix * speed;
      player.vy = iy * speed;
      player.facing = Math.atan2(iy, ix);
    }
    player.stride += dt * (speed / 36);
  } else {
    player.vx *= Math.pow(0.001, dt);
    player.vy *= Math.pow(0.001, dt);
    player.stride += dt * 1.6;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  const edgeOverhang = playerModel(36);
  player.x = clamp(player.x, -court.width / 2 - edgeOverhang, court.width / 2 + edgeOverhang);
  player.y = clamp(player.y, -edgeOverhang, court.depth + edgeOverhang);
  player.shootCooldown = Math.max(0, player.shootCooldown - dt);
  updatePlayerMoveHistory();
}

function handPoint() {
  const phase = performance.now() / 1000 * 7.2;
  const bounce = (Math.sin(phase) + 1) * 0.5;
  const angle = clampAngleToArc(
    dribbleControl.targetAngle,
    dribbleControl.arcCenter,
    dribbleControl.arcSpan
  );
  const radius = playerModel(40 + (1 - bounce) * 5);
  return {
    x: player.x + Math.cos(angle) * radius,
    y: player.y + Math.sin(angle) * radius,
    z: playerModel(13 + bounce * 30),
    bounce,
  };
}

function updateControlledBall() {
  const hand = handPoint();
  updateDribbleTarget(hand.bounce);
  player.dribbleHand = hand.x >= player.x ? 1 : -1;
  ball.x += (hand.x - ball.x) * 0.45;
  ball.y += (hand.y - ball.y) * 0.45;
  ball.z += (hand.z - ball.z) * 0.6;
}

function collideBallWithPlayer(dt) {
  const body = { x: player.x, y: player.y, z: playerModel(66), rx: playerModel(32), ry: playerModel(25), rz: playerModel(58) };
  const head = { x: player.x, y: player.y - playerModel(4), z: playerModel(132), r: playerModel(22) };

  const dx = (ball.x - body.x) / body.rx;
  const dy = (ball.y - body.y) / body.ry;
  const dz = (ball.z - body.z) / body.rz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1.18 && !ball.controlled) {
    const nx = dx / (d || 1);
    const ny = dy / (d || 1);
    ball.x += nx * 130 * dt;
    ball.y += ny * 130 * dt;
    ball.vx = Math.abs(ball.vx) * nx * 0.55;
    ball.vy = Math.abs(ball.vy) * ny * 0.55;
  }

  const hx = ball.x - head.x;
  const hy = ball.y - head.y;
  const hz = ball.z - head.z;
  const hd = Math.hypot(hx, hy, hz);
  if (hd < ball.r + head.r && !ball.controlled) {
    const nx = hx / (hd || 1);
    const ny = hy / (hd || 1);
    const nz = hz / (hd || 1);
    ball.x = head.x + nx * (ball.r + head.r);
    ball.y = head.y + ny * (ball.r + head.r);
    ball.z = head.z + nz * (ball.r + head.r);
    ball.vx += nx * 90;
    ball.vy += ny * 90;
    ball.vz = Math.max(ball.vz, nz * 180);
  }
}

function updateFreeBall(dt) {
  const gravity = 760;
  const prevZ = ball.z;
  ball.vz -= gravity * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  if (ball.z < ball.r) {
    ball.z = ball.r;
    ball.vz *= -0.64;
    ball.vx *= 0.82;
    ball.vy *= 0.82;
    if (Math.abs(ball.vz) < 70) ball.vz = 0;
  }

  if (Math.abs(ball.x) > court.width * 0.48) {
    ball.x = clamp(ball.x, -court.width * 0.48, court.width * 0.48);
    ball.vx *= -0.55;
  }

  if (ball.y > court.depth - 20 || ball.y < 44) {
    ball.y = clamp(ball.y, 44, court.depth - 20);
    ball.vy *= -0.55;
  }

  const boardHit =
    Math.abs(ball.y - hoop.backboardY) < ball.r + 5 &&
    Math.abs(ball.x) < 118 &&
    ball.z > 76 &&
    ball.z < 218 &&
    ball.vy < 0;
  if (boardHit) {
    ball.y = hoop.backboardY + ball.r + 6;
    ball.vy *= -0.7;
    ball.vx *= 0.86;
    ball.vz *= 0.9;
    message = "\u6253\u677f";
    messageTimer = 0.7;
  }

  const rimDx = ball.x - hoop.x;
  const rimDy = ball.y - hoop.y;
  const rimDz = ball.z - hoop.z;
  const rimDist = Math.hypot(rimDx, rimDy);
  const descendingThroughRim = prevZ > hoop.z + 8 && ball.z <= hoop.z + 8 && ball.vz < 0;
  if (!ball.scored && descendingThroughRim && rimDist < hoop.rimRadius - ball.r * 0.45) {
    kickNet(1.35, rimDx + ball.vx * 0.04, rimDy + ball.vy * 0.04);
    made += 1;
    madeCountEl.textContent = String(made);
    ball.scored = true;
    message = "\u547d\u4e2d";
    messageTimer = 1.1;
    setTimeout(() => resetBallToPlayer("\u7ee7\u7eed\u7ec3\u4e60"), 720);
  } else if (Math.abs(rimDz) < ball.r * 1.1 && rimDist > hoop.rimRadius - 8 && rimDist < hoop.rimRadius + ball.r) {
    const nx = rimDx / (rimDist || 1);
    const ny = rimDy / (rimDist || 1);
    ball.vx += nx * 140;
    ball.vy += ny * 140;
    ball.vz = Math.max(ball.vz, 110);
    message = "\u78b0\u7b50";
    messageTimer = 0.55;
  }

  const netTop = hoop.z + 3;
  const netBottom = hoop.z - 29;
  const inNetHeight = ball.z < netTop + ball.r * 0.35 && ball.z > netBottom - ball.r * 0.35;
  const netProgress = clamp((netTop - ball.z) / (netTop - netBottom), 0, 1);
  const netRadius = hoop.rimRadius * (1 - netProgress) + hoop.rimRadius * 0.58 * netProgress;
  const closeToNet = rimDist < netRadius + ball.r * 0.85 && rimDist > netRadius - ball.r * 1.2;
  if (!ball.controlled && net.touchCooldown <= 0 && inNetHeight && closeToNet) {
    kickNet(0.55, rimDx + ball.vx * 0.025, rimDy + ball.vy * 0.025);
  }

  const pickupDist = Math.hypot(ball.x - player.x, ball.y - player.y);
  if (!ball.shot && pickupDist < 46 && ball.z < 38) {
    resetBallToPlayer("\u91cd\u65b0\u63a7\u7403");
  }

  if (ball.shot && ball.z <= ball.r && Math.hypot(ball.vx, ball.vy) < 34 && !ball.scored) {
    ball.shot = false;
  }
}

function update(dt) {
  if (keys.has("Space")) {
    shoot();
    keys.delete("Space");
  }
  if (keys.has("KeyR")) {
    player.x = -120;
    player.y = 560;
    resetBallToPlayer("\u91cd\u7f6e");
    keys.delete("KeyR");
  }

  updatePlayer(dt);
  if (ball.controlled) updateControlledBall();
  else {
    updateFreeBall(dt);
    collideBallWithPlayer(dt);
  }
  updateNet(dt);
  messageTimer = Math.max(0, messageTimer - dt);
}

function drawCourt() {
  const paintHalfWidth = 140;
  const paintTop = 0;
  const freeThrowY = 382;
  const freeThrowRadius = paintHalfWidth;
  const threePointSideX = 440;
  const threePointBreakY = 170;
  const threePointRadius = threePointSideX;
  const centerCircleRadius = 130;

  const corners = [
    project(-court.width / 2, 0),
    project(court.width / 2, 0),
    project(court.width / 2, court.depth),
    project(-court.width / 2, court.depth),
  ];

  ctx.fillStyle = "#477a52";
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fill();

  const paint = [
    project(-paintHalfWidth, paintTop),
    project(paintHalfWidth, paintTop),
    project(paintHalfWidth, freeThrowY),
    project(-paintHalfWidth, freeThrowY),
  ];
  ctx.fillStyle = "#b66a4b";
  ctx.beginPath();
  ctx.moveTo(paint[0].x, paint[0].y);
  paint.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(245, 244, 230, 0.82)";
  ctx.lineWidth = screen(3);
  linePath([
    [-court.width / 2, 0],
    [court.width / 2, 0],
    [court.width / 2, court.depth],
    [-court.width / 2, court.depth],
    [-court.width / 2, 0],
  ]);
  linePath([
    [-paintHalfWidth, paintTop],
    [paintHalfWidth, paintTop],
    [paintHalfWidth, freeThrowY],
    [-paintHalfWidth, freeThrowY],
    [-paintHalfWidth, paintTop],
  ]);
  linePath([[-64, paintTop], [64, paintTop]]);

  drawArc(0, freeThrowY, freeThrowRadius, Math.PI, 0);
  drawThreePointLine({
    sideX: threePointSideX,
    breakY: threePointBreakY,
    radius: threePointRadius,
  });
  drawArc(0, court.depth, centerCircleRadius, Math.PI, Math.PI * 2);

  ctx.fillStyle = "rgba(245, 244, 230, 0.88)";
  const laneMarkLength = 18;
  const laneMarkThin = laneMarkLength / 2;
  const laneMarkYs = [1, 2, 3, 4].map((step) => (freeThrowY * step) / 5);
  for (const [index, y] of laneMarkYs.entries()) {
    const markWidth = index === 0 ? laneMarkLength : laneMarkThin;
    drawLaneMark(-1, paintHalfWidth, y, laneMarkLength, markWidth);
    drawLaneMark(1, paintHalfWidth, y, laneMarkLength, markWidth);
  }
}

function drawLaneMark(side, paintHalfWidth, y, length, width) {
  const innerX = side * paintHalfWidth;
  const outerX = side * (paintHalfWidth + length);
  const y0 = y - width / 2;
  const y1 = y + width / 2;
  const points = [
    project(innerX, y0),
    project(outerX, y0),
    project(outerX, y1),
    project(innerX, y1),
  ];

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
}

function linePath(points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const p = project(x, y);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawArc(cx, cy, r, a0, a1) {
  const steps = 44;
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const t = a0 + ((a1 - a0) * i) / steps;
    const p = project(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawThreePointLine({ sideX, breakY, radius }) {
  const steps = 54;
  const rightBase = project(sideX, 0);
  const rightBreak = project(sideX, breakY);

  ctx.beginPath();
  ctx.moveTo(rightBase.x, rightBase.y);
  ctx.lineTo(rightBreak.x, rightBreak.y);

  for (let i = 0; i <= steps; i += 1) {
    const t = (Math.PI * i) / steps;
    const p = project(Math.cos(t) * radius, breakY + Math.sin(t) * radius);
    ctx.lineTo(p.x, p.y);
  }

  const leftBase = project(-sideX, 0);
  ctx.lineTo(leftBase.x, leftBase.y);
  ctx.stroke();
}

function drawHoop() {
  const poleBase = project(0, -24, 0);
  const marker = project(hoop.x, hoop.y, 0);
  ctx.fillStyle = "rgba(255, 248, 230, 0.035)";
  ctx.strokeStyle = "rgba(255, 248, 230, 0.11)";
  ctx.lineWidth = screen(1);
  const markerRx = hoop.rimRadius * marker.s * 1.08;
  ctx.beginPath();
  ctx.ellipse(marker.x, marker.y, markerRx, markerRx / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const b = project(0, hoop.backboardY, hoop.backboardZ);
  const boardW = screen(156);
  const boardH = screen(96);
  const targetW = screen(52);
  const targetH = screen(34);
  const targetBottomY = b.y - screen(4) + targetH;

  ctx.fillStyle = "rgba(73, 49, 29, 0.78)";
  ctx.strokeStyle = "rgba(250, 230, 188, 0.5)";
  ctx.lineWidth = screen(1.5);
  ctx.beginPath();
  ctx.rect(poleBase.x - screen(23), poleBase.y - screen(5), screen(46), screen(12));
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#6b4628";
  ctx.lineWidth = screen(10);
  ctx.beginPath();
  ctx.moveTo(poleBase.x, poleBase.y);
  ctx.lineTo(poleBase.x, targetBottomY);
  ctx.stroke();

  ctx.fillStyle = "rgba(224, 240, 218, 0.58)";
  ctx.strokeStyle = "rgba(250, 255, 245, 0.85)";
  ctx.lineWidth = screen(3);
  ctx.fillRect(b.x - boardW / 2, b.y - screen(55), boardW, boardH);
  ctx.strokeRect(b.x - boardW / 2, b.y - screen(55), boardW, boardH);
  ctx.strokeRect(b.x - targetW / 2, b.y - screen(4), targetW, targetH);

  const r = project(hoop.x, hoop.y, hoop.z);
  const rimRx = hoop.rimRadius * r.s;
  ctx.strokeStyle = "#db563d";
  ctx.lineWidth = screen(5);
  ctx.beginPath();
  ctx.ellipse(r.x, r.y, rimRx, rimRx / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  const netMotion = net.activeTimer > 0 ? 1 : 0;
  const swayX = screen(net.swayX + Math.sin(net.phase) * Math.min(5, Math.abs(net.swayX) * 0.14) * netMotion);
  const swayY = screen(net.swayY + Math.cos(net.phase * 0.85) * Math.min(4, Math.abs(net.swayY) * 0.12) * netMotion);
  const netLength = screen(27.5);
  const topRx = hoop.rimRadius * r.s * 0.92;
  const topRy = screen(10);
  const bottomRx = topRx * 0.58;
  const bottomRy = screen(6.2);
  const strandCount = 10;

  ctx.strokeStyle = "rgba(252, 249, 235, 0.7)";
  ctx.lineWidth = screen(1.25);
  for (let i = 0; i < strandCount; i += 1) {
    const t = i / strandCount;
    const angle = Math.PI * 2 * t;
    const topX = r.x + Math.cos(angle) * topRx;
    const topY = r.y + Math.sin(angle) * topRy + screen(4);
    const bottomX = r.x + swayX + Math.cos(angle + 0.22) * bottomRx;
    const bottomY = r.y + netLength + swayY + Math.sin(angle + 0.22) * bottomRy;
    const midX = (topX + bottomX) * 0.5 + Math.sin(net.phase + i * 0.8) * screen(3.5) * netMotion;
    const midY = (topY + bottomY) * 0.5 + screen(5);

    ctx.globalAlpha = i < strandCount / 2 ? 0.48 : 0.78;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX, midY, bottomX, bottomY);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.62;
  for (let band = 1; band <= 5; band += 1) {
    const p = band / 6;
    const bandX = r.x + swayX * p * 0.72;
    const bandY = r.y + screen(7) + netLength * p + swayY * p;
    const bandRx = topRx * (1 - p) + bottomRx * p;
    const bandRy = topRy * (1 - p) + bottomRy * p;
    ctx.beginPath();
    ctx.ellipse(bandX, bandY, bandRx, bandRy, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "#db563d";
  ctx.lineWidth = screen(5);
  ctx.beginPath();
  ctx.ellipse(r.x, r.y, rimRx, rimRx / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBall() {
  const shadow = project(ball.x, ball.y, 0);
  const p = project(ball.x, ball.y, ball.z);
  const radius = ball.r * p.s;

  ctx.fillStyle = `rgba(0, 0, 0, ${clamp(0.34 - ball.z / 520, 0.08, 0.3)})`;
  const shadowRx = radius * 1.05;
  ctx.beginPath();
  ctx.ellipse(shadow.x, shadow.y + screen(3), shadowRx, shadowRx / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e87822";
  ctx.strokeStyle = "#2b1710";
  ctx.lineWidth = screen(2);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#2b1710";
  ctx.lineWidth = screen(1.6);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius * 0.72, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - radius, p.y);
  ctx.lineTo(p.x + radius, p.y);
  ctx.moveTo(p.x, p.y - radius);
  ctx.lineTo(p.x, p.y + radius);
  ctx.stroke();
}

function drawPlayer() {
  const feet = project(player.x, player.y, 0);
  const speed = Math.hypot(player.vx, player.vy);
  const preparing = acceleration.phase === "prepping";
  const sprinting = acceleration.phase === "sprinting";
  const prepAngle = Math.atan2(acceleration.lockY, acceleration.lockX);
  const moveAngle = preparing ? prepAngle : speed > 18 ? Math.atan2(player.vy, player.vx) : Math.atan2(hoop.y - player.y, hoop.x - player.x);
  const prepProgress = preparing ? clamp(acceleration.prepTimer / acceleration.prepDuration, 0, 1) : 0;
  const prepLoad = Math.sin(prepProgress * Math.PI);
  const sprintLean = sprinting ? 6 : 0;
  const prepLean = preparing ? 9 + prepLoad * 10 : 0;
  const crouch = playerModel(preparing ? 9 + prepLoad * 13 : sprinting ? 3 : 0);
  const lean = playerModel(clamp(speed / player.dashSpeed, 0, 1) * 16 + sprintLean + prepLean);
  const bob = playerModel(Math.sin(player.stride) * 3) - crouch;
  const side = preparing ? Math.cos(player.stride) * 0.32 : Math.cos(player.stride);
  const ux = Math.cos(moveAngle);
  const uy = Math.sin(moveAngle);
  const px = -uy;
  const py = ux;

  const body = project(
    player.x + Math.cos(moveAngle) * lean,
    player.y + Math.sin(moveAngle) * lean,
    playerModel(70) + bob
  );
  const head = project(
    player.x + Math.cos(moveAngle) * (lean + playerModel(8)),
    player.y + Math.sin(moveAngle) * (lean + playerModel(8)),
    playerModel(132) + bob
  );

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  const footShadowRx = screen(playerModel(38));
  ctx.beginPath();
  ctx.ellipse(feet.x, feet.y + screen(playerModel(8)), footShadowRx, footShadowRx / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPlayerGroundIndicator();

  ctx.strokeStyle = "#151515";
  ctx.lineWidth = screen(playerModel(5));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const footSpread = playerModel(23 + (preparing ? 12 * prepLoad : 0));
  const plantBack = playerModel(preparing ? 12 + 10 * prepLoad : 0);
  const driveForward = playerModel(sprinting ? 7 : 0);
  const leftFoot = project(
    player.x - px * footSpread * side - ux * plantBack,
    player.y - py * footSpread * side - uy * plantBack + playerModel(20),
    0
  );
  const rightFoot = project(
    player.x + px * footSpread * side + ux * driveForward,
    player.y + py * footSpread * side + uy * driveForward + playerModel(18),
    0
  );
  const hip = project(player.x - ux * plantBack * 0.35, player.y - uy * plantBack * 0.35, playerModel(52) + bob);
  const kneeL = project(
    player.x - px * playerModel(15) * side - ux * plantBack * 0.55,
    player.y - py * playerModel(15) * side - uy * plantBack * 0.55 + playerModel(11),
    playerModel(28) - crouch * 0.25
  );
  const kneeR = project(
    player.x + px * playerModel(15) * side,
    player.y + py * playerModel(15) * side + playerModel(10),
    playerModel(28) - crouch * 0.2
  );
  strokeLimb(hip, kneeL, leftFoot);
  strokeLimb(hip, kneeR, rightFoot);

  const shoulderL = project(player.x - playerModel(24) - ux * plantBack * 0.15, player.y - playerModel(2) - uy * plantBack * 0.15, playerModel(100) + bob);
  const shoulderR = project(player.x + playerModel(24) - ux * plantBack * 0.15, player.y - playerModel(2) - uy * plantBack * 0.15, playerModel(100) + bob);
  const hand = handPoint();
  const dribble = project(hand.x, hand.y, hand.z + playerModel(12));
  const offHand = project(player.x - player.dribbleHand * playerModel(26), player.y - playerModel(22), playerModel(80) + bob);
  if (player.dribbleHand > 0) {
    strokeLimb(shoulderR, dribble);
    strokeLimb(shoulderL, offHand);
  } else {
    strokeLimb(shoulderL, dribble);
    strokeLimb(shoulderR, offHand);
  }

  ctx.fillStyle = "#f5f1df";
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = screen(playerModel(4));
  ctx.beginPath();
  ctx.ellipse(body.x, body.y, screen(playerModel(29)), screen(playerModel(47)), -0.18 + Math.cos(moveAngle) * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#af2e2c";
  ctx.lineWidth = screen(playerModel(3));
  ctx.beginPath();
  ctx.moveTo(body.x - screen(playerModel(8)), body.y - screen(playerModel(28)));
  ctx.lineTo(body.x + screen(playerModel(10)), body.y + screen(playerModel(20)));
  ctx.stroke();

  ctx.fillStyle = "#e7dcc8";
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = screen(playerModel(4));
  ctx.beginPath();
  ctx.arc(head.x, head.y, screen(playerModel(22)), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function projectedPolygonPath(points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const p = project(point.x, point.y, 0);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

function drawPlayerGroundIndicator() {
  const footShadowRx = screen(playerModel(38));
  const arcWidth = Math.max(5, screen(playerModel(8)));
  const arcGap = screen(playerModel(1.5));
  const feet = project(player.x, player.y, 0);
  const centerY = feet.y + screen(playerModel(8));
  const arcRx = footShadowRx + arcGap + arcWidth / 2;
  const arcRy = footShadowRx / 2 + arcGap / 2 + arcWidth / 2;

  ctx.save();
  ctx.lineCap = "round";
  if (acceleration.phase === "prepping") {
    ctx.strokeStyle = "rgba(238, 177, 64, 0.72)";
  } else if (acceleration.phase === "sprinting") {
    ctx.strokeStyle = "rgba(80, 190, 130, 0.72)";
  } else {
    ctx.strokeStyle = dribbleControl.moving ? "rgba(0, 0, 0, 0.34)" : "rgba(0, 0, 0, 0.24)";
  }
  ctx.lineWidth = arcWidth;
  ctx.beginPath();
  if (dribbleControl.arcSpan >= Math.PI * 2 - 0.001) {
    ctx.ellipse(feet.x, centerY, arcRx, arcRy, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(
      feet.x,
      centerY,
      arcRx,
      arcRy,
      0,
      dribbleControl.arcCenter - dribbleControl.arcSpan / 2,
      dribbleControl.arcCenter + dribbleControl.arcSpan / 2
    );
  }
  ctx.stroke();

  if (dribbleControl.moving) {
    const ringRadius = playerModel(31);
    const ux = Math.cos(dribbleControl.arcCenter);
    const uy = Math.sin(dribbleControl.arcCenter);
    const tx = -uy;
    const ty = ux;
    const baseDistance = ringRadius * 0.98;
    const tipDistance = ringRadius + playerModel(15);
    const halfBase = playerModel(7);
    const baseX = player.x + ux * baseDistance;
    const baseY = player.y + uy * baseDistance;
    const points = [
      { x: baseX + tx * halfBase, y: baseY + ty * halfBase },
      { x: player.x + ux * tipDistance, y: player.y + uy * tipDistance },
      { x: baseX - tx * halfBase, y: baseY - ty * halfBase },
    ];

    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = Math.max(1.2, screen(playerModel(1.6)));
    projectedPolygonPath(points);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function strokeLimb(...points) {
  ctx.beginPath();
  points.forEach((p, index) => {
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawMessage() {
  if (messageTimer <= 0) return;
  const v = view();
  ctx.globalAlpha = clamp(messageTimer, 0, 1);
  ctx.fillStyle = "rgba(15, 18, 14, 0.58)";
  ctx.strokeStyle = "rgba(255, 248, 230, 0.24)";
  ctx.lineWidth = screen(1);
  roundRect(v.cx - 76, v.h - 84, 152, 38, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff7dd";
  ctx.font = "700 16px Microsoft YaHei, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(message, v.cx, v.h - 60);
  ctx.globalAlpha = 1;
}

function drawVelocityRadar() {
  const v = view();
  const radius = clamp(Math.min(v.w, v.h) * 0.075, 34, 48);
  const margin = Math.max(18, radius * 0.55);
  const cx = margin + radius;
  const cy = v.h - margin - radius;
  const nx = clamp(player.vx / player.dashSpeed, -1, 1);
  const ny = clamp(player.vy / player.dashSpeed, -1, 1);
  const px = cx + nx * radius;
  const py = cy + ny * radius;
  const normalSpeedRadius = radius * (player.speed / player.dashSpeed);

  ctx.save();
  ctx.fillStyle = "rgba(10, 16, 12, 0.62)";
  ctx.strokeStyle = "rgba(245, 248, 230, 0.38)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(245, 248, 230, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  ctx.strokeStyle = "rgba(245, 248, 230, 0.18)";
  ctx.beginPath();
  ctx.arc(cx, cy, normalSpeedRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(74, 171, 231, 0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, py);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.strokeStyle = "rgba(126, 210, 77, 0.72)";
  ctx.beginPath();
  ctx.moveTo(px, cy);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.strokeStyle = "rgba(250, 255, 238, 0.86)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.fillStyle = "rgba(250, 255, 238, 0.95)";
  ctx.beginPath();
  ctx.arc(px, py, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function render() {
  const v = view();
  ctx.clearRect(0, 0, v.w, v.h);

  const bg = ctx.createLinearGradient(0, 0, 0, v.h);
  bg.addColorStop(0, "#22241d");
  bg.addColorStop(1, "#11150f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, v.w, v.h);

  drawCourt();
  drawHoop();

  if (ball.y < player.y) {
    drawBall();
    drawPlayer();
  } else {
    drawPlayer();
    drawBall();
  }
  drawVelocityRadar();
  drawMessage();
}

function loop(t) {
  const dt = Math.min(0.033, (t - lastT) / 1000);
  lastT = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
