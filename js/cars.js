/** Car catalog — files live in assets/cars/<id>.glb */

export const CAR_IDS = [
  'porsche_gt2rs',
  'corvette_zr1',
  'ford_gt',
  'lambo_sc18',
  'mclaren_600lt',
  'mustang_roush',
];

/** Default for sandbox — McLaren is lighter than Porsche (fewer meshes) so it
 *  loads reliably after the 89MB Shanghai map. Porsche still in the catalog. */
export const DEFAULT_CAR = 'mclaren_600lt';

export const CAR_LABELS = {
  porsche_gt2rs: 'Porsche 911 GT2 RS',
  corvette_zr1: 'Corvette ZR1',
  ford_gt: 'Ford GT Mk II',
  lambo_sc18: 'Lamborghini SC18',
  mclaren_600lt: 'McLaren 600LT',
  mustang_roush: 'Roush Mustang',
};

export const CAR_THUMBS = Object.fromEntries(
  CAR_IDS.map((id) => [id, `assets/cars/thumbs/${id}.png`]),
);

export function isValidCarId(id) {
  return CAR_IDS.includes(id);
}

export function pickRandomCar(exclude = []) {
  const pool = CAR_IDS.filter((id) => !exclude.includes(id));
  const list = pool.length ? pool : CAR_IDS;
  return list[Math.floor(Math.random() * list.length)];
}
