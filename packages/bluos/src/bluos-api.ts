import { XMLParser } from 'fast-xml-parser'
import { firstValueFrom } from 'rxjs'
import { observeDeviceEndpoint } from './bluos-discovery.js'
import { logger } from './log.js'

const log = logger('bluos-api')
const verbose = log.extend('verbose', ':')

const xml = new XMLParser({
  ignoreDeclaration: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
})

interface BluOSOptions {
  params?: Record<string, string>
  endpoint?: string
  signal?: AbortSignal
}

export const bluOS = async (path: string, { params, endpoint, signal }: BluOSOptions = {}) => {
  endpoint ??= await firstValueFrom(observeDeviceEndpoint())

  const url = new URL(path, endpoint)

  if (params) {
    url.search = new URLSearchParams(params).toString()
  }

  verbose('url: %s', url)

  const response = await fetch(url.href, { signal })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type')

  const data = await response.text()

  if (contentType?.startsWith('text/xml')) {
    return xml.parse(data)
  }

  throw new Error(`Unsupported content type: "${contentType}"`)
}
