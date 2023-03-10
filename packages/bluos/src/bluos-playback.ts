import { distinctUntilChanged, filter, map, shareReplay, tap } from 'rxjs'
import { bluOS } from './bluos-api.js'
import { observeStatus, Repeat } from './bluos-status.js'
import { logger } from './log.js'

const log = logger('playback')
const verbose = log.extend('verbose', ':')

const playback$ = observeStatus().pipe(
  map((status) => status.playback),
  filter(Boolean),
  distinctUntilChanged(),
  tap((playback) => verbose('playback: %O', playback)),
  shareReplay({ bufferSize: 1, refCount: true })
)

export const observePlayback = () => playback$

export const play = async (seek?: number) => {
  log('play(%s)', seek || '')
  await bluOS('/Play', { params: { seek: `${seek}` } })
}

export const pause = async () => {
  log('pause()')
  await bluOS('/Pause')
}

export const toggle = async () => {
  log('toggle()')
  await bluOS('/Pause', { params: { toggle: '1' } })
}

export const stop = async () => {
  log('stop()')
  await bluOS('/Stop')
}

export const next = async () => {
  log('next()')
  await bluOS('/Skip')
}

export const previous = async () => {
  log('previous()')
  await bluOS('/Back')
}

export const shuffle = async ({ off = false } = {}) => {
  log('shuffle({ off: %s })', off)
  await bluOS('/Shuffle', { params: { state: off ? '0' : '1' } })
}

export const repeat = async (repeat: Repeat) => {
  log('repeat(%s)', repeat)

  let state: string

  switch (repeat) {
    case Repeat.All:
      state = '0'
      break
    case Repeat.One:
      state = '1'
      break
    case Repeat.Off:
      state = '2'
      break
  }

  await bluOS('/Repeat', { params: { state } })
}
