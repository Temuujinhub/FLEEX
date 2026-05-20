// Placeholder substitution for notification templates. Rules store free-form
// strings like "{DEVICE}: {TYPE} at {LOCATION} ({SPEED} km/h, {TIME})" and we
// fill them with values from the inbound event payload. Unknown placeholders
// are left intact so misconfiguration is visible to the operator instead of
// silently producing empty messages.

import type { EventEnvelope } from './types';

export function renderTemplate(template: string, ev: EventEnvelope, deviceName?: string): string {
  const occurredAt = new Date(ev.occurredAt);
  const time = isNaN(occurredAt.getTime())
    ? ev.occurredAt
    : occurredAt.toISOString().replace('T', ' ').replace(/\..*$/, ' UTC');

  const location =
    typeof ev.lat === 'number' && typeof ev.lng === 'number'
      ? `${ev.lat.toFixed(5)}, ${ev.lng.toFixed(5)}`
      : '-';

  const speed = typeof ev.speed === 'number' ? `${Math.round(ev.speed)}` : '-';

  const values: Record<string, string> = {
    DEVICE: deviceName ?? ev.deviceId,
    TYPE: ev.type,
    SEVERITY: ev.severity,
    LOCATION: location,
    LAT: typeof ev.lat === 'number' ? ev.lat.toFixed(5) : '-',
    LNG: typeof ev.lng === 'number' ? ev.lng.toFixed(5) : '-',
    SPEED: speed,
    TIME: time,
    MESSAGE: ev.message ?? '',
  };

  return template.replace(/\{([A-Z_]+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}
