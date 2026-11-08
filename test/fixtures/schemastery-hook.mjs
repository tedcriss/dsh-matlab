/**
 * Module resolve hook mapping `@deepseek-ai/schemastery` to the local stub.
 *
 * Registered by `test/entry.test.js` only, so the plugin entry point can be
 * imported without the DSH runtime installed, and no other test is affected.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/schemastery') {
    return { url: new URL('./schemastery-stub.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
