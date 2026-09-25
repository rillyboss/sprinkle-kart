/**
 * Sprinkle Kart v2 content lineup — the BINDING ids, names, homes and unlock
 * rules for every track, cup and racer (existing and planned).
 *
 * Every registry entry (src/tracks/*.js, src/characters/*.js) must use the id,
 * name, cup/pack and `unlock` rule listed here; tests/lineup.test.js checks
 * that. Code that needs to talk about content that is not built yet (unlock
 * hints, the progression engine, menus) reads names from here, so nothing
 * breaks while a track or racer is still being made.
 *
 * Unlock rules are plain data — see src/progress/schema.js (UnlockRule) and
 * ARCHITECTURE.md. `null` = available from the start.
 */

/** @typedef {import('../progress/schema.js').UnlockRule} UnlockRule */

const stat = (s, count) => ({ type: 'stat', stat: s, count });
const onTrack = (trackId, result) => ({ type: 'track', trackId, result });
const onCupTrack = (cupId, result) => ({ type: 'cup-track', cupId, result });
const distinct = (result, count) => ({ type: 'distinct-tracks', result, count });

/** Grand Prix cups, in menu order. Each cup is 4 races. */
export const LINEUP_CUPS = [
  { id: 'sprinkle-cup', name: 'Sprinkle Cup', emoji: '🍭', trackIds: ['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes'] },
  { id: 'bubble-cup', name: 'Bubble Cup', emoji: '🫧', trackIds: ['bubblegum-bay', 'mermaid-lagoon', 'teddy-toyland', 'honeycomb-hive'] },
  { id: 'cozy-cup', name: 'Cozy Cup', emoji: '☕', trackIds: ['pumpkin-patch', 'teacup-garden', 'peppermint-village', 'pillow-fort'] },
  { id: 'adventure-cup', name: 'Adventure Cup', emoji: '🌋', trackIds: ['jellybean-jungle', 'cocoa-canyon', 'lemonade-volcano', 'donut-downtown'] },
  { id: 'superstar-cup', name: 'Superstar Cup', emoji: '🌟', trackIds: ['cupcake-carnival', 'aurora-palace', 'moonbounce-base', 'ribbon-sky'] },
];

/** Every track: id, display name, cup, theme brief, unlock rule, owning pack file. */
export const LINEUP_TRACKS = [
  // Sprinkle Cup (original, always unlocked) — src/tracks/pack-original.js
  { id: 'cotton-candy-castle', name: 'Cotton Candy Castle', cup: 'sprinkle-cup', unlock: null, theme: "Princess Peachy Pie's pink candy palace" },
  { id: 'gumdrop-meadow', name: 'Gumdrop Meadow', cup: 'sprinkle-cup', unlock: null, theme: 'Rolling hills of gumdrops and lollipops' },
  { id: 'starlight-galaxy', name: 'Starlight Galaxy', cup: 'sprinkle-cup', unlock: null, theme: "Stella's glowing star road among the planets" },
  { id: 'sundae-slopes', name: 'Sundae Slopes', cup: 'sprinkle-cup', unlock: null, theme: 'Ice-cream mountains and chocolate rivers' },
  // Bubble Cup — src/tracks/pack-bubble.js
  { id: 'bubblegum-bay', name: 'Bubblegum Bay', cup: 'bubble-cup', unlock: stat('racesFinished', 1), theme: 'Pink-sea beach, giant gum bubbles, sandcastles, surfboards' },
  { id: 'mermaid-lagoon', name: 'Mermaid Lagoon', cup: 'bubble-cup', unlock: stat('wins', 1), theme: 'Road along a sparkly lagoon floor/shore: coral, shells, a glass bubble tunnel' },
  { id: 'teddy-toyland', name: 'Teddy Toyland', cup: 'bubble-cup', unlock: stat('racesFinished', 3), theme: 'Inside a giant toy room: blocks, toy trains, teddy bears, crayon ramps' },
  { id: 'honeycomb-hive', name: 'Honeycomb Hive', cup: 'bubble-cup', unlock: stat('itemsUsed', 10), theme: "Bizzy's home: hexagon honey road, honey drips, flowers, friendly bees" },
  // Cozy Cup — src/tracks/pack-cozy.js
  { id: 'pumpkin-patch', name: 'Pumpkin Pie Patch', cup: 'cozy-cup', unlock: distinct('top3', 2), theme: 'Cozy harvest farm: smiling pumpkins, hay bales, pie windmills (friendly, NOT spooky)' },
  { id: 'teacup-garden', name: 'Teacup Garden', cup: 'cozy-cup', unlock: stat('wins', 2), theme: 'Whimsical tea-party garden: giant teacups, teapots, macarons, hedge maze' },
  { id: 'peppermint-village', name: 'Peppermint Village', cup: 'cozy-cup', unlock: stat('miniTurbos', 15), theme: 'Snowy candy-cane village, gingerbread houses, twinkly lights' },
  { id: 'pillow-fort', name: 'Pillow Fort Dreamland', cup: 'cozy-cup', unlock: stat('racesFinished', 6), theme: 'Bedroom at night: pillow forts, blanket hills, night-lights, counting sheep' },
  // Adventure Cup — src/tracks/pack-adventure.js
  { id: 'jellybean-jungle', name: 'Jellybean Jungle', cup: 'adventure-cup', unlock: onCupTrack('bubble-cup', 'win'), theme: 'Jungle of jellybean trees, vine bridges, gummy frogs' },
  { id: 'cocoa-canyon', name: 'Cocoa Canyon', cup: 'adventure-cup', unlock: stat('timeTrialsFinished', 1), theme: 'Desert canyon of chocolate rock, cocoa waterfalls, marshmallow cacti' },
  { id: 'lemonade-volcano', name: 'Lemonade Volcano', cup: 'adventure-cup', unlock: stat('wins', 4), theme: 'Fizzy lemonade (friendly yellow, bubbly) volcano island' },
  { id: 'donut-downtown', name: 'Donut Downtown', cup: 'adventure-cup', unlock: stat('multiplayerRaces', 3), theme: 'Twinkly night city of bakeries, donut signs, neon sprinkles' },
  // Superstar Cup — src/tracks/pack-superstar.js
  { id: 'cupcake-carnival', name: 'Cupcake Carnival', cup: 'superstar-cup', unlock: stat('cupsWon', 1), theme: 'Funfair: ferris wheel, carousel, balloons, bunting' },
  { id: 'aurora-palace', name: 'Aurora Ice Palace', cup: 'superstar-cup', unlock: onCupTrack('cozy-cup', 'win'), theme: 'Crystal ice palace under northern lights' },
  { id: 'moonbounce-base', name: 'Moonbounce Base', cup: 'superstar-cup', unlock: stat('wins', 8), theme: 'Bouncy moon base, craters, low-gravity hops' },
  { id: 'ribbon-sky', name: 'Ribbon Sky Rally', cup: 'superstar-cup', unlock: distinct('win', 6), theme: 'Grand finale: rainbow ribbon road looping over clouds and hot-air balloons' },
];

