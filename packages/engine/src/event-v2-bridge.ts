// @ts-nocheck
import { Effect, Layer } from "effect"
export const EventV2Bridge = {
    Service: class EventV2BridgeService {
        project() { return Effect.void }
        toSyncDefinition() { return {} }
    },
    layer: () => Layer.empty,
    defaultLayer: Layer.empty,
}
