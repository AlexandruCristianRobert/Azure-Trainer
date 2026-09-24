export class LabEngineError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'LabEngineError'
    this.code = code
    this.details = details
  }
}

export function fail(code, message, details) {
  throw new LabEngineError(code, message, details)
}
