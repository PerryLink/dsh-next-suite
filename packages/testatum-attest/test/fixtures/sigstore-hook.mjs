/**
 * Preload (`node --import`) that makes the optional `sigstore` import
 * deterministic in CLI tests without installing it or touching the network.
 *
 * `FAKE_SIGSTORE_MODE=missing` makes resolution fail exactly like a missing
 * package (`ERR_MODULE_NOT_FOUND`); every other value maps to the local fake.
 */
import { registerHooks } from 'node:module'

const fakeUrl = new URL('./fake-sigstore.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== 'sigstore') return nextResolve(specifier, context)
    if (process.env.FAKE_SIGSTORE_MODE === 'missing') {
      const error = new Error("Cannot find package 'sigstore'")
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    }
    return { url: fakeUrl, shortCircuit: true }
  },
})
