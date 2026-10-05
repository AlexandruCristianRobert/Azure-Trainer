import { httpError } from './contracts.js'

/** Presentation flags are stripped here; effects contain request intent only. */
export function httpShellEffect(tokens, context) {
  if (context?.lab?.capabilities?.httpFunctions !== true || !['func', 'curl'].includes(tokens[0])) return null
  try {
    if (tokens[0] === 'func') {
      if (tokens.length === 2 && tokens[1] === 'start') return { type: 'http-functions', intent: { kind: 'capture', scope: 'local' } }
      if (tokens.length === 5 && tokens.slice(1, 4).join(' ') === 'azure functionapp publish')
        return { type: 'http-functions', intent: { kind: 'capture', scope: 'published', name: tokens[4] } }
      httpError('Use func start or func azure functionapp publish with the actual app name.')
    }
    const request = { method: 'GET', url: '', headers: {}, body: '' }
    let method = false, body = false
    for (let index = 1; index < tokens.length; index++) {
      const token = tokens[index]
      if (['-i', '--include'].includes(token)) continue
      if (['-X', '--request', '-H', '--header', '-d', '--data'].includes(token)) {
        if (++index >= tokens.length) httpError('A curl option is missing its value.')
        const value = tokens[index]
        if (['-X', '--request'].includes(token)) {
          if (method) httpError('Specify one request method.')
          method = true; request.method = value.toUpperCase()
        } else if (['-d', '--data'].includes(token)) {
          if (body || value.startsWith('@')) httpError('Specify one inline request body.')
          body = true; request.body = value
        } else {
          const split = value.indexOf(':')
          if (split < 1) httpError('Headers require a name and value.')
          const name = value.slice(0, split).trim().toLowerCase(), text = value.slice(split + 1).trim()
          if (['__proto__', 'constructor', 'prototype'].includes(name) || Object.hasOwn(request.headers, name) && request.headers[name] !== text) httpError('Conflicting or unsupported header.')
          request.headers[name] = text
        }
      } else if (token.startsWith('-') || request.url) httpError('Unsupported curl option or additional URL.', 'HTTP_UNSUPPORTED')
      else request.url = token
    }
    if (!method && body) request.method = 'POST'
    if (!request.url) httpError('A modeled Function App URL is required.')
    return { type: 'http-functions', intent: { kind: 'request', request } }
  } catch (error) { return { diagnostic: { code: error.httpCode ?? 'HTTP_CONFIG', message: error.message, path: 'function_app.py', line: 1, column: 1 } } }
}
