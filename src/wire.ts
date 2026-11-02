import type { SidebarHttpRequest, SidebarHttpResponse } from './context-types.ts'

/** Machine-readable error codes of the sidebar API. */
export type SidebarErrorCode = 'bad-request' | 'not-found' | 'forbidden' | 'method-error' | 'unavailable' | 'sidechat-error' | 'internal'

/** One API failure with its wire code and HTTP status. */
export class SidebarError extends Error {
  constructor(
    readonly code: SidebarErrorCode,
    message: string,
    readonly status = 400,
    /** Optional structured context carried alongside the code. */
    readonly meta?: Record<string, string>,
  ) {
    super(message)
  }
}

/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20

/** Success envelope of one API method. */
export interface SidebarOk<T> { ok: true; value: T }

/** Failure envelope of one API method. */
export interface SidebarErr { ok: false; error: { code: SidebarErrorCode; message: string } }

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: SidebarHttpRequest, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    // The structural request yields string | Uint8Array; Buffer.from accepts
    // both (and the real runtime chunks are node Buffers anyway).
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) {
      throw new SidebarError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SidebarError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response with the given status. */export function writeJson(res: SidebarHttpResponse, status: number, body: unknown): void {
  // The response may already be committed by one of the raw byte routes (a
  // file stream that failed mid-flight): `writeHead` would then throw
  // ERR_HTTP_HEADERS_SENT, and the route's catch block would turn a merely
  // truncated download into a crashed request. There is nothing left to say to
  // the client once the status line is out — tear the socket down instead.
  if (res.headersSent === true) {
    res.destroy?.()
    return
  }
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
export function writeOk(res: SidebarHttpResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
export function writeError(res: SidebarHttpResponse, error: unknown): void {
  if (error instanceof SidebarError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** Narrow an unknown payload value to a string, else throw bad-request. */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') {
    throw new SidebarError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}
