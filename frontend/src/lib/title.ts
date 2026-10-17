import { useEffect } from 'react'

/** The browser tab says where one is: "Ideen · nexcanvas" instead of "nexcanvas" on every page. */
export function pageTitle(text: string | null | undefined): string {
  const name = (text ?? '').trim()
  return name ? `${name} · nexcanvas` : 'nexcanvas'
}

export function useTitle(text: string | null | undefined): void {
  useEffect(() => {
    document.title = pageTitle(text)
  }, [text])
}
