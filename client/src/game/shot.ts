export const SHOT_DURATION_SECONDS = 0.72;
export const SHOT_FRONT_OFFSET = 1.18;
export const SHOT_TOTAL_RANGE = 16;
export const SHOT_WIDTH_WORLD = 2.32;
export const SHOT_SPEED = (SHOT_TOTAL_RANGE - SHOT_FRONT_OFFSET) / SHOT_DURATION_SECONDS;

export const SHOT_DURATION_MS = SHOT_DURATION_SECONDS * 1000;
export const SPACE_VERTICAL_EXTENT = 31.8;
export const getWorldPixelScale = () => window.innerHeight / (SPACE_VERTICAL_EXTENT * 2);
export const getShotWidthPixels = () => SHOT_WIDTH_WORLD * getWorldPixelScale();
