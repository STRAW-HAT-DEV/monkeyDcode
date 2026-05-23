import { Effect } from "effect"
export const workspaceContext = {}
export const WorkspaceContext = {
    Service: class WorkspaceContextService {},
    layer: () => Effect.void,
}
