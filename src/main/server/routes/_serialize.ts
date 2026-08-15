import type { Device } from '../types'

/** The ONLY way a Device may leave the server. Strips the token hash and adds a
 *  plain `paired` flag for the UI. Every route that emits a device uses this. */
export function publicDevice(d: Device) {
  const { tokenHash, ...rest } = d
  return {
    ...rest,
    pairingState: d.pairingState ?? 'legacy',
    paired: d.pairingState === 'paired',
  }
}

export function publicDevices(list: Device[]) {
  return list.map(publicDevice)
}
