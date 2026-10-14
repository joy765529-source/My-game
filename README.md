# Practice Room

A small first-person Three.js browser game designed to be easy to explore and edit.

## Controls

- **Desktop:** click “Enter the room,” move with W/A/S/D, hold Shift or double-tap a movement key to sprint, and press Space repeatedly to jump again in the air. Press Q to dash and tap C to crouch (or slam while airborne). Mouse movement looks around; swiping right turns right. Dash into an outer wall to cling automatically. Press Escape to release mouse capture; click the room to capture it again.
- **Android touchscreens:** drag the left joystick to move, push it beyond its ring to auto-sprint, and drag the right side to look. Tap the four controls: Sprint toggles, Jump can be tapped repeatedly, Crouch toggles or slams in the air, and Dash fires once per tap. Tap Dash while crouched and moving to slide.

The HUD starts at 100 HP and 100 stamina. Every jump, including repeated air jumps, costs 10 stamina. Sprinting triples walking speed and drains 10 stamina per second; stamina regenerates when not sprinting. A ground dash costs 15 and follows the movement direction; an air dash costs 30 and follows the camera direction. Sprint plus Dash launches farther and costs 50 total. Crouching slows walking; tapping Dash while crouched starts a slide at 1.5 times walking speed for 2 stamina per second. Crouching in the air slams for 5 stamina. The existing slam-jump and slam-dash remain combined moves costing 20 and 7 total. Wall cling costs 1 stamina per second, sideways wall movement costs 2 per second, and a wall jump costs 3 without breaking the cling. Sprinting and dashing break the cling. Health is displayed for future combat; this practice room does not have damage yet.

The room is a larger, low-poly training space with flat grey, unlit materials, a clear central lane, solid walls, pillars, ramps, platforms, and simple movement collision.

## Where to learn from the code

- `src/App.tsx` connects the React interface to the game engine.
- `src/components/GameShell.tsx` contains the start screen, HUD, instructions, and touch controls.
- `src/game/FirstPersonGame.ts` creates the Three.js scene, camera, renderer, room geometry, collision, movement abilities, stamina, and jump physics.

## Useful first edits

Open `src/game/FirstPersonGame.ts` and try changing:

- `ROOM_WIDTH`, `ROOM_DEPTH`, and `ROOM_HEIGHT` to resize the room.
- `WALK_SPEED` and `SPRINT_SPEED` to change movement speed.
- `SPRINT_STAMINA_DRAIN`, `STAMINA_REGENERATION`, and the jump, dash, slam, and wall cost constants to tune stamina.
- `JUMP_VELOCITY` and `GRAVITY` to tune jump height and fall speed.
- `LOOK_SENSITIVITY` to adjust mouse and touch look speed.
- The color values in `buildRoom()` to change the floor, walls, and practice objects.

Three.js uses a **scene** as the world, a **camera** as the player's view, and a **renderer** to draw that view into the page. Objects are meshes: a geometry gives each object its shape, and a solid `MeshBasicMaterial` gives it a flat color without lighting gradients.

The room is built from boxes and ramps. `addBox()` is a small helper for placing another box; the three values in its `size` and `position` arrays are width/height/depth and x/y/z. The box and ramp helpers also register simple collision and walkable surfaces.
