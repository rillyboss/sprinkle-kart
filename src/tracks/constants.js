/** Shared track-building constants (metres). */

/** Visual fence distance beyond path.halfWidth (physics soft wall is at +3; a kart is ~1.6 wide). */
export const FENCE_OFFSET = 3.8;
export const SKY_RADIUS = 700;

export const SHOULDER_IN = 1.3; // curb width
/** Metres a cotton-candy canopy keeps beyond the fence (camera height + a bit). */
export const TREE_CAMERA_CLEARANCE = 3.5;
/** Max horizontal reach of a cotton-candy tree canopy per unit of tree scale. */
export const CANOPY_REACH = 3.3;
export const APRON_Y = -3; // far-away flat ground level on hilly tracks
export const SHOULDER_OUT = FENCE_OFFSET + 1.4;

/** Cartoon outline colour for scenery. */
export const OUTLINE_COLOR = 0x3a2046;
