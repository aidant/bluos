import type { SrvAnswer, StringAnswer } from 'dns-packet'
import mDNS, { type QueryOutgoingPacket } from 'multicast-dns'
import { distinctUntilChanged, Observable, shareReplay, tap } from 'rxjs'
import { logger } from './log.js'

const log = logger('discovery')
const verbose = log.extend('verbose', ':')

let interval: ReturnType<typeof setInterval>
let multicast: mDNS.MulticastDNS | undefined

const BLU_OS_MULTICAST_DNS_SERVICE_NAMES = [
  '_musc._tcp.local',
  '_mush._tcp.local',
  '_musp._tcp.local',
  '_musz._tcp.local',
]

const query = () => {
  const query: QueryOutgoingPacket = {
    questions: BLU_OS_MULTICAST_DNS_SERVICE_NAMES.map((name) => ({
      type: 'PTR',
      name,
      class: 'IN',
    })),
  }

  log('query: %O', query)

  multicast!.query(query)
}

export const startDiscovery = async () => {
  multicast ??= mDNS()

  interval ??= setInterval(query, 500)

  queueMicrotask(query)
}

export const stopDiscovery = async () => {
  clearInterval(interval)

  multicast!.destroy()
  multicast!.removeAllListeners()
  multicast = undefined
}

const url$ = new Observable<string>((subscriber) => {
  startDiscovery()

  multicast!.on('response', (response) => {
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
  })

  multicast!.on('error', (error: Error) => {
    log('error: %O', error)
    subscriber.error(error)
  })

  return stopDiscovery
}).pipe(
  distinctUntilChanged(),
  tap((endpoint) => log('endpoint: %s', endpoint)),
  shareReplay({ bufferSize: 1, refCount: true })
)

export const observeDeviceEndpoint = () => url$
