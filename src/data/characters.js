/**
 * Sprinkle Kart roster — 8 racers plus the secret unlockable Cotton Candy Girl.
 *
 * Every character is an ORIGINAL creation. Stats are on a 1..5 scale and only
 * nudge handling a little, so any kid can win with any favourite.
 *
 * CharacterDef (see ARCHITECTURE.md), plus a few optional extras that menus,
 * HUD and results screens may use:
 *   emoji        — a tiny icon for cards / minimap legends
 *   quotes       — { select, win, oops } short friendly speech-bubble lines
 *   unlockHint   — (locked characters only) how to earn them
 */
import { UNLOCK_CHARACTER_ID } from '../config.js';

/** @typedef {{primary:number, secondary:number, accent:number, kart:number}} CharacterColors */
/** @typedef {{speed:number, accel:number, handling:number, weight:number}} CharacterStats */
/**
 * @typedef {Object} CharacterDef
 * @property {string} id
 * @property {string} name
 * @property {string} tagline
 * @property {string} personality
 * @property {CharacterColors} colors
 * @property {CharacterStats} stats
 * @property {{pitch:number, style:'giggle'|'hoho'|'yay'|'boing'|'hum'}} voice
 * @property {boolean} locked
 * @property {string} emoji
 * @property {{select:string, win:string, oops:string}} quotes
 * @property {string} [unlockHint]
 * @property {{height?:number, lookHeight?:number}} [camera] optional chase-camera nudge (metres) for tall hats/hair
 */

