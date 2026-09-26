export const MAX_PLAYERS = 4;
/** Split-screen players on one machine (online: per house). Same as MAX_PLAYERS. */
export const MAX_LOCAL_PLAYERS = 4;
/** Humans in one online room (NETWORKING.md §10.3); CPUs fill to RACERS_PER_RACE. */
export const MAX_HUMANS = 8;
export const RACERS_PER_RACE = 8; // humans + CPU fill
export const DEFAULT_LAPS = 3;

/** Speed classes — kid-friendly names. Values are tuned by the race module. */
export const SPEED_CLASSES = {
  cozy: { id: 'cozy', name: 'Cozy', emoji: '🐢', maxSpeed: 26, accel: 16, aiSkill: 0.55 },
  zippy: { id: 'zippy', name: 'Zippy', emoji: '🐇', maxSpeed: 33, accel: 20, aiSkill: 0.75 },
  zoomy: { id: 'zoomy', name: 'Zoomy', emoji: '🚀', maxSpeed: 40, accel: 24, aiSkill: 0.92 },
};

export const UNLOCK_CHARACTER_ID = 'cotton-candy-girl';

/** Player colours used by menus, HUD and minimap dots (8: one per human in an online room). */
export const PLAYER_COLORS = ['#ff5fb4', '#4fa8ff', '#4fd67a', '#ffc933', '#b48cff', '#ff8a65', '#3fd0d4', '#e0629a'];
