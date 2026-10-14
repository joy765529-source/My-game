import * as THREE from "three";

/**
 * Owns the Three.js scene and the small amount of first-person game logic.
 * The UI lives in React; this file only handles the world, camera, and input.
 */
export type FirstPersonGame = {
  start: () => void;
  move: (x: number, z: number, autoSprint?: boolean) => void;
  look: (deltaX: number, deltaY: number) => void;
  setSensitivity: (percent: number) => void;
  setSprinting: (active: boolean) => void;
  toggleCrouching: () => void;
  jump: () => void;
  dash: () => boolean;
  punch: () => void;
  summonEnemy: () => void;
  dispose: () => void;
};

export type EnemyBehavior = "melee" | "ranged" | "flee";

export type PlayerStats = {
  health: number;
  stamina: number;
  grounded: boolean;
  canJump: boolean;
  canDash: boolean;
  sprinting: boolean;
  crouching: boolean;
  slamming: boolean;
  sliding: boolean;
  wallClimbing: boolean;
  enemyHealth: number | null;
  enemyBehavior: EnemyBehavior | null;
};

const ROOM_WIDTH = 42;
const ROOM_DEPTH = 32;
const ROOM_HEIGHT = 14;
const WALL_THICKNESS = 0.8;
const PLAYER_HEIGHT = 1.65;
const CROUCH_HEIGHT = 1.05;
const PLAYER_RADIUS = 0.38;
const WALK_SPEED = 10;
const SPRINT_SPEED = WALK_SPEED * 3;
const CROUCH_SPEED = WALK_SPEED * 0.55;
const SLIDE_SPEED = WALK_SPEED * 1.5;
const ENEMY_WALK_SPEED = WALK_SPEED;
const ENEMY_RADIUS = 0.56;
const ENEMY_HEIGHT = 1.25;
const ENEMY_PROJECTILE_SPEED = SPRINT_SPEED;
const ENEMY_PROJECTILE_DAMAGE = 15;
const PLAYER_PUNCH_DAMAGE = 50;
const PLAYER_PUNCH_RANGE = 3.1;
const ENEMY_MELEE_RANGE = 1.55;
const ENEMY_MELEE_DAMAGE = 10;
const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const SPRINT_STAMINA_DRAIN = 10;
const STAMINA_REGENERATION = 18;
const JUMP_STAMINA_COST = 10;
const DASH_STAMINA_COST = 15;
const AIR_DASH_STAMINA_COST = 30;
const SPRINT_DASH_STAMINA_COST = 50;
const SLAM_STAMINA_COST = 5;
const SLAM_JUMP_TOTAL_COST = 20;
const SLAM_DASH_TOTAL_COST = 7;
const SLIDE_STAMINA_DRAIN = 2;
const WALL_HOLD_STAMINA_DRAIN = 1;
const WALL_WALK_STAMINA_DRAIN = 2;
const WALL_JUMP_STAMINA_COST = 3;
const WALL_JUMP_VELOCITY = 6.5;
const JUMP_VELOCITY = 9.2;
const GRAVITY = 17;
const SLAM_VELOCITY = -18;
const DASH_DURATION = 0.2;
const DASH_DISTANCE = 5;
const AIR_DASH_DISTANCE = 8;
const SPRINT_DASH_DISTANCE = 13;
const SLAM_DASH_DISTANCE = 4.5;
const BOUNDARY_X = ROOM_WIDTH / 2 - WALL_THICKNESS / 2 - PLAYER_RADIUS;
const BOUNDARY_Z = ROOM_DEPTH / 2 - WALL_THICKNESS / 2 - PLAYER_RADIUS;
const WALL_GRAB_DISTANCE = 0.78;
const MAX_STEP_HEIGHT = 0.34;
const LOOK_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI / 2 - 0.08;

type SolidBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

type FlatSurface = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
};

type RampSurface = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  lowZ: number;
  highZ: number;
  lowHeight: number;
  highHeight: number;
};

type RoomPhysics = {
  solids: SolidBox[];
  surfaces: FlatSurface[];
  ramps: RampSurface[];
};

type WallSide = "west" | "east" | "north" | "south";

type TrainingEnemy = {
  root: THREE.Group;
  body: THREE.Mesh;
  healthFill: THREE.Mesh;
  health: number;
  behavior: EnemyBehavior;
  behaviorTime: number;
  attackTime: number;
  comboStep: number;
  comboTime: number;
};

type EnemyProjectile = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
};

