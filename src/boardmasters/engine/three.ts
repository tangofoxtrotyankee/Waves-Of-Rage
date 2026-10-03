import * as THREE from 'three';

/**
 * Every Boardmasters module imports Three from here so this runs first:
 * colours are given as display (sRGB) values and the PS1 shader writes them
 * to the screen as-is, so Three must not convert them to linear.
 */
THREE.ColorManagement.enabled = false;

export { THREE };