/** @type {CharacterDef[]} */
export const CHARACTERS = [
  {
    id: 'rocco',
    name: 'Rocco Ravioli',
    tagline: 'Extra cheese, extra speed!',
    personality:
      'A jolly, round pasta chef in a checkered apron whose curly spaghetti mustache wiggles whenever he laughs — which is always.',
    colors: { primary: 0xe8413c, secondary: 0xfff3dc, accent: 0x5cc85a, kart: 0xe8413c },
    camera: { height: 0.3, lookHeight: -0.15 }, // puffy chef hat: keep the road ahead in view
    stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    voice: { pitch: 0.8, style: 'hoho' },
    locked: false,
    emoji: '🍝',
    quotes: {
      select: 'Ho ho! Time to cook up some speed!',
      win: 'Bellissimo! Pasta party for everyone!',
      oops: 'Oopsie-meatball!',
    },
  },
  {
    id: 'lenny',
    name: 'Lenny Linguine',
    tagline: "I'm not scared... okay, maybe a LITTLE scared!",
    personality:
      "Rocco's tall, noodly little brother with a cosy noodle scarf — his knees wobble like spaghetti, but he's braver than he thinks.",
    colors: { primary: 0x2ec4b6, secondary: 0xa8e86a, accent: 0xffe066, kart: 0x2ec4b6 },
    camera: { height: 0.6, lookHeight: -0.1 }, // extra-tall noodle neck + hat
    stats: { speed: 4, accel: 3, handling: 3, weight: 2 },
    voice: { pitch: 1.05, style: 'boing' },
    locked: false,
    emoji: '🍜',
    quotes: {
      select: 'M-m-me? Okay! I can do this!',
      win: 'I did it?! I DID IT! Wheee!',
      oops: 'Wibbly wobbly!',
    },
  },
  {
    id: 'stella',
    name: 'Stella Starbloom',
    tagline: 'Wishing on every star... especially the finish line.',
    personality:
      'A calm, dreamy space princess who hums lullabies to the planets, with her tiny star buddy Twinkle always close by.',
    colors: { primary: 0x2fc4c0, secondary: 0xeae6ff, accent: 0xffe45c, kart: 0x2fc4c0 },
    stats: { speed: 4, accel: 2, handling: 3, weight: 3 },
    voice: { pitch: 1.15, style: 'hum' },
    locked: false,
    emoji: '⭐',
    quotes: {
      select: 'Twinkle and I are ready to shine.',
      win: 'The stars are twinkling just for you!',
      oops: 'Oh my stars!',
    },
  },
  {
    id: 'peachy',
    name: 'Princess Peachy Pie',
    tagline: 'Sweet as pie, fast as a sneeze!',
    personality:
      'The kind and bubbly princess of the Cotton Candy Castle, who wears a real (still warm!) peach pie as her crown.',
    colors: { primary: 0xff8fc8, secondary: 0xffc94d, accent: 0xffa860, kart: 0xff8fc8 },
    stats: { speed: 3, accel: 4, handling: 4, weight: 1 },
    voice: { pitch: 1.5, style: 'giggle' },
    locked: false,
    emoji: '👑',
    quotes: {
      select: 'Tee-hee! Let the sweetest racer win!',
      win: 'Pie for everyone! Tee-hee!',
      oops: 'Oh, crumbs!',
    },
  },
  {
    id: 'gumbo',
    name: 'Gumbo Gummybear',
    tagline: 'GRRR! ...Can I have a hug after the race?',
    personality:
      'A big, grumpy-looking gummy bear with candy-corn horns who secretly just wants everyone to be his friend.',
    colors: { primary: 0xff8a3d, secondary: 0x4ccf6a, accent: 0xffd23a, kart: 0xf2663a },
    stats: { speed: 4, accel: 1, handling: 2, weight: 5 },
    voice: { pitch: 0.55, style: 'hoho' },
    locked: false,
    emoji: '🐻',
    quotes: {
      select: 'GRRR! (That means hello!)',
      win: 'GRRR-EAT! Group hug!',
      oops: 'Grr... I mean, oopsie!',
    },
  },
  {
    id: 'muffin',
    name: 'Muffin Button',
    tagline: 'Tiny cupcake, GIANT zoomies!',
    personality:
      'An excitable little cupcake kid with a cherry on top who squeaks "yay!" at absolutely everything.',
    colors: { primary: 0x8fd3ff, secondary: 0xff9ecf, accent: 0xe8233f, kart: 0x8fd3ff },
    stats: { speed: 2, accel: 5, handling: 4, weight: 1 },
    voice: { pitch: 1.9, style: 'yay' },
    locked: false,
    emoji: '🧁',
    quotes: {
      select: 'Yay yay YAY! Pick me!',
      win: 'YAAAY! Best day EVER!',
      oops: 'Eep! Sprinkles everywhere!',
    },
  },
  {
    id: 'dino',
    name: 'Doodle Dino',
    tagline: 'Is the finish line edible? Asking for me.',
    personality:
      'A goofy lavender dinosaur with mint spots and a sprinkle-donut saddle who is always, always, ALWAYS hungry.',
    colors: { primary: 0xb79cff, secondary: 0xff9ecf, accent: 0x7fe6c4, kart: 0xfff6e6 },
    stats: { speed: 3, accel: 4, handling: 3, weight: 2 },
    voice: { pitch: 1.3, style: 'yay' },
    locked: false,
    emoji: '🦖',
    quotes: {
      select: 'Rawr! Is there a snack stop?',
      win: 'Winner winner, cookie dinner!',
      oops: 'Munch... oops!',
    },
  },
  {
    id: 'bizzy',
    name: 'Bizzy Bumble',
    tagline: 'Un-BEE-lievably fast! Buzz buzz!',
    personality:
      'A silly bumblebee pilot who talks almost entirely in puns and buzzes her tiny wings when she gets excited.',
    colors: { primary: 0xffd23f, secondary: 0x2b2233, accent: 0xff9ecf, kart: 0xffd23f },
    stats: { speed: 2, accel: 4, handling: 5, weight: 1 },
    voice: { pitch: 1.6, style: 'hum' },
    locked: false,
    emoji: '🐝',
    quotes: {
      select: "Let's bee-gin! Buzz buzz!",
      win: "I'm the bee's knees!",
      oops: 'Oh, honey!',
    },
  },
  {
    id: UNLOCK_CHARACTER_ID,
    name: 'Cotton Candy Girl',
    tagline: 'Sweet, fluffy, and totally un-stop-a-FLUFF-able!',
    personality:
      'A sparkly superhero with a giant pink-and-blue cotton candy cloud for hair, who zooms along on her very own fluffy cloud kart.',
    colors: { primary: 0xff9ed8, secondary: 0x9fd8ff, accent: 0xc9a6ff, kart: 0xffffff },
    camera: { height: 0.6, lookHeight: -0.2 }, // big cloud hair: keep the road ahead in view
    stats: { speed: 4, accel: 4, handling: 3, weight: 2 },
    voice: { pitch: 1.7, style: 'giggle' },
    locked: true,
    emoji: '🍭',
    quotes: {
      select: 'Fluffy power, ACTIVATE!',
      win: 'Sweet dreams are made of wins!',
      oops: 'Poof! Just a little fluff!',
    },
    unlockHint: 'Win a race to unlock!',
  },
];

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

/**
 * Look up a character by id.
 * @param {string} id
 * @returns {CharacterDef|null} null for unknown ids
 */
export function getCharacter(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * Characters a player may pick right now. Locked characters are hidden unless
 * `isUnlockedFn(id)` says they have been earned. Without a function, every
 * locked character stays hidden.
 * @param {(id:string)=>boolean} [isUnlockedFn]
 * @returns {CharacterDef[]}
 */
export function getSelectableCharacters(isUnlockedFn) {
  return CHARACTERS.filter((c) => {
    if (!c.locked) return true;
    try {
      return typeof isUnlockedFn === 'function' && !!isUnlockedFn(c.id);
    } catch {
      return false;
    }
  });
}

/** Convert a 0xRRGGBB number to a CSS '#rrggbb' string (handy for UI). */
export function toCss(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
}
