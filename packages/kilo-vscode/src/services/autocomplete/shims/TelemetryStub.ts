/**
 * No-op telemetry client for autocomplete.
 *
 * The extension has no telemetry system yet. This stub logs events
 * to the console for debugging but does not send them anywhere.
 */

export type TelemetryEventName = string

export interface ITelemetryClient {
  captureEvent(event: TelemetryEventName, properties?: Record<string, unknown>): void
}

export class TelemetryStub implements ITelemetryClient {
  captureEvent(event: TelemetryEventName, properties?: Record<string, unknown>): void {
    console.log("[Kilo New] [Telemetry]", event, properties ?? "")
  }
}
