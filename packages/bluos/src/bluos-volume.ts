import { distinctUntilChanged, filter, map, shareReplay, tap } from 'rxjs'
import { bluOS } from './bluos-api.js'
import { observeStatus } from './bluos-status.js'
import { logger } from './log.js'

const log = logger('volume')
const verbose = log.extend('verbose', ':')

const volume$ = observeStatus().pipe(
  map((status) => status.volume),
  filter(Boolean),
  distinctUntilChanged(),
  tap((volume) => verbose('volume: %O', volume)),
  shareReplay({ bufferSize: 1, refCount: true })
)

export const observeVolume = () => volume$

export const mute = async ({ muted = true } = {}) => {
  log('mute({ muted: %s })', muted)
  await bluOS('/Volume', { params: { mute: muted ? '1' : '0' } })
}

export const setVolume = async (volume: number) => {
  log('setVolume(%s)', volume)
  await bluOS('/Volume', { params: { level: `${volume * 100}` } })
}

export const increaseVolume = async (decibels = 0.8) => {
  log('increaseVolume(%s)', decibels)
  await bluOS('/Volume', { params: { db: `${decibels}dB` } })
}

export const decreaseVolume = async (decibels = -0.8) => {
  log('decreaseVolume(%s)', decibels)
  await bluOS('/Volume', { params: { db: `${decibels}dB` } })
}
