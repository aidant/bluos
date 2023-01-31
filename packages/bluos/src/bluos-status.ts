import _isEqual from 'lodash.isequal'
import {
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
  tap,
  timer,
} from 'rxjs'
import { z } from 'zod'
import { bluOS } from './bluos-api.js'
import { observeDeviceEndpoint } from './bluos-discovery.js'
import { logger } from './log.js'

const log = logger('status')
const verbose = log.extend('verbose', ':')

const BluOSStatusSchema = z.object({
  status: z.object({
    etag: z.string(),
    syncStat: z.number().optional(),

    // Playback
    state: z.enum(['play', 'pause', 'stop', 'stream', 'connecting']).optional(),

    image: z.string().optional(),

    quality: z.enum(['cd', 'hd', 'dolbyAudio', 'mqa', 'mqaAuthored']).or(z.number()).optional(),

    name: z.string().optional(),
    album: z.string().optional(),
    artist: z.string().optional(),
    title1: z.string().optional(),
    title2: z.string().optional(),
    title3: z.string().optional(),

    shuffle: z.number().min(0).max(1).optional(),

    secs: z.number().min(0).optional(),
    totlen: z.number().min(0).optional(),

    repeat: z.number().min(0).max(2).optional(),

    // Volume
    mute: z.coerce.number().min(0).max(1).optional(),
    muteDb: z.coerce.number().min(-100).max(0).optional(),
    muteVolume: z.coerce.number().min(0).max(100).optional(),
    db: z.coerce.number().min(-100).max(0).optional(),
    volume: z.coerce.number().min(-1).max(100).optional(),

    // Source
    service: z.string().optional(),
    serviceName: z.string().optional(),
    serviceIcon: z.string().optional(),
  }),
})

const BluOSSyncStatusSchema = z.object({
  SyncStatus: z.object({
    // Device
    brand: z.string().optional(),
    model: z.string().optional(),
    modelName: z.string().optional(),
    icon: z.string().optional(),
    name: z.string().optional(),

    // Volume
    mute: z.coerce.number().min(0).max(1).optional(),
    muteDb: z.coerce.number().min(-100).max(0).optional(),
    muteVolume: z.coerce.number().min(0).max(100).optional(),
    db: z.coerce.number().min(-100).max(0).optional(),
    volume: z.coerce.number().min(-1).max(100).optional(),
  }),
})

export const Repeat = {
  Off: 'off',
  All: 'all',
  One: 'one',
} as const
export type Repeat = typeof Repeat[keyof typeof Repeat]

export const PlaybackStatus = {
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Streaming: 'streaming',
  Connecting: 'connecting',
}
export type PlaybackStatus = typeof PlaybackStatus[keyof typeof PlaybackStatus]

export interface Device {
  brandName?: string
  modelId?: string
  modelName?: string
  icon?: string
  name?: string
}

export interface Source {
  name?: string
  icon?: string
}

export const PlaybackQuality = {
  CD: 'cd',
  HD: 'hd',
  DolbyAudio: 'dolby-audio',
  MQA: 'mqa',
  MQAAuthored: 'mqa-authored',
}
export type PlaybackQuality = typeof PlaybackQuality[keyof typeof PlaybackQuality]

export interface Playback {
  song?: string
  album?: string
  artist?: string

  status?: PlaybackStatus
  image?: string
  quality?: PlaybackQuality | number
  progress?: number
  duration?: number
  repeat?: Repeat
  shuffle?: boolean
}

export interface Volume {
  muted?: boolean
  level?: number
  decibels?: number
}

export interface Status {
  device?: Device

  source?: Source

  playback?: Playback

  volume?: Volume
}