export function createFirstPersonGame(
  mount: HTMLElement,
  onStats?: (stats: PlayerStats) => void,
): FirstPersonGame {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#145e9f");

  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 80);
  camera.position.set(0, PLAYER_HEIGHT, 11);
  camera.rotation.order = "YXZ";

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute("aria-label", "First-person view of the test room");
  renderer.domElement.dataset.testid = "game-canvas";
  mount.appendChild(renderer.domElement);

  const roomPhysics: RoomPhysics = { solids: [], surfaces: [], ramps: [] };
  buildRoom(scene, roomPhysics);

  // Reuse vectors during movement so the animation loop creates little garbage.
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const travel = new THREE.Vector3();
  const dashVelocity = new THREE.Vector3();
  const pressedKeys = new Set<string>();
  const projectiles: EnemyProjectile[] = [];
  let touchX = 0;
  let touchZ = 0;
  let joystickAutoSprint = false;
  let health = MAX_HEALTH;
  let stamina = MAX_STAMINA;
  let sprintRequested = false;
  let shiftHeld = false;
  let doubleTapSprint = false;
  let previousMovementKey = "";
  let previousMovementTapAt = 0;
  let crouchHeld = false;
  let sliding = false;
  let wallClimbing = false;
  let wallSide: WallSide | null = null;
  let wallJumping = false;
  let dashUsesVerticalAim = false;
  let aerialJumpStaminaPaid = 0;
  let grounded = true;
  let slamming = false;
  let slamStaminaAtStart = 0;
  let verticalVelocity = 0;
  let groundY = 0;
  let dashTimeRemaining = 0;
  let yaw = 0;
  let pitch = 0;
  let lookSensitivityPercent = 25;
  let enemy: TrainingEnemy | null = null;
  let knockbackVelocity = new THREE.Vector3();
  let knockbackTime = 0;
  let punchCooldown = 0;
  let isPlaying = false;
  let frameId = 0;
  let previousTime = 0;
  let statsElapsed = 0;
  let lastStatsKey = "";

  const getInput = () => {
    let x = touchX;
    let z = touchZ;
    if (pressedKeys.has("a") || pressedKeys.has("arrowleft")) x -= 1;
    if (pressedKeys.has("d") || pressedKeys.has("arrowright")) x += 1;
    if (pressedKeys.has("w") || pressedKeys.has("arrowup")) z -= 1;
    if (pressedKeys.has("s") || pressedKeys.has("arrowdown")) z += 1;
    const rawLength = Math.hypot(x, z);
    if (rawLength > 1) {
      x /= rawLength;
      z /= rawLength;
    }
    return { x, z, length: Math.min(rawLength, 1) };
  };

  const getPlanarDirection = (
    inputX: number,
    inputZ: number,
    sidewaysOnly = false,
  ): THREE.Vector3 => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.set(-forward.z, 0, forward.x);

    if (sidewaysOnly) {
      travel.copy(right).multiplyScalar(inputX < -0.08 ? -1 : 1);
    } else {
      travel
        .copy(forward)
        .multiplyScalar(-inputZ)
        .addScaledVector(right, inputX);
      if (travel.lengthSq() < 0.0001) travel.copy(forward);
    }
    return travel.normalize();
  };

  const findWallSide = (): WallSide | null => {
    const xGap = BOUNDARY_X - Math.abs(camera.position.x);
    const zGap = BOUNDARY_Z - Math.abs(camera.position.z);
    const xNear = xGap >= -0.01 && xGap <= WALL_GRAB_DISTANCE;
    const zNear = zGap >= -0.01 && zGap <= WALL_GRAB_DISTANCE;
    if (xNear && (!zNear || xGap <= zGap)) {
      return camera.position.x < 0 ? "west" : "east";
    }
    if (zNear) return camera.position.z < 0 ? "north" : "south";

    const feet = camera.position.y - PLAYER_HEIGHT;
    let nearestSide: WallSide | null = null;
    let nearestGap = WALL_GRAB_DISTANCE + 1;
    for (const box of roomPhysics.solids) {
      if (feet >= box.maxY - 0.06 || camera.position.y <= box.minY + 0.04) continue;

      const overlapsZ =
        camera.position.z + PLAYER_RADIUS > box.minZ &&
        camera.position.z - PLAYER_RADIUS < box.maxZ;
      if (overlapsZ) {
        if (camera.position.x <= box.minX - PLAYER_RADIUS) {
          const gap = box.minX - PLAYER_RADIUS - camera.position.x;
          if (gap >= -0.01 && gap <= nearestGap) {
            nearestGap = gap;
            nearestSide = "east";
          }
        } else if (camera.position.x >= box.maxX + PLAYER_RADIUS) {
          const gap = camera.position.x - box.maxX - PLAYER_RADIUS;
          if (gap >= -0.01 && gap <= nearestGap) {
            nearestGap = gap;
            nearestSide = "west";
          }
        }
      }

      const overlapsX =
        camera.position.x + PLAYER_RADIUS > box.minX &&
        camera.position.x - PLAYER_RADIUS < box.maxX;
      if (overlapsX) {
        if (camera.position.z <= box.minZ - PLAYER_RADIUS) {
          const gap = box.minZ - PLAYER_RADIUS - camera.position.z;
          if (gap >= -0.01 && gap <= nearestGap) {
            nearestGap = gap;
            nearestSide = "south";
          }
        } else if (camera.position.z >= box.maxZ + PLAYER_RADIUS) {
          const gap = camera.position.z - box.maxZ - PLAYER_RADIUS;
          if (gap >= -0.01 && gap <= nearestGap) {
            nearestGap = gap;
            nearestSide = "north";
          }
        }
      }
    }
    return nearestSide;
  };

  const movePlayerBy = (deltaX: number, deltaZ: number) => {
    let hitSomething = false;
    const largestStep = 0.22;
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaZ)) / largestStep),
    );
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;

    for (let index = 0; index < steps; index += 1) {
      const tryMove = (axis: "x" | "z", amount: number) => {
        if (amount === 0) return;
        const rawX = axis === "x" ? camera.position.x + amount : camera.position.x;
        const rawZ = axis === "z" ? camera.position.z + amount : camera.position.z;
        const x = THREE.MathUtils.clamp(rawX, -BOUNDARY_X, BOUNDARY_X);
        const z = THREE.MathUtils.clamp(rawZ, -BOUNDARY_Z, BOUNDARY_Z);
        if (x !== rawX || z !== rawZ) hitSomething = true;
        const feet = grounded
          ? groundY
          : camera.position.y - PLAYER_HEIGHT;
        const targetGround = grounded
          ? getWalkableHeight(roomPhysics, x, z, groundY)
          : feet;
        const candidateFeet = grounded ? targetGround : feet;
        if (isBlocked(roomPhysics, x, z, candidateFeet)) {
          hitSomething = true;
          return;
        }

        camera.position.x = x;
        camera.position.z = z;
        if (grounded) {
          if (targetGround < groundY - MAX_STEP_HEIGHT) {
            grounded = false;
            verticalVelocity = 0;
          } else {
            groundY = targetGround;
            camera.position.y =
              groundY + (crouchHeld ? CROUCH_HEIGHT : PLAYER_HEIGHT);
          }
        }
      };

      tryMove("x", stepX);
      tryMove("z", stepZ);
    }
    return hitSomething;
  };

  const beginBurst = (
    direction: THREE.Vector3,
    distance: number,
    useVerticalAim = false,
  ) => {
    dashVelocity.copy(direction).multiplyScalar(distance / DASH_DURATION);
    dashTimeRemaining = DASH_DURATION;
    dashUsesVerticalAim = useVerticalAim;
  };

  const sprintIsActive = () =>
    (sprintRequested || joystickAutoSprint || shiftHeld || doubleTapSprint) &&
    stamina > 0;
  const getAirDashCost = () =>
    Math.max(0, AIR_DASH_STAMINA_COST - aerialJumpStaminaPaid);

  const setSprinting = (active: boolean) => {
    sprintRequested = active && isPlaying && stamina > 0;
    if (sprintRequested && wallClimbing) {
      wallClimbing = false;
      wallSide = null;
    }
    if (sprintRequested) sliding = false;
    publishStats();
  };

  const setSensitivity = (percent: number) => {
    lookSensitivityPercent = THREE.MathUtils.clamp(percent, 25, 200);
  };

  const getStats = (): PlayerStats => ({
    health,
    stamina: Math.round(stamina),
    grounded,
    canJump:
      isPlaying &&
      stamina >=
        (wallClimbing
          ? WALL_JUMP_STAMINA_COST
          : slamming
            ? SLAM_JUMP_TOTAL_COST - SLAM_STAMINA_COST
            : JUMP_STAMINA_COST) &&
      (!slamming || slamStaminaAtStart >= SLAM_JUMP_TOTAL_COST),
    canDash:
      isPlaying &&
      stamina >=
        (slamming
          ? SLAM_DASH_TOTAL_COST - SLAM_STAMINA_COST
          : sprintIsActive()
            ? SPRINT_DASH_STAMINA_COST
            : !grounded
              ? getAirDashCost()
              : DASH_STAMINA_COST) &&
      (!slamming || slamStaminaAtStart >= SLAM_DASH_TOTAL_COST),
    sprinting: isPlaying && sprintIsActive(),
    crouching: crouchHeld,
    slamming,
    sliding,
    wallClimbing,
    enemyHealth: enemy?.health ?? null,
    enemyBehavior: enemy?.behavior ?? null,
  });

  const publishStats = () => {
    const stats = getStats();
    const key = `${stats.health}:${stats.stamina}:${stats.grounded}:${stats.canJump}:${stats.canDash}:${stats.sprinting}:${stats.crouching}:${stats.slamming}:${stats.sliding}:${stats.wallClimbing}:${stats.enemyHealth}:${stats.enemyBehavior}`;
    if (key === lastStatsKey) return;
    lastStatsKey = key;
    onStats?.(stats);
  };

  const setEnemyBehavior = (target: TrainingEnemy) => {
    const behaviors: EnemyBehavior[] = ["melee", "ranged", "flee"];
    target.behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
    target.behaviorTime =
      target.behavior === "melee"
        ? 6.5
        : target.behavior === "ranged"
          ? 4.2
          : 3.1;
    target.attackTime = target.behavior === "melee" ? 0.25 : 0.55;
    target.comboStep = -1;
    target.comboTime = 0;
    const color =
      target.behavior === "melee"
        ? "#ef6156"
        : target.behavior === "ranged"
          ? "#54b6ee"
          : "#e9c75a";
    (target.body.material as THREE.MeshBasicMaterial).color.set(color);
    publishStats();
  };

  const disposeEnemy = (target: TrainingEnemy) => {
    target.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = Array.isArray(object.material)
        ? object.material
        : [object.material];
      material.forEach((entry) => entry.dispose());
    });
  };

  const summonEnemy = () => {
    if (!isPlaying || (enemy && enemy.health > 0)) return;
    if (enemy) {
      scene.remove(enemy.root);
      disposeEnemy(enemy);
    }

    const viewDirection = camera.getWorldDirection(new THREE.Vector3());
    viewDirection.y = 0;
    viewDirection.normalize();
    const sideDirection = new THREE.Vector3(-viewDirection.z, 0, viewDirection.x);
    const candidates = [
      new THREE.Vector3().copy(camera.position).addScaledVector(viewDirection, 8),
      new THREE.Vector3().copy(camera.position).addScaledVector(viewDirection, 6).addScaledVector(sideDirection, 6),
      new THREE.Vector3().copy(camera.position).addScaledVector(viewDirection, 6).addScaledVector(sideDirection, -6),
      new THREE.Vector3(camera.position.x + 8, 0, camera.position.z),
      new THREE.Vector3(camera.position.x - 8, 0, camera.position.z),
      new THREE.Vector3(0, 0, -5),
    ];
    const spawn = candidates.find((candidate) => {
      candidate.x = THREE.MathUtils.clamp(candidate.x, -BOUNDARY_X, BOUNDARY_X);
      candidate.z = THREE.MathUtils.clamp(candidate.z, -BOUNDARY_Z, BOUNDARY_Z);
      return (
        Math.hypot(candidate.x - camera.position.x, candidate.z - camera.position.z) > 3.5 &&
        !isBlocked(roomPhysics, candidate.x, candidate.z, 0.02, ENEMY_RADIUS, ENEMY_HEIGHT)
      );
    }) ?? new THREE.Vector3(0, 0, -5);

    const root = new THREE.Group();
    root.position.set(spawn.x, 0, spawn.z);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 12, 8),
      new THREE.MeshBasicMaterial({ color: "#ef6156", toneMapped: false }),
    );
    body.position.y = 0.66;
    root.add(body);

    const healthBack = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.09, 0.07),
      new THREE.MeshBasicMaterial({ color: "#26313a", toneMapped: false }),
    );
    healthBack.position.set(0, 1.52, 0);
    root.add(healthBack);
    const healthFill = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.06, 0.08),
      new THREE.MeshBasicMaterial({ color: "#f16d62", toneMapped: false }),
    );
    healthFill.position.set(0, 1.52, 0.045);
    root.add(healthFill);
    scene.add(root);

    enemy = {
      root,
      body,
      healthFill,
      health: MAX_HEALTH,
      behavior: "melee",
      behaviorTime: 0,
      attackTime: 0,
      comboStep: -1,
      comboTime: 0,
    };
    setEnemyBehavior(enemy);
    publishStats();
  };

  const applyPlayerDamage = (amount: number) => {
    health = Math.max(0, health - amount);
    publishStats();
  };

  const moveEnemy = (
    targetX: number,
    targetZ: number,
    deltaSeconds: number,
    away: boolean,
    stopDistance = 0,
  ) => {
    if (!enemy) return;
    const dx = targetX - enemy.root.position.x;
    const dz = targetZ - enemy.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return;
    const remaining = Math.max(0, distance - stopDistance);
    if (remaining <= 0) return;
    const sign = away ? -1 : 1;
    const step = Math.min(ENEMY_WALK_SPEED * deltaSeconds, remaining) * sign;
    const moveX = (dx / distance) * step;
    const moveZ = (dz / distance) * step;
    const tryPosition = (x: number, z: number) => {
      const clampedX = THREE.MathUtils.clamp(x, -BOUNDARY_X, BOUNDARY_X);
      const clampedZ = THREE.MathUtils.clamp(z, -BOUNDARY_Z, BOUNDARY_Z);
      if (isBlocked(roomPhysics, clampedX, clampedZ, 0.02, ENEMY_RADIUS, ENEMY_HEIGHT)) {
        return false;
      }
      enemy!.root.position.x = clampedX;
      enemy!.root.position.z = clampedZ;
      return true;
    };
    if (Math.abs(moveX) > Math.abs(moveZ)) {
      if (!tryPosition(enemy.root.position.x + moveX, enemy.root.position.z)) {
        tryPosition(enemy.root.position.x, enemy.root.position.z + moveZ);
      }
    } else if (!tryPosition(enemy.root.position.x, enemy.root.position.z + moveZ)) {
      tryPosition(enemy.root.position.x + moveX, enemy.root.position.z);
    }
  };

  const fireEnemyProjectile = (target: TrainingEnemy) => {
    const spawnPosition = new THREE.Vector3(
      target.root.position.x,
      0.92,
      target.root.position.z,
    );
    const direction = new THREE.Vector3(
      camera.position.x - spawnPosition.x,
      camera.position.y - spawnPosition.y,
      camera.position.z - spawnPosition.z,
    ).normalize();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: "#ff856c", toneMapped: false }),
    );
    mesh.position.copy(spawnPosition);
    scene.add(mesh);
    projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(ENEMY_PROJECTILE_SPEED),
      lifetime: 4,
    });
  };

  const updateEnemy = (deltaSeconds: number) => {
    punchCooldown = Math.max(0, punchCooldown - deltaSeconds);
    if (knockbackTime > 0) {
      const step = Math.min(deltaSeconds, knockbackTime);
      movePlayerBy(knockbackVelocity.x * step, knockbackVelocity.z * step);
      knockbackTime = Math.max(0, knockbackTime - deltaSeconds);
      if (knockbackTime === 0) knockbackVelocity.set(0, 0, 0);
    }

    if (enemy && enemy.health > 0) {
      enemy.behaviorTime -= deltaSeconds;
      enemy.attackTime -= deltaSeconds;
      const dx = camera.position.x - enemy.root.position.x;
      const dz = camera.position.z - enemy.root.position.z;
      const distance = Math.hypot(dx, dz);
      enemy.root.rotation.y = Math.atan2(dx, dz);

      if (enemy.behaviorTime <= 0 && enemy.comboStep < 0) {
        setEnemyBehavior(enemy);
      }

      if (enemy.behavior === "melee") {
        if (enemy.comboStep >= 0) {
          enemy.comboTime -= deltaSeconds;
          if (enemy.comboTime <= 0) {
            if (distance <= ENEMY_MELEE_RANGE + 0.35) {
              applyPlayerDamage(ENEMY_MELEE_DAMAGE);
              if (enemy.comboStep === 3) {
                knockbackVelocity.set(dx, 0, dz).normalize().multiplyScalar(8.5);
                knockbackTime = 0.36;
              }
            }
            enemy.comboStep += 1;
            if (enemy.comboStep >= 4) {
              enemy.comboStep = -1;
              enemy.attackTime = 0.55;
            }
            enemy.comboTime = 0.42;
          }
        } else if (distance > ENEMY_MELEE_RANGE) {
          moveEnemy(
            camera.position.x,
            camera.position.z,
            deltaSeconds,
            false,
            ENEMY_MELEE_RANGE * 0.82,
          );
        } else if (enemy.attackTime <= 0) {
          enemy.comboStep = 0;
          enemy.comboTime = 0;
        }
      } else if (enemy.behavior === "ranged") {
        if (enemy.attackTime <= 0) {
          fireEnemyProjectile(enemy);
          enemy.attackTime = 1.15;
        }
      } else {
        moveEnemy(camera.position.x, camera.position.z, deltaSeconds, true);
      }
    }

    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = projectiles[index];
      projectile.mesh.position.addScaledVector(projectile.velocity, deltaSeconds);
      projectile.lifetime -= deltaSeconds;
      const point = projectile.mesh.position;
      const hitPlayer = point.distanceTo(camera.position) < 0.52;
      const hitWall = isBlocked(
        roomPhysics,
        point.x,
        point.z,
        point.y - 0.12,
        0.12,
        0.24,
      );
      if (hitPlayer) applyPlayerDamage(ENEMY_PROJECTILE_DAMAGE);
      if (hitPlayer || hitWall || projectile.lifetime <= 0) {
        scene.remove(projectile.mesh);
        projectile.mesh.geometry.dispose();
        (projectile.mesh.material as THREE.Material).dispose();
        projectiles.splice(index, 1);
      }
    }
  };

  const punch = () => {
    if (!isPlaying || punchCooldown > 0 || !enemy || enemy.health <= 0) return;
    punchCooldown = 0.32;
    const targetCenter = enemy.root.position.clone().add(new THREE.Vector3(0, 0.66, 0));
    const toTarget = targetCenter.sub(camera.position);
    const distance = toTarget.length();
    if (distance > PLAYER_PUNCH_RANGE) return;
    toTarget.normalize();
    const facing = camera.getWorldDirection(new THREE.Vector3());
    if (facing.dot(toTarget) < 0.35) return;

    enemy.health = Math.max(0, enemy.health - PLAYER_PUNCH_DAMAGE);
    const healthRatio = enemy.health / MAX_HEALTH;
    enemy.healthFill.scale.x = healthRatio;
    enemy.healthFill.position.x = -0.6 + 0.6 * healthRatio;
    if (enemy.health === 0) enemy.root.visible = false;
    publishStats();
  };

  const jump = () => {
    if (!isPlaying) return;
    if (wallClimbing) {
      if (stamina < WALL_JUMP_STAMINA_COST) return;
      stamina = Math.max(0, stamina - WALL_JUMP_STAMINA_COST);
      wallJumping = true;
      verticalVelocity = WALL_JUMP_VELOCITY;
      publishStats();
      return;
    }
    if (slamming) {
      const comboCost = SLAM_JUMP_TOTAL_COST - SLAM_STAMINA_COST;
      if (stamina < comboCost || slamStaminaAtStart < SLAM_JUMP_TOTAL_COST) return;
      stamina = Math.min(
        stamina - comboCost,
        slamStaminaAtStart - SLAM_JUMP_TOTAL_COST,
      );
      slamming = false;
      wallClimbing = false;
      sliding = false;
      grounded = false;
      verticalVelocity = JUMP_VELOCITY * 1.12;
      beginBurst(
        getPlanarDirection(getInput().x, 0, true),
        DASH_DISTANCE,
      );
      publishStats();
      return;
    }
    if (stamina < JUMP_STAMINA_COST) return;
    stamina = Math.max(0, stamina - JUMP_STAMINA_COST);
    if (grounded) {
      camera.position.y = groundY + PLAYER_HEIGHT;
    }
    verticalVelocity = JUMP_VELOCITY;
    grounded = false;
    wallClimbing = false;
    wallJumping = false;
    sliding = false;
    publishStats();
  };

  const startSlam = () => {
    if (!isPlaying || grounded || slamming || stamina < SLAM_STAMINA_COST) return;
    slamStaminaAtStart = stamina;
    stamina = Math.max(0, stamina - SLAM_STAMINA_COST);
    slamming = true;
    sprintRequested = false;
    joystickAutoSprint = false;
    sliding = false;
    wallClimbing = false;
    wallJumping = false;
    verticalVelocity = SLAM_VELOCITY;
    publishStats();
  };

  const toggleCrouching = () => {
    if (!isPlaying) return;
    if (!grounded) {
      startSlam();
      return;
    }
    crouchHeld = !crouchHeld;
    if (!crouchHeld) sliding = false;
    if (grounded) {
      camera.position.y = groundY + (crouchHeld ? CROUCH_HEIGHT : PLAYER_HEIGHT);
    }
    publishStats();
  };

  const dash = (): boolean => {
    if (!isPlaying) return false;
    const input = getInput();

    if (slamming) {
      const extraCost = SLAM_DASH_TOTAL_COST - SLAM_STAMINA_COST;
      if (stamina < extraCost || slamStaminaAtStart < SLAM_DASH_TOTAL_COST) return false;
      stamina = Math.min(
        stamina - extraCost,
        slamStaminaAtStart - SLAM_DASH_TOTAL_COST,
      );
      slamming = false;
      beginBurst(getPlanarDirection(input.x, input.z, true), SLAM_DASH_DISTANCE);
    } else if (sprintIsActive()) {
      if (stamina < SPRINT_DASH_STAMINA_COST) return false;
      stamina = Math.max(0, stamina - SPRINT_DASH_STAMINA_COST);
      const direction = grounded
        ? getPlanarDirection(input.x, input.z)
        : camera.getWorldDirection(forward).normalize();
      beginBurst(direction, SPRINT_DASH_DISTANCE, !grounded);
      sprintRequested = false;
      joystickAutoSprint = false;
      shiftHeld = false;
      doubleTapSprint = false;
    } else if (grounded && crouchHeld) {
      if (stamina <= 0) return false;
      sliding = true;
      dashTimeRemaining = 0;
      dashUsesVerticalAim = false;
    } else {
      const airDash = !grounded;
      const cost = airDash ? AIR_DASH_STAMINA_COST : DASH_STAMINA_COST;
      if (stamina < cost) return false;
      stamina = Math.max(0, stamina - cost);
      if (airDash) {
        camera.getWorldDirection(forward).normalize();
        beginBurst(forward, AIR_DASH_DISTANCE, true);
      } else {
        beginBurst(getPlanarDirection(input.x, input.z), DASH_DISTANCE);
      }
    }

    wallClimbing = false;
    wallSide = null;
    wallJumping = false;
    if (!crouchHeld || !grounded) sliding = false;
    publishStats();
    return true;
  };

  const updateLook = () => {
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  };

  const look = (deltaX: number, deltaY: number) => {
    if (!isPlaying) return;
    yaw -= deltaX * LOOK_SENSITIVITY;
    pitch = THREE.MathUtils.clamp(
      pitch - deltaY * LOOK_SENSITIVITY,
      -MAX_PITCH,
      MAX_PITCH,
    );
    updateLook();
  };

  const onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement === renderer.domElement) {
      look(event.movementX, event.movementY);
    }
  };

  const onCanvasClick = () => {
    if (isPlaying && !isTouchDevice() && document.pointerLockElement !== renderer.domElement) {
      void renderer.domElement.requestPointerLock?.();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) jump();
      return;
    }
    if (key === "shift") {
      if (!event.repeat) {
        shiftHeld = true;
        setSprinting(true);
      }
      return;
    }
    if (key === "c") {
      if (!event.repeat) toggleCrouching();
      return;
    }
    if (key === "q") {
      event.preventDefault();
      if (!event.repeat) dash();
      return;
    }
    if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) {
      event.preventDefault();
      if (!event.repeat) {
        const now = performance.now();
        if (
          previousMovementKey === key &&
          now - previousMovementTapAt < 300
        ) {
          doubleTapSprint = true;
          setSprinting(true);
        }
        previousMovementKey = key;
        previousMovementTapAt = now;
      }
      pressedKeys.add(key);
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    pressedKeys.delete(key);
    if (key === "shift") {
      shiftHeld = false;
      setSprinting(false);
    } else if (
      ["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key) &&
      doubleTapSprint &&
      ![...pressedKeys].some((pressedKey) =>
        ["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(pressedKey),
      )
    ) {
      doubleTapSprint = false;
      setSprinting(shiftHeld);
    }
  };

  const onWindowBlur = () => {
    pressedKeys.clear();
    shiftHeld = false;
    doubleTapSprint = false;
    previousMovementKey = "";
    joystickAutoSprint = false;
    setSprinting(false);
    crouchHeld = false;
    sliding = false;
    wallClimbing = false;
    wallJumping = false;
    wallSide = null;
    if (grounded) camera.position.y = groundY + PLAYER_HEIGHT;
    publishStats();
  };

  const resize = () => {
    const width = Math.max(mount.clientWidth, 1);
    const height = Math.max(mount.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  const animate = (time: number) => {
    frameId = window.requestAnimationFrame(animate);
    const deltaSeconds = previousTime === 0 ? 0 : Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;

    if (isPlaying && deltaSeconds > 0) {
      const input = getInput();
      let isSprinting = sprintIsActive();

      if (stamina <= 0) {
        sprintRequested = false;
        joystickAutoSprint = false;
        shiftHeld = false;
        doubleTapSprint = false;
        isSprinting = false;
      }

      if (wallClimbing) {
        let alongWall = 0;
        if (wallSide && input.length > 0) {
          const movementDirection = getPlanarDirection(input.x, input.z);
          alongWall =
            wallSide === "west" || wallSide === "east"
              ? movementDirection.z
              : movementDirection.x;
        }
        const drainRate =
          Math.abs(alongWall) > 0.08
            ? WALL_WALK_STAMINA_DRAIN
            : WALL_HOLD_STAMINA_DRAIN;
        stamina = Math.max(0, stamina - drainRate * deltaSeconds);
        if (stamina === 0 || isSprinting || dashTimeRemaining > 0) {
          wallClimbing = false;
          wallSide = null;
        } else if (Math.abs(alongWall) > 0.08 && wallSide) {
          if (wallSide === "west" || wallSide === "east") {
            movePlayerBy(
              0,
              Math.sign(alongWall) * WALK_SPEED * input.length * deltaSeconds,
            );
          } else {
            movePlayerBy(
              Math.sign(alongWall) * WALK_SPEED * input.length * deltaSeconds,
              0,
            );
          }
          if (wallJumping) {
            verticalVelocity -= GRAVITY * deltaSeconds;
            camera.position.y = Math.min(
              ROOM_HEIGHT - 0.24,
              camera.position.y + verticalVelocity * deltaSeconds,
            );
            if (
              verticalVelocity <= 0 ||
              camera.position.y >= ROOM_HEIGHT - 0.24
            ) {
              verticalVelocity = 0;
              wallJumping = false;
            }
          }
        } else if (wallJumping) {
          verticalVelocity -= GRAVITY * deltaSeconds;
          camera.position.y = Math.min(
            ROOM_HEIGHT - 0.24,
            camera.position.y + verticalVelocity * deltaSeconds,
          );
          if (
            verticalVelocity <= 0 ||
            camera.position.y >= ROOM_HEIGHT - 0.24
          ) {
            verticalVelocity = 0;
            wallJumping = false;
          }
        }
      } else {
        if (
          sliding &&
          (!crouchHeld || !grounded || input.length < 0.08 || stamina <= 0)
        ) {
          sliding = false;
        }
        if (sliding) {
          stamina = Math.max(0, stamina - SLIDE_STAMINA_DRAIN * deltaSeconds);
        } else if (isSprinting) {
          stamina = Math.max(0, stamina - SPRINT_STAMINA_DRAIN * deltaSeconds);
        } else {
          stamina = Math.min(
            MAX_STAMINA,
            stamina + STAMINA_REGENERATION * deltaSeconds,
          );
        }

        if (stamina <= 0) {
          sprintRequested = false;
          joystickAutoSprint = false;
          shiftHeld = false;
          doubleTapSprint = false;
          sliding = false;
          isSprinting = false;
        } else {
          isSprinting = sprintIsActive();
        }

        if (input.length > 0 && !slamming) {
          getPlanarDirection(input.x, input.z);
          const speed = sliding
            ? SLIDE_SPEED
            : isSprinting
              ? SPRINT_SPEED
              : crouchHeld
                ? CROUCH_SPEED
                : WALK_SPEED;
          travel.multiplyScalar(speed * input.length * deltaSeconds);
          movePlayerBy(travel.x, travel.z);
        }

        let hitDashWall = false;
        if (dashTimeRemaining > 0) {
          const burstStep = Math.min(deltaSeconds, dashTimeRemaining);
          hitDashWall = movePlayerBy(
            dashVelocity.x * burstStep,
            dashVelocity.z * burstStep,
          );
          if (dashUsesVerticalAim) {
            camera.position.y = Math.min(
              ROOM_HEIGHT - 0.24,
              camera.position.y + dashVelocity.y * burstStep,
            );
            grounded = false;
          }

          const contactWall = findWallSide();
          const pushesIntoWall =
            (contactWall === "west" && dashVelocity.x < 0) ||
            (contactWall === "east" && dashVelocity.x > 0) ||
            (contactWall === "north" && dashVelocity.z < 0) ||
            (contactWall === "south" && dashVelocity.z > 0);
          if (hitDashWall && contactWall && pushesIntoWall) {
            wallClimbing = true;
            wallSide = contactWall;
            wallJumping = false;
            grounded = false;
            verticalVelocity = 0;
            dashTimeRemaining = 0;
            dashUsesVerticalAim = false;
          } else {
            dashTimeRemaining = Math.max(0, dashTimeRemaining - deltaSeconds);
            if (dashTimeRemaining === 0) dashUsesVerticalAim = false;
          }
        }

        if (!wallClimbing && grounded) {
          const targetGround = getWalkableHeight(
            roomPhysics,
            camera.position.x,
            camera.position.z,
            groundY,
          );
          if (targetGround < groundY - MAX_STEP_HEIGHT) {
            grounded = false;
            verticalVelocity = 0;
          } else {
            groundY = targetGround;
            camera.position.y =
              groundY + (crouchHeld ? CROUCH_HEIGHT : PLAYER_HEIGHT);
          }
        }

        if (!wallClimbing && !grounded) {
          const previousFeet = camera.position.y - PLAYER_HEIGHT;
          verticalVelocity -=
            GRAVITY * (slamming ? 2.1 : 1) * deltaSeconds;
          camera.position.y += verticalVelocity * deltaSeconds;
          camera.position.y = Math.min(
            camera.position.y,
            ROOM_HEIGHT - 0.24,
          );
          const currentFeet = camera.position.y - PLAYER_HEIGHT;
          const landingHeight = getHighestSurface(
            roomPhysics,
            camera.position.x,
            camera.position.z,
          );
          if (
            verticalVelocity <= 0 &&
            previousFeet >= landingHeight - 0.06 &&
            currentFeet <= landingHeight
          ) {
            groundY = landingHeight;
            camera.position.y =
              groundY + (crouchHeld ? CROUCH_HEIGHT : PLAYER_HEIGHT);
            verticalVelocity = 0;
            grounded = true;
            slamming = false;
            wallJumping = false;
          }
        }
      }

      const contactWall = findWallSide();
      if (wallClimbing && (!contactWall || sprintIsActive())) {
        wallClimbing = false;
        wallJumping = false;
        wallSide = null;
      }

      statsElapsed += deltaSeconds;
      if (statsElapsed >= 0.1) {
        statsElapsed = 0;
        publishStats();
      }
    }

    renderer.render(scene, camera);
  };

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("mousemove", onMouseMove);
  renderer.domElement.addEventListener("click", onCanvasClick);
  frameId = window.requestAnimationFrame(animate);
  publishStats();

  return {
    start() {
      isPlaying = true;
      scene.background = new THREE.Color("#9fa3a5");
      publishStats();
      if (!isTouchDevice()) {
        void renderer.domElement.requestPointerLock?.();
      }
    },
    move(x, z, autoSprint = false) {
      touchX = THREE.MathUtils.clamp(x, -1, 1);
      touchZ = THREE.MathUtils.clamp(z, -1, 1);
      joystickAutoSprint = autoSprint && isPlaying && stamina > 0;
      publishStats();
    },
    look,
    setSprinting,
    toggleCrouching,
    jump,
    dash,
    dispose() {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("click", onCanvasClick);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            const map = "map" in material ? material.map : null;
            map?.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function isTouchDevice(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    window.innerWidth <= 700
  );
}

function buildRoom(scene: THREE.Scene, physics: RoomPhysics): void {
  // Keep soft ambient light in the scene, while MeshBasicMaterial keeps every
  // surface deliberately flat and unaffected by highlights or shadow gradients.
  scene.add(new THREE.AmbientLight("#ffffff", 0.8));
  scene.add(new THREE.HemisphereLight("#ffffff", "#d0d0d0", 0.55));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    flatMaterial("#85898c", THREE.DoubleSide),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.025;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    flatMaterial("#a0a3a5", THREE.DoubleSide),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  scene.add(ceiling);

  const rearWall = flatMaterial("#656a6e");
  const sideWall = flatMaterial("#74797d");
  const frontWall = flatMaterial("#5c6266");
  addBox(
    scene,
    [ROOM_WIDTH, ROOM_HEIGHT, WALL_THICKNESS],
    [0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2],
    rearWall,
  );
  addBox(
    scene,
    [ROOM_WIDTH, ROOM_HEIGHT, WALL_THICKNESS],
    [0, ROOM_HEIGHT / 2, ROOM_DEPTH / 2],
    frontWall,
  );
  addBox(
    scene,
    [WALL_THICKNESS, ROOM_HEIGHT, ROOM_DEPTH],
    [-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0],
    sideWall,
  );
  addBox(
    scene,
    [WALL_THICKNESS, ROOM_HEIGHT, ROOM_DEPTH],
    [ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0],
    sideWall,
  );

  // Tall perimeter columns leave a broad, unobstructed sprinting lane.
  for (const x of [-18.4, 18.4]) {
    for (const z of [-12.4, 12.4]) {
      addSolidBox(
        scene,
        physics,
        [1.6, 9, 1.6],
        [x, 4.5, z],
        "#555a5e",
      );
    }
  }

  // Raised platforms with matching block ramps. The center remains open.
  addSolidBox(
    scene,
    physics,
    [8, 2.5, 8],
    [-12, 1.25, -8],
    "#6c7175",
  );
  addRamp(
    scene,
    physics,
    { width: 4.2, length: 5, x: -12, centerZ: -1.5, centerY: 1.25, angle: Math.atan(2.5 / 5) },
    { minZ: -4, maxZ: 1, heightAtMinZ: 2.5, heightAtMaxZ: 0 },
    "#777c80",
  );

  addSolidBox(
    scene,
    physics,
    [8, 1.8, 8],
    [12, 0.9, 7],
    "#707579",
  );
  addRamp(
    scene,
    physics,
    { width: 4.2, length: 4, x: 12, centerZ: 5, centerY: 0.9, angle: Math.atan(1.8 / 4) },
    { minZ: 3, maxZ: 7, heightAtMinZ: 1.8, heightAtMaxZ: 0 },
    "#808589",
  );

  // Low cover and stepping blocks sit around the perimeter, not in the middle.
  addSolidBox(scene, physics, [2.6, 1.2, 2.2], [-6, 0.6, -12.4], "#707579");
  addSolidBox(scene, physics, [2.6, 1.2, 2.2], [6, 0.6, -12.4], "#777c80");
  addSolidBox(scene, physics, [2.8, 1.5, 2.8], [-18, 0.75, 1], "#686d71");
  addSolidBox(scene, physics, [2.8, 1.5, 2.8], [18, 0.75, -1], "#686d71");
  addSolidBox(scene, physics, [4, 1.3, 2.6], [0, 0.65, -13.5], "#777c80");
}

function flatMaterial(
  color: string,
  side: THREE.Side = THREE.FrontSide,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, side, toneMapped: false });
}

function addBox(
  scene: THREE.Scene,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  scene.add(mesh);
}

function addSolidBox(
  scene: THREE.Scene,
  physics: RoomPhysics,
  size: [number, number, number],
  position: [number, number, number],
  color: string,
): void {
  addBox(scene, size, position, flatMaterial(color));
  physics.solids.push({
    minX: position[0] - size[0] / 2,
    maxX: position[0] + size[0] / 2,
    minY: position[1] - size[1] / 2,
    maxY: position[1] + size[1] / 2,
    minZ: position[2] - size[2] / 2,
    maxZ: position[2] + size[2] / 2,
  });
  physics.surfaces.push({
    minX: position[0] - size[0] / 2,
    maxX: position[0] + size[0] / 2,
    minZ: position[2] - size[2] / 2,
    maxZ: position[2] + size[2] / 2,
    height: position[1] + size[1] / 2,
  });
}

function addRamp(
  scene: THREE.Scene,
  physics: RoomPhysics,
  geometry: {
    width: number;
    length: number;
    x: number;
    centerZ: number;
    centerY: number;
    angle: number;
  },
  surface: {
    minZ: number;
    maxZ: number;
    heightAtMinZ: number;
    heightAtMaxZ: number;
  },
  color: string,
): void {
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(geometry.width, 0.18, geometry.length),
    flatMaterial(color),
  );
  ramp.position.set(geometry.x, geometry.centerY, geometry.centerZ);
  ramp.rotation.x = geometry.angle;
  scene.add(ramp);
  physics.ramps.push({
    minX: geometry.x - geometry.width / 2,
    maxX: geometry.x + geometry.width / 2,
    minZ: surface.minZ,
    maxZ: surface.maxZ,
    lowZ: surface.minZ,
    highZ: surface.maxZ,
    lowHeight: surface.heightAtMinZ,
    highHeight: surface.heightAtMaxZ,
  });
}

function getWalkableHeight(
  physics: RoomPhysics,
  x: number,
  z: number,
  currentHeight: number,
): number {
  let height = 0;
  for (const surface of physics.surfaces) {
    if (
      x >= surface.minX &&
      x <= surface.maxX &&
      z >= surface.minZ &&
      z <= surface.maxZ &&
      surface.height <= currentHeight + MAX_STEP_HEIGHT
    ) {
      height = Math.max(height, surface.height);
    }
  }
  for (const ramp of physics.ramps) {
    if (
      x < ramp.minX ||
      x > ramp.maxX ||
      z < ramp.minZ ||
      z > ramp.maxZ
    ) {
      continue;
    }
    const progress = (z - ramp.lowZ) / (ramp.highZ - ramp.lowZ);
    const rampHeight =
      ramp.lowHeight + (ramp.highHeight - ramp.lowHeight) * progress;
    if (rampHeight <= currentHeight + MAX_STEP_HEIGHT) {
      height = Math.max(height, rampHeight);
    }
  }
  return height;
}

function getHighestSurface(physics: RoomPhysics, x: number, z: number): number {
  let height = 0;
  for (const surface of physics.surfaces) {
    if (
      x >= surface.minX &&
      x <= surface.maxX &&
      z >= surface.minZ &&
      z <= surface.maxZ
    ) {
      height = Math.max(height, surface.height);
    }
  }
  for (const ramp of physics.ramps) {
    if (
      x >= ramp.minX &&
      x <= ramp.maxX &&
      z >= ramp.minZ &&
      z <= ramp.maxZ
    ) {
      const progress = (z - ramp.lowZ) / (ramp.highZ - ramp.lowZ);
      const rampHeight =
        ramp.lowHeight + (ramp.highHeight - ramp.lowHeight) * progress;
      height = Math.max(height, rampHeight);
    }
  }
  return height;
}

function isBlocked(
  physics: RoomPhysics,
  x: number,
  z: number,
  feetY: number,
): boolean {
  return physics.solids.some(
    (box) =>
      x + PLAYER_RADIUS > box.minX &&
      x - PLAYER_RADIUS < box.maxX &&
      z + PLAYER_RADIUS > box.minZ &&
      z - PLAYER_RADIUS < box.maxZ &&
      feetY < box.maxY - 0.06 &&
      feetY + PLAYER_HEIGHT > box.minY + 0.04,
  );
}
