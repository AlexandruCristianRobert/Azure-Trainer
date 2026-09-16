// AzError.kind: 'arm' → az prints "ERROR: (Code) Message\nCode: Code\nMessage: Message";
//               'cli' → az prints "ERROR: Message" only.
export class AzError extends Error {
  constructor(code, message, { kind = 'arm' } = {}) {
    super(message)
    this.name = 'AzError'
    this.code = code
    this.kind = kind
  }
}

export function notFoundEntity(namespace, type, name) {
  return new AzError('NotFound', `Entity '${namespace}:${type}:${name}' was not found.`)
}