/** Every racer: id, display name, pack, concept, unlock rule. */
export const LINEUP_CHARACTERS = [
  // Original pack — src/characters/pack-original.js
  { id: 'rocco', name: 'Rocco Ravioli', pack: 'original', unlock: null },
  { id: 'lenny', name: 'Lenny Linguine', pack: 'original', unlock: null },
  { id: 'stella', name: 'Stella Starbloom', pack: 'original', unlock: null },
  { id: 'peachy', name: 'Princess Peachy Pie', pack: 'original', unlock: null },
  { id: 'gumbo', name: 'Gumbo Gummybear', pack: 'original', unlock: null },
  { id: 'muffin', name: 'Muffin Button', pack: 'original', unlock: null },
  { id: 'dino', name: 'Doodle Dino', pack: 'original', unlock: null },
  { id: 'bizzy', name: 'Bizzy Bumble', pack: 'original', unlock: null },
  { id: 'cotton-candy-girl', name: 'Cotton Candy Girl', pack: 'original', unlock: stat('wins', 1) },
  // Pack A — src/characters/pack-a.js
  { id: 'bruno', name: 'Bruno Bananas', pack: 'a', unlock: stat('racesFinished', 2), concept: 'Gentle giant gorilla in a banana-split kart with a licorice necktie' },
  { id: 'shelly', name: 'Shelly Macaroon', pack: 'a', unlock: onTrack('gumdrop-meadow', 'win'), concept: 'Speedy turtle with a pastel macaron shell' },
  { id: 'boo-berry', name: 'Boo Berry', pack: 'a', unlock: onTrack('starlight-galaxy', 'top3'), concept: 'Shy, giggly blueberry ghost who blushes see-through' },
  { id: 'twiggy', name: 'Twiggy Licorice', pack: 'a', unlock: stat('wins', 3), concept: 'Dramatically tall licorice showman with a top hat, strikes poses' },
  { id: 'captain-crumbs', name: 'Captain Crumbs', pack: 'a', unlock: stat('bonksGiven', 20), concept: 'Cookie pirate captain, "Arr-some!", chocolate-chip beard' },
  { id: 'baby-bonbon', name: 'Baby Bonbon', pack: 'a', unlock: stat('kidAssistFinishes', 1), concept: 'Giggly baby in a bonbon-wrapper onesie, stroller kart' },
  // Pack B — src/characters/pack-b.js
  { id: 'luna', name: 'Luna Lollicorn', pack: 'b', unlock: onTrack('cotton-candy-castle', 'win'), concept: 'Unicorn with a swirly lollipop horn and rainbow mane' },
  { id: 'bleep', name: 'Bleep Bloop', pack: 'b', unlock: stat('timeTrialsFinished', 1), concept: 'Tiny toaster robot that pops toast when boosting' },
  { id: 'puff', name: 'Puff the Sprinkle Dragon', pack: 'b', unlock: stat('miniTurbos', 25), concept: 'Tiny dragon who sneezes sprinkles' },
  { id: 'prince-ribbit', name: 'Prince Ribbit', pack: 'b', unlock: onTrack('mermaid-lagoon', 'win'), concept: 'Very polite frog prince with a too-big crown' },
  { id: 'marina', name: 'Marina Seashell', pack: 'b', unlock: distinct('finish', 8), concept: 'Cheerful mermaid in a clamshell hover-kart' },
  { id: 'lulu', name: 'Lulu Lamb', pack: 'b', unlock: onTrack('pillow-fort', 'finish'), concept: 'Sleepy cloud-fluffy lamb in pajamas' },
];

const TRACK_BY_ID = new Map(LINEUP_TRACKS.map((t) => [t.id, t]));
const CHAR_BY_ID = new Map(LINEUP_CHARACTERS.map((c) => [c.id, c]));
const CUP_BY_ID = new Map(LINEUP_CUPS.map((c) => [c.id, c]));

/** @returns {typeof LINEUP_TRACKS[number] | null} */
export const lineupTrack = (id) => TRACK_BY_ID.get(id) ?? null;
/** @returns {typeof LINEUP_CHARACTERS[number] | null} */
export const lineupCharacter = (id) => CHAR_BY_ID.get(id) ?? null;
/** @returns {typeof LINEUP_CUPS[number] | null} */
export const lineupCup = (id) => CUP_BY_ID.get(id) ?? null;
