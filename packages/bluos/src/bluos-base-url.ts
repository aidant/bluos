import type { SrvAnswer, StringAnswer } from 'dns-packet'
import mDNS, { type QueryOutgoingPacket, type ResponsePacket } from 'multicast-dns'
import { distinctUntilChanged, Observable, shareReplay, tap } from 'rxjs'
import { logger } from './log.js'

const log = logger('base-url')
const verbose = log.extend('verbose', ':')

const BLU_OS_MULTICAST_DNS_SERVICE_NAMES = [
  '_musc._tcp.local',
  '_mush._tcp.local',
  '_musp._tcp.local',
  '_musz._tcp.local',
]

let multicast: mDNS.MulticastDNS | undefined

const url$ = new Observable<string>((subscriber) => {
  multicast ??= mDNS()

  const interval = setInterval(queryBaseURL, 500)

  const handleError = (error: Error) => {
    log('error: %O', error)
    subscriber.error(error)
  }

  const handleResponse = (response: ResponsePacket) => {
    verbose('response: %O', response)

    const pointer = response.answers.find(
      (answer): answer is StringAnswer =>
        answer.type === 'PTR' && BLU_OS_MULTICAST_DNS_SERVICE_NAMES.includes(answer.name)
    )

    if (!pointer) return

    log('pointer: %O', pointer)

    const service = response.answers.find(
      (answer): answer is SrvAnswer => answer.type === 'SRV' && answer.name === pointer.data
    )

    if (!service) return

    log('service: %O', service)

    const address = response.answers.find(
      (answer): answer is StringAnswer => answer.type === 'A' && answer.name === service.data.target
    )

    if (!address) return

    log('address: %O', address)

    clearInterval(interval)
    subscriber.next(`http://${address.data}:${service.data.port}/`)
  }

  multicast.on('response', handleResponse)
  multicast.on('error', handleError)

  queryBaseURL()

  return () => {
    clearInterval(interval)

    multicast!.off('response', handleResponse)
    multicast!.off('error', handleError)
    multicast!.destroy()
    multicast = undefined
  }
}).pipe(
  distinctUntilChanged(),
  tap((baseURL) => log('baseURL: %s', baseURL)),
  shareReplay({ bufferSize: 1, refCount: true })
)

export const queryBaseURL = () => {
  const query: QueryOutgoingPacket = {
    questions: BLU_OS_MULTICAST_DNS_SERVICE_NAMES.map((name) => ({
      type: 'PTR',
      name,
      class: 'IN',
    })),
  }

  log('query: %O', query)

  multicast?.query(query)
}

export const observeBaseURL = () => url$
