import { call } from "@monkeydcode/python-bridge/bridge"

export function build(projectRoot: string) {
    return call<void>("knowledgeGraph.build", { project_root: projectRoot })
}

export function neighbors(node: string, depth = 2) {
    return call<string[]>("knowledgeGraph.neighbors", { node, depth })
}
