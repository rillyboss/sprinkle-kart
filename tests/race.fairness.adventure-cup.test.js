// Fairness for non-drifting kids on the adventure-cup tracks (see tests/helpers/kidRace.js).
// One file per cup so vitest runs the cups on parallel workers.
import { fairnessSuite } from './helpers/kidRace.js';

fairnessSuite('adventure-cup');
