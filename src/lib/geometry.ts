import { Point } from '../types/whiteboard';

/**
 * Calculates the nearest point on a line segment to a target point.
 * Used for the Ruler snap logic.
 */
export function getNearestPointOnLine(
  p: Point,
  lineStart: Point,
  lineEnd: Point,
  threshold: number = 20
): Point | null {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const l2 = dx * dx + dy * dy;

  if (l2 === 0) return null;

  let t = ((p.x - lineStart.x) * dx + (p.y - lineStart.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));

  const nearest = {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
  };

  const dist = Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2);
  return dist < threshold ? nearest : null;
}

/**
 * Calculates the nearest point on an arc to a target point.
 * Used for the Protractor snap logic.
 */
export function getNearestPointOnArc(
  p: Point,
  center: Point,
  radius: number,
  threshold: number = 20,
  rotation: number = 0
): Point | null {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // 1. Check the curved arc
  let snappedArc: Point | null = null;
  if (Math.abs(dist - radius) <= threshold) {
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Normalize angle relative to tool rotation
    const normalizedAngle = (angle - rotation + 360) % 360;
    
    // In Protractor.tsx, the Arc has rotation=180 and angle=180.
    // This sweeps from local 180 to 360 (the top segment relative to group orientation).
    if (normalizedAngle >= 180 && normalizedAngle <= 360) {
      snappedArc = {
        x: center.x + (dx / dist) * radius,
        y: center.y + (dy / dist) * radius,
      };
    }
  }

  // 2. Check the straight base line
  const rad = (rotation * Math.PI) / 180;
  const lineStart = {
    x: center.x - Math.cos(rad) * radius,
    y: center.y - Math.sin(rad) * radius,
  };
  const lineEnd = {
    x: center.x + Math.cos(rad) * radius,
    y: center.y + Math.sin(rad) * radius,
  };

  const snappedLine = getNearestPointOnLine(p, lineStart, lineEnd, threshold);

  if (snappedArc && snappedLine) {
    const dArc = Math.sqrt((p.x - snappedArc.x) ** 2 + (p.y - snappedArc.y) ** 2);
    const dLine = Math.sqrt((p.x - snappedLine.x) ** 2 + (p.y - snappedLine.y) ** 2);
    return dArc < dLine ? snappedArc : snappedLine;
  }
  
  return snappedArc || snappedLine;
}

