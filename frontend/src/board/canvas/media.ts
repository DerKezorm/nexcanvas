import { createContext, useContext } from 'react'

/** Where the photos and files of the board come from: the signed-in API, or a public page's own address. */
export const MediaBase = createContext('/api/media/')

const ID = /^[A-Za-z0-9_-]{8,40}$/

/** The address of a photo or file, built only from its id. */
export function useMediaUrl(): (id: string, options?: { preview?: boolean; download?: boolean }) => string {
  const base = useContext(MediaBase)
  return (id, options = {}) => {
    const safe = ID.test(id) ? id : 'invalid0'
    const query = [options.preview ? 'preview=1' : '', options.download ? 'download=1' : ''].filter(Boolean).join('&')
    return base + safe + (query ? '?' + query : '')
  }
}
