declare module "npm-package-arg" {
    function npa(spec: string): { name: string; type: string; fetchSpec: string }
    export default npa
}