const bluOSStatus$ = observeDeviceEndpoint().pipe(
  switchMap(
    (endpoint) =>
      new Observable<z.infer<typeof BluOSStatusSchema>['status']>((subscriber) => {
        let controller: AbortController

        const getStatus = async (etag = '', delay = 1000) => {
          verbose('getStatus(%s, %s)', etag, delay)

          controller = new AbortController()

          try {
            const response = await bluOS('/Status', {
              signal: controller.signal,
              endpoint: endpoint,
              params: { etag, timeout: etag && '100' },
            })

            verbose('response: %O', response)

            const { status } = BluOSStatusSchema.parse(response)

            subscriber.next(status)

            getStatus(status.etag)
          } catch (error) {
            if (!controller.signal.aborted) {
              log('error: %O', error)
              // subscriber.error(error)
            }

            await new Promise((resolve) => setTimeout(resolve, delay))

            getStatus(undefined, Math.min(delay ** 1.1, 30_000))
          }
        }

        getStatus()

        return () => {
          controller.abort()
        }
      })
  ),
  distinctUntilChanged(_isEqual),
  tap((status) => verbose('bluOS status: %O', status)),
  shareReplay({ bufferSize: 1, refCount: true })
)

const bluOSSyncStatus$ = combineLatest({
  endpoint: observeDeviceEndpoint(),
  status: bluOSStatus$.pipe(
    map((status) => status.syncStat),
    distinctUntilChanged()
  ),
}).pipe(
  switchMap(async ({ endpoint, status }) => {
    const response = await bluOS('/SyncStatus', { endpoint: endpoint })

    const { SyncStatus } = BluOSSyncStatusSchema.parse(response)

    return SyncStatus
  }),
  distinctUntilChanged(_isEqual),
  tap((syncStatus) => verbose('bluOS sync-status: %O', syncStatus)),
  shareReplay({ bufferSize: 1, refCount: true })
)

