import axios, { AxiosError } from 'axios'
import { webcrypto as crypto } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import { firstValueFrom } from 'rxjs'
import { observeBaseURL, queryBaseURL } from './bluos-base-url.js'
import { logger } from './log.js'

const log = logger('bluos')
const verbose = log.extend('verbose', ':')

const xml = new XMLParser({
  ignoreDeclaration: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
})

export const bluOS = axios.create({ transitional: { clarifyTimeoutError: true } })

bluOS.interceptors.request.use(async (config) => {
  config.baseURL ??= await firstValueFrom(observeBaseURL())
  config.headers['x-request-id'] = crypto.randomUUID()

  verbose('request: %O', config)

  return config
})

bluOS.interceptors.response.use(
  async (response) => {
    if (response.headers['content-type'].startsWith('text/xml')) {
      response.data = xml.parse(response.data)
    }

    verbose('response: %O', response)

    return response
  },
  async (error) => {
    if (error instanceof AxiosError && ['ENETUNREACH', 'ETIMEDOUT'].includes(error.code!)) {
      queryBaseURL()
    }

    throw error
  }
)
