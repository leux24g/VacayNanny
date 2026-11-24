import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

const deadline = new AsyncLocalStorage<AbortSignal>()
export function withWorkerDeadline<T>(signal: AbortSignal, operation: () => Promise<T>) {
  const parent=deadline.getStore()
  return deadline.run(parent ? AbortSignal.any([parent,signal]) : signal, operation)
}
export function workerSignal() { return deadline.getStore() }
export function requestSignal(milliseconds = 10000, input?: AbortSignal | null) {
  const signals = [AbortSignal.timeout(milliseconds), input, workerSignal()].filter((signal): signal is AbortSignal => Boolean(signal))
  return AbortSignal.any(signals)
}
