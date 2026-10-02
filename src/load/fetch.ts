/*
 * Fetching a text file over HTTP(S), with errors a caller can tell apart.
 *
 * `fetch` is injectable so Node, the browser and tests all run the same code.
 * There is no caching layer here: a validator loads its shapes once, and
 * callers that validate repeatedly hold on to the validator instead.
 */

/** A shapes file, context or document could not be loaded or understood. */
export class SourceError extends Error {
  constructor (message: string, readonly source: string, readonly status?: number) {
    super(message)
    this.name = 'SourceError'
  }
}

/** The source does not exist - an HTTP 404, or a missing file. */
export class NotFoundError extends SourceError {
  constructor (source: string) {
    super(`not found: ${source}`, source, 404)
    this.name = 'NotFoundError'
  }
}

export type Fetch = typeof globalThis.fetch

export async function fetchText (url: string, doFetch: Fetch | undefined = globalThis.fetch): Promise<string> {
  if (typeof doFetch !== 'function') {
    throw new SourceError('no fetch implementation available', url)
  }
  let response: Response
  try {
    response = await doFetch(url)
  } catch (error) {
    throw new SourceError(`could not reach ${url}: ${(error as Error).message}`, url)
  }
  if (response.status === 404) throw new NotFoundError(url)
  if (!response.ok) throw new SourceError(`HTTP ${response.status} fetching ${url}`, url, response.status)
  return response.text()
}
