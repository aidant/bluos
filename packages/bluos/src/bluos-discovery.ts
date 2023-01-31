import _isEqual from 'lodash.isequal'
import {
  distinctUntilChanged,
  firstValueFrom,
  Observable,
  ReplaySubject,
  shareReplay,
  Subject,
  switchMap,
  tap,
} from 'rxjs'
import { logger } from './log.js'

const log = logger('discovery')
const verbose = log.extend('verbose', ':')

export interface Discovery {
  startDiscovery: () => Promise<void>
  stopDiscovery: () => Promise<void>
  observeDeviceEndpoint: () => Observable<string>
}

const discovery$: Subject<Discovery> = new ReplaySubject(1)

let configured = false

export const configureDiscovery = (discovery: Discovery) => {
  log('configureDiscovery(%O)', discovery)
  discovery$.next(discovery)
  configured = true
}

const automaticallyConfigureDiscovery = async () => {
  if (!configured) {
    try {
      const discovery = await import('@bluos/discovery')
      if (!configured) {
        configureDiscovery(discovery)
      }
    } catch (cause) {
      throw new Error(
        'Unable to automatically configure discovery, you may need to install the "@bluos/discovery" package or configure your own discovery logic with the configureDiscovery function',
        { cause }
      )
    }
  }
}

export const startDiscovery = async () => {
  log('startDiscovery()')
  const discovery = await firstValueFrom(discovery$)
  await discovery.startDiscovery()
}

export const stopDiscovery = async () => {
  log('stopDiscovery()')
  const discovery = await firstValueFrom(discovery$)
  await discovery.stopDiscovery()
}

export const observeDeviceEndpoint = () => {
  return discovery$.pipe(
    switchMap((discovery) => discovery.observeDeviceEndpoint()),
    distinctUntilChanged(_isEqual),
    tap((endpoint) => verbose('device endpoint %O', endpoint)),
    shareReplay({ bufferSize: 1, refCount: true }),
    tap(automaticallyConfigureDiscovery)
  )
}
