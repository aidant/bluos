import debug from 'debug'
export const log = debug('bluos')
export const logger = (namespace: string) => log.extend(namespace, ':')
