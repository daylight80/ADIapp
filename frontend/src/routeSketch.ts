import type { RoutePoint } from './routeRecorder';

/**
 * Scales GPS points into a size x size box. Returns null for fewer than 2 points. Longitude degrees are shorter than
 * latitude degrees away from the equator, so x is shrunk to keep the shape true. Shared by the route sketch lines and
 * by anything drawn on top of them (the fault dots), so they line up.
 */
export function sketchProjector(points: RoutePoint[], size: number, pad = 6): ((lat: number, lng: number) => [number, number]) | null {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = Math.max((maxLng - minLng) * k, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = (size - 2 * pad) / Math.max(w, h);
  return (lat, lng) => [
    pad + (lng - minLng) * k * scale + ((size - 2 * pad) - w * scale) / 2,
    pad + (maxLat - lat) * scale + ((size - 2 * pad) - h * scale) / 2,
  ];
}

/** One line per run (a pause starts a new line). Needs 2+ points. */
export function sketchLines(points: RoutePoint[], size: number, pad = 6): string[] {
  const project = sketchProjector(points, size, pad);
  if (!project) return [];
  const lines: string[][] = [];
  points.forEach((p, i) => {
    if (i === 0 || p.brk) lines.push([]);
    const [x, y] = project(p.lat, p.lng);
    lines[lines.length - 1].push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return lines.filter((l) => l.length > 1).map((l) => l.join(' '));
}
