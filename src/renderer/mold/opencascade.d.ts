// opencascade.js v1.1.1 ships types for the top-level `opencascade.js`
// import, but we bypass that entry point (see stepExporter.ts and the ADR).
// We import the emscripten-generated JS directly, which has no types.
//
// Everything we access off the module is `any`-typed at the call site — a
// single factory function that returns the OCP module. That matches how
// manifoldBridge.ts treats manifold-3d.

declare module 'opencascade.js/dist/opencascade.wasm.js' {
  // Factory: takes an options object (we use `wasmBinary`) and returns a
  // Promise that resolves to the loaded OCP module. The module surface is
  // 19k+ auto-generated symbols; none are typed here on purpose.
  const factory: (opts?: { wasmBinary?: ArrayBuffer | Uint8Array }) => Promise<unknown>;
  export default factory;
}