const status$: Observable<Status> = combineLatest({
  endpoint: observeDeviceEndpoint(),
  status: bluOSStatus$,
  syncStatus: bluOSSyncStatus$,
}).pipe(
  switchMap(({ endpoint, status, syncStatus }) =>
    combineLatest({
      endpoint: of(endpoint),
      status: of(status),
      syncStatus: of(syncStatus),
      milliseconds: timer(0, 10),
    })
  ),
  map(({ endpoint, status, syncStatus, milliseconds }) => {
    const parsed: Status = {}

    /*
      Device
    */

    if (syncStatus.brand) {
      parsed.device ??= {}
      parsed.device.brandName = syncStatus.brand
    }

    if (syncStatus.model) {
      parsed.device ??= {}
      parsed.device.modelId = syncStatus.model
    }

    if (syncStatus.modelName) {
      parsed.device ??= {}
      parsed.device.modelName = syncStatus.modelName
    }

    if (syncStatus.icon) {
      parsed.device ??= {}
      parsed.device.icon = new URL(syncStatus.icon, endpoint).href
    }

    if (syncStatus.name) {
      parsed.device ??= {}
      parsed.device.name = syncStatus.name
    }

    /*
      Volume
    */

    if (typeof status.mute === 'number') {
      parsed.volume ??= {}
      parsed.volume.muted = status.mute === 1
    } else if (typeof syncStatus.mute === 'number') {
      parsed.volume ??= {}
      parsed.volume.muted = syncStatus.mute === 1
    }

    if (typeof status.volume === 'number') {
      parsed.volume ??= {}
      parsed.volume.level = status.volume / 100
    } else if (typeof syncStatus.volume === 'number') {
      parsed.volume ??= {}
      parsed.volume.level = syncStatus.volume / 100
    }

    if (typeof status.db === 'number') {
      parsed.volume ??= {}
      parsed.volume.decibels = status.db
    } else if (typeof syncStatus.db === 'number') {
      parsed.volume ??= {}
      parsed.volume.decibels = syncStatus.db
    }

    if (parsed.volume?.level === 0) {
      parsed.volume.muted = true
    }

    if (parsed.volume?.muted && typeof status.muteDb === 'number') {
      parsed.volume.decibels = status.muteDb
    } else if (parsed.volume?.muted && typeof syncStatus.muteDb === 'number') {
      parsed.volume.decibels = syncStatus.muteDb
    }

    if (parsed.volume?.muted && typeof status.muteVolume === 'number') {
      parsed.volume.level = status.muteVolume / 100
    } else if (parsed.volume?.muted && typeof syncStatus.muteVolume === 'number') {
      parsed.volume.level = syncStatus.muteVolume / 100
    }

    /*
      Source
    */

    if (status.serviceName) {
      parsed.source ??= {}
      parsed.source.name = status.serviceName
    } else if (status.service) {
      parsed.source ??= {}
      parsed.source.name = status.service
    }

    if (status.serviceIcon) {
      parsed.source ??= {}
      parsed.source.icon = new URL(status.serviceIcon, endpoint).href
    }

    if (status.service === 'Capture' && status.title1) {
      parsed.source ??= {}
      parsed.source.name = status.title1
    }

    if (status.service === 'Capture' && status.image) {
      parsed.source ??= {}
      parsed.source.icon = new URL(status.image, endpoint).href
    }

    /*
      Playback
    */

    if (status.service !== 'Capture') {
      if (status.title1) {
        parsed.playback ??= {}
        parsed.playback.song = status.title1
      } else if (status.name) {
        parsed.playback ??= {}
        parsed.playback.song = status.name
      }

      if (status.title3) {
        parsed.playback ??= {}
        parsed.playback.album = status.title3
      } else if (status.album) {
        parsed.playback ??= {}
        parsed.playback.album = status.album
      }

      if (status.title2) {
        parsed.playback ??= {}
        parsed.playback.artist = status.title2
      } else if (status.artist) {
        parsed.playback ??= {}
        parsed.playback.artist = status.artist
      }
    }

    if (status.state === 'play') {
      parsed.playback ??= {}
      parsed.playback.status = PlaybackStatus.Playing
    } else if (status.state === 'pause') {
      parsed.playback ??= {}
      parsed.playback.status = PlaybackStatus.Paused
    } else if (status.state === 'stop') {
      parsed.playback ??= {}
      parsed.playback.status = PlaybackStatus.Stopped
    } else if (status.state === 'stream') {
      parsed.playback ??= {}
      parsed.playback.status = PlaybackStatus.Streaming
    } else if (status.state === 'connecting') {
      parsed.playback ??= {}
      parsed.playback.status = PlaybackStatus.Connecting
    }

    if (status.service !== 'Capture' && status.image) {
      parsed.playback ??= {}
      parsed.playback.image = new URL(status.image, endpoint).href
    }

    if (
      (status.state === 'play' || status.state === 'stream') &&
      typeof status.secs === 'number' &&
      typeof status.totlen === 'number'
    ) {
      parsed.playback ??= {}
      parsed.playback.progress = Math.min((status.secs + milliseconds / 100) / status.totlen, 1)
    } else if (typeof status.secs === 'number' && typeof status.totlen === 'number') {
      parsed.playback ??= {}
      parsed.playback.progress = 0
    }

    if (typeof status.totlen === 'number') {
      parsed.playback ??= {}
      parsed.playback.duration = status.totlen
    }

    if (typeof status.quality === 'number') {
      parsed.playback ??= {}
      parsed.playback.quality = status.quality
    } else if (status.quality === 'cd') {
      parsed.playback ??= {}
      parsed.playback.quality = PlaybackQuality.CD
    } else if (status.quality === 'hd') {
      parsed.playback ??= {}
      parsed.playback.quality = PlaybackQuality.HD
    } else if (status.quality === 'dolbyAudio') {
      parsed.playback ??= {}
      parsed.playback.quality = PlaybackQuality.DolbyAudio
    } else if (status.quality === 'mqa') {
      parsed.playback ??= {}
      parsed.playback.quality = PlaybackQuality.MQA
    } else if (status.quality === 'mqaAuthored') {
      parsed.playback ??= {}
      parsed.playback.quality = PlaybackQuality.MQAAuthored
    }

    if (status.service !== 'Capture') {
      if (status.repeat === 0) {
        parsed.playback ??= {}
        parsed.playback.repeat = Repeat.All
      } else if (status.repeat === 1) {
        parsed.playback ??= {}
        parsed.playback.repeat = Repeat.One
      } else if (status.repeat === 2) {
        parsed.playback ??= {}
        parsed.playback.repeat = Repeat.Off
      }

      if (status.shuffle === 0) {
        parsed.playback ??= {}
        parsed.playback.shuffle = false
      } else if (status.shuffle === 1) {
        parsed.playback ??= {}
        parsed.playback.shuffle = true
      }
    }

    return parsed
  }),
  distinctUntilChanged(_isEqual),
  tap((status) => verbose('status %O', status)),
  shareReplay({ bufferSize: 1, refCount: true })
)

export const observeStatus = () => status$
