const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const madeCountEl = document.getElementById("made-count");

const court = {
  width: 880,
  depth: 620,
  top: 64,
  scaleY: 0.78,
  zScale: 0.88,
};

const hoop = {
  x: 0,
  y: 92,
  z: 112,
  rimRadius: 38,
  backboardY: 64,
  backboardZ: 142,
};

const player = {
  x: -120,
  y: 455,
  vx: 0,
  vy: 0,
  facing: -Math.PI / 2,
  speed: 235,
  dashSpeed: 330,
  stride: 0,
  dribbleHand: 1,
  shootCooldown: 0,
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

const keys = new Set();
let lastT = performance.now();
let made = 0;
let message = "自由练习";
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
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

function view() {
  const rect = canvas.getBoundingClientRect();
  return {
    w: rect.width,
    h: rect.height,
    cx: rect.width * 0.5,
    top: rect.height * 0.12,
  };
}

function depthScale(y) {
  return 0.9 + (y / court.depth) * 0.16;
}

function project(x, y, z = 0) {
  const v = view();
  const s = depthScale(y);
  return {
    x: v.cx + x * s,
    y: v.top + y * court.scaleY - z * court.zScale,
    s,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resetBallToPlayer(text = "回到手中") {
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
  message = "投篮";
  messageTimer = 0.9;
}

function updatePlayer(dt) {
  let ix = 0;
  let iy = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) iy -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) iy += 1;

  const moving = ix || iy;
  if (moving) {
    const mag = Math.hypot(ix, iy);
    ix /= mag;
    iy /= mag;
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? player.dashSpeed : player.speed;
    player.vx = ix * speed;
    player.vy = iy * speed;
    player.facing = Math.atan2(iy, ix);
    player.stride += dt * (speed / 36);
  } else {
    player.vx *= Math.pow(0.001, dt);
    player.vy *= Math.pow(0.001, dt);
    player.stride += dt * 1.6;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.x = clamp(player.x, -court.width * 0.45, court.width * 0.45);
  player.y = clamp(player.y, 112, court.depth - 42);
  player.shootCooldown = Math.max(0, player.shootCooldown - dt);
}

function handPoint() {
  const toHoop = Math.atan2(hoop.y - player.y, hoop.x - player.x);
  const side = player.dribbleHand;
  const phase = performance.now() / 1000 * 7.2;
  const bounce = (Math.sin(phase) + 1) * 0.5;
  const lateral = side * 30;
  const forward = 16;
  const cos = Math.cos(toHoop);
  const sin = Math.sin(toHoop);
  return {
    x: player.x + cos * forward - sin * lateral,
    y: player.y + sin * forward + cos * lateral,
    z: 13 + bounce * 30,
    bounce,
  };
}

function updateControlledBall() {
  const hand = handPoint();
  ball.x += (hand.x - ball.x) * 0.45;
  ball.y += (hand.y - ball.y) * 0.45;
  ball.z += (hand.z - ball.z) * 0.6;
  if (hand.bounce < 0.08) player.dribbleHand *= -1;
}

function collideBallWithPlayer(dt) {
  const body = { x: player.x, y: player.y, z: 66, rx: 32, ry: 25, rz: 58 };
  const head = { x: player.x, y: player.y - 4, z: 132, r: 22 };

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
    message = "打板";
    messageTimer = 0.7;
  }

  const rimDx = ball.x - hoop.x;
  const rimDy = ball.y - hoop.y;
  const rimDz = ball.z - hoop.z;
  const rimDist = Math.hypot(rimDx, rimDy);
  const descendingThroughRim = prevZ > hoop.z + 8 && ball.z <= hoop.z + 8 && ball.vz < 0;
  if (!ball.scored && descendingThroughRim && rimDist < hoop.rimRadius - ball.r * 0.45) {
    made += 1;
    madeCountEl.textContent = String(made);
    ball.scored = true;
    message = "命中";
    messageTimer = 1.1;
    setTimeout(() => resetBallToPlayer("继续练习"), 720);
  } else if (Math.abs(rimDz) < ball.r * 1.1 && rimDist > hoop.rimRadius - 8 && rimDist < hoop.rimRadius + ball.r) {
    const nx = rimDx / (rimDist || 1);
    const ny = rimDy / (rimDist || 1);
    ball.vx += nx * 140;
    ball.vy += ny * 140;
    ball.vz = Math.max(ball.vz, 110);
    message = "碰筐";
    messageTimer = 0.55;
  }

  const pickupDist = Math.hypot(ball.x - player.x, ball.y - player.y);
  if (!ball.shot && pickupDist < 46 && ball.z < 38) {
    resetBallToPlayer("重新控球");
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
    player.y = 455;
    resetBallToPlayer("重置");
    keys.delete("KeyR");
  }

  updatePlayer(dt);
  if (ball.controlled) updateControlledBall();
  else {
    updateFreeBall(dt);
    collideBallWithPlayer(dt);
  }
  messageTimer = Math.max(0, messageTimer - dt);
}

function drawCourt() {
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
    project(-92, 70),
    project(92, 70),
    project(92, 310),
    project(-92, 310),
  ];
  ctx.fillStyle = "#b66a4b";
  ctx.beginPath();
  ctx.moveTo(paint[0].x, paint[0].y);
  paint.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(245, 244, 230, 0.82)";
  ctx.lineWidth = 3;
  linePath([
    [-court.width / 2, 0],
    [court.width / 2, 0],
    [court.width / 2, court.depth],
    [-court.width / 2, court.depth],
    [-court.width / 2, 0],
  ]);
  linePath([[-92, 70], [92, 70], [92, 310], [-92, 310], [-92, 70]]);
  linePath([[-60, 70], [60, 70]]);

  drawArc(0, 310, 118, Math.PI, 0);
  drawArc(0, 96, 318, 0.15, Math.PI - 0.15);

  ctx.strokeStyle = "rgba(245, 244, 230, 0.44)";
  ctx.lineWidth = 2;
  for (let x = -84; x <= 84; x += 28) {
    linePath([[x, 92], [x, 112]]);
  }
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

function drawHoop() {
  const poleBase = project(0, 36, 0);
  const poleTop = project(0, 52, 205);
  ctx.strokeStyle = "#232725";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(poleBase.x, poleBase.y);
  ctx.lineTo(poleTop.x, poleTop.y);
  ctx.stroke();

  const b = project(0, hoop.backboardY, hoop.backboardZ);
  ctx.fillStyle = "rgba(224, 240, 218, 0.58)";
  ctx.strokeStyle = "rgba(250, 255, 245, 0.85)";
  ctx.lineWidth = 3;
  ctx.fillRect(b.x - 78, b.y - 55, 156, 96);
  ctx.strokeRect(b.x - 78, b.y - 55, 156, 96);
  ctx.strokeRect(b.x - 26, b.y - 14, 52, 34);

  const r = project(hoop.x, hoop.y, hoop.z);
  ctx.strokeStyle = "#db563d";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(r.x, r.y, hoop.rimRadius * r.s, 11, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(244, 244, 230, 0.55)";
  ctx.lineWidth = 1.4;
  for (let i = -3; i <= 3; i += 1) {
    const x = r.x + i * 10 * r.s;
    ctx.beginPath();
    ctx.moveTo(x, r.y + 5);
    ctx.lineTo(x * 0.99 + r.x * 0.01, r.y + 44);
    ctx.stroke();
  }
}

function drawBall() {
  const shadow = project(ball.x, ball.y, 0);
  const p = project(ball.x, ball.y, ball.z);
  const radius = ball.r * p.s;

  ctx.fillStyle = `rgba(0, 0, 0, ${clamp(0.34 - ball.z / 520, 0.08, 0.3)})`;
  ctx.beginPath();
  ctx.ellipse(shadow.x, shadow.y + 3, radius * 1.05, radius * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e87822";
  ctx.strokeStyle = "#2b1710";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#2b1710";
  ctx.lineWidth = 1.6;
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
  const moveAngle = speed > 18 ? Math.atan2(player.vy, player.vx) : Math.atan2(hoop.y - player.y, hoop.x - player.x);
  const lean = clamp(speed / player.dashSpeed, 0, 1) * 16;
  const bob = Math.sin(player.stride) * 3;
  const side = Math.cos(player.stride);

  const body = project(
    player.x + Math.cos(moveAngle) * lean,
    player.y + Math.sin(moveAngle) * lean,
    70 + bob
  );
  const head = project(
    player.x + Math.cos(moveAngle) * (lean + 8),
    player.y + Math.sin(moveAngle) * (lean + 8),
    132 + bob
  );

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(feet.x, feet.y + 8, 38, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const leftFoot = project(player.x - 23 * side, player.y + 20, 0);
  const rightFoot = project(player.x + 23 * side, player.y + 18, 0);
  const hip = project(player.x, player.y, 52 + bob);
  const kneeL = project(player.x - 15 * side, player.y + 11, 28);
  const kneeR = project(player.x + 15 * side, player.y + 10, 28);
  strokeLimb(hip, kneeL, leftFoot);
  strokeLimb(hip, kneeR, rightFoot);

  const shoulderL = project(player.x - 24, player.y - 2, 100 + bob);
  const shoulderR = project(player.x + 24, player.y - 2, 100 + bob);
  const hand = handPoint();
  const dribble = project(hand.x, hand.y, hand.z + 12);
  const offHand = project(player.x - player.dribbleHand * 26, player.y - 22, 80 + bob);
  if (player.dribbleHand > 0) {
    strokeLimb(shoulderR, dribble);
    strokeLimb(shoulderL, offHand);
  } else {
    strokeLimb(shoulderL, dribble);
    strokeLimb(shoulderR, offHand);
  }

  ctx.fillStyle = "#f5f1df";
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(body.x, body.y, 29, 47, -0.18 + Math.cos(moveAngle) * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#af2e2c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(body.x - 8, body.y - 28);
  ctx.lineTo(body.x + 10, body.y + 20);
  ctx.stroke();

  ctx.fillStyle = "#e7dcc8";
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
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
  ctx.lineWidth = 1;
  roundRect(v.cx - 76, v.h - 84, 152, 38, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff7dd";
  ctx.font = "700 16px Microsoft YaHei, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(message, v.cx, v.h - 60);
  ctx.globalAlpha = 1;
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
