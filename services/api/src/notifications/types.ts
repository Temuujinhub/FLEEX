// Shape of the JSON envelope the events-engine publishes on the
// `fleex.events` Redis channel. See store.PersistAndPublish in
// services/events-engine/internal/store/store.go for the source of truth.

export interface EventEnvelope {
  id: string;
  companyId: string;
  deviceId: string;
  geofenceId?: string | null;
  type: string;
  severity: string;
  lat?: number;
  lng?: number;
  speed?: number;
  message?: string;
  occurredAt: string;
}
