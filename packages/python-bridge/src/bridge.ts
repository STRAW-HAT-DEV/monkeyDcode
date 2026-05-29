import { Effect, Context, Layer, Data } from "effect"
import { spawn, type ChildProcess } from "child_process"
import { Socket } from "net"

export class PythonBridgeError extends Data.TaggedError("PythonBridgeError")<{
    kind: "spawn_failed" | "connection_lost" | "timeout" | "rpc_error"
    message: string
}> {}

export class PythonBridge extends Context.Tag("@monkeydcode/PythonBridge")<
    PythonBridge,
    {
        call: <T>(method: string, params?: any) => Effect.Effect<T, PythonBridgeError>
        shutdown: () => Effect.Effect<void>
    }
>() {}

export const live = Layer.scoped(PythonBridge, Effect.gen(function* () {
    const state = yield* spawnBridge()
    return PythonBridge.of({
        call: (method, params) => callRpc(state, method, params),
        shutdown: () => Effect.sync(() => {
            state.process.kill()
            state.socket.destroy()
        })
    })
}))

// todo: spawnBridge() and callRpc() impelemntations...
