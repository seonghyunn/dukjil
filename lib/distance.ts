const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (value: number) => (value * Math.PI) / 180;

export function greatCircleDistanceKm(
  from: [number, number],
  to: [number, number],
) {
  const [lon1, lat1] = from.map(toRadians);
  const [lon2, lat2] = to.map(toRadians);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function interpolateGreatCircle(
  from: [number, number],
  to: [number, number],
  fraction: number,
): [number, number] {
  const [lon1, lat1] = from.map(toRadians);
  const [lon2, lat2] = to.map(toRadians);
  const distance = greatCircleDistanceKm(from, to) / EARTH_RADIUS_KM;
  if (distance < 1e-9) return from;
  const a = Math.sin((1 - fraction) * distance) / Math.sin(distance);
  const b = Math.sin(fraction * distance) / Math.sin(distance);
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);
  return [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI];
}

export const formatDistance = (km: number) =>
  km >= 1000 ? `${Math.round(km).toLocaleString('ko-KR')} km` : `${Math.round(km)} km`;
