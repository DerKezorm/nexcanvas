/**
 * A browser that translates the page (Chrome, Edge, extensions) replaces text nodes with elements of its own. React
 * keeps hold of the old nodes and fails on the next insert or removal with "insertBefore" or "removeChild", and the
 * whole page is gone. Here both give way: a node already taken away is not removed again, and what should go before a
 * node taken away goes before whatever stands in for it, otherwise to the end.
 */
export function bearTranslatedPages(): void {
  if (typeof Node !== 'function') return
  const proto = Node.prototype
  if ((proto as { nexcanvasBears?: boolean }).nexcanvasBears) return
  ;(proto as { nexcanvasBears?: boolean }).nexcanvasBears = true

  const removeChild = proto.removeChild
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child
    return removeChild.call(this, child) as T
  }

  const insertBefore = proto.insertBefore
  proto.insertBefore = function <T extends Node>(this: Node, node: T, before: Node | null): T {
    if (before !== null && before.parentNode !== this) {
      return insertBefore.call(this, node, childHolding(this, before)) as T
    }
    return insertBefore.call(this, node, before) as T
  }
}

/** The child of `parent` that `node` sits in today; null when it no longer sits there. */
function childHolding(parent: Node, node: Node): Node | null {
  let current: Node | null = node
  while (current !== null && current.parentNode !== parent) current = current.parentNode
  return current
}
