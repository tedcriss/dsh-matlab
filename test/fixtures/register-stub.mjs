import { register } from 'node:module'

/**
 * Resolve `@deepseek-ai/schemastery` to the local stub so the plugin entry point
 * can be imported without the DSH runtime installed. Registered before any
 * dynamic import of the package, and scoped to this test process only.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/schemastery') {
    return { url: new URL('./fixtures/schemastery-stub.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

register(import.meta.url, import.meta.url)
