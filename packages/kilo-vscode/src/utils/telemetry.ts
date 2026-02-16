import * as vscode from "vscode"
import { z } from "zod"
import { logger } from "./logger"

export const telemetryEventNameSchema = z.enum([
  "Marketplace Tab Viewed",
  "Marketplace Install Button Clicked",
  "Marketplace Item Installed",
  "Marketplace Item Removed",
  "Agent Manager Opened",
  "Agent Manager Session Started",
  "Agent Manager Session Completed",
  "Agent Manager Session Stopped",
  "Agent Manager Session Error",
  "Agent Manager Login Issue",
])

export type TelemetryEventName = z.infer<typeof telemetryEventNameSchema>

export function parseTelemetryProperties(raw: unknown): Record<string, unknown> | undefined {
  const parsed = z.record(z.unknown()).safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

export function captureTelemetryEvent(event: TelemetryEventName, properties?: Record<string, unknown>): void {
  if (!vscode.env.isTelemetryEnabled) {
    logger.debug("[Kilo New] Telemetry skipped (disabled):", event)
    return
  }

  logger.debug("[Kilo New] Telemetry:", event, properties ?? {})
}
