import { validateHttpRoutes } from './contracts.js'

// The shared parser owns lowering and analysis; this module owns only HTTP registration.
export function analyzeHttpHandlers({ program, definitions, infer, analyzeFunction, bindArguments, signatures, unsupported, location }) {
  const handlers = [], names = new Set()
  let app = null
  for (const [id, definition] of definitions) {
    if (!definition.decorators?.length) continue
    const env = definition.registrationEnv, at = location(definition.node, definition.path)
    const binding = { functionId: id, functionName: definition.name, path: definition.path, argName: 'req', output: null }
    let route = false, named = false
    for (const decorator of definition.decorators) {
      const target = infer(decorator.callee, env, definition.path)
      if (target.type !== 'callable' || !['functionapp.function_name', 'functionapp.route', 'functionapp.service_bus_queue_output'].includes(target.name)) unsupported('Only HTTP v2 decorators are supported by this host.', decorator.loc)
      if (app !== null && app !== target.registrationId) unsupported('All HTTP handlers must share one FunctionApp.', decorator.loc)
      app = target.registrationId
      const constant = node => {
        if (node.kind === 'list') return node.items.map(constant)
        const result = infer(node, env, definition.path)
        if (!Object.hasOwn(result, 'constant')) unsupported('HTTP decorators require resolved constants.', node.loc)
        return result.constant
      }
      const values = Object.fromEntries(Object.entries(decorator.kwargs).map(([key, node]) => [key, constant(node)]))
      const [parameters, required] = signatures[target.name]
      const args = bindArguments(parameters, required, [], values, decorator.loc)
      if (target.name === 'functionapp.function_name') {
        if (named) unsupported('Repeated function name.', decorator.loc)
        named = true; binding.functionName = args.name
      } else if (target.name === 'functionapp.route') {
        if (route) unsupported('Exactly one HTTP route is required.', decorator.loc)
        route = true
        Object.assign(binding, { route: args.route, methods: args.methods ?? ['GET', 'POST'], authLevel: args.auth_level ?? target.httpAuthLevel ?? 'function', argName: args.trigger_arg_name ?? 'req' })
      } else {
        if (binding.output) unsupported('Only one queue output is supported.', decorator.loc)
        if (Object.values(args).some(value => typeof value !== 'string' || !value)) unsupported('Output bindings require nonempty strings.', decorator.loc)
        binding.output = { argName: args.arg_name, queueName: args.queue_name, connection: args.connection }
      }
    }
    if (!route || typeof binding.functionName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(binding.functionName) || names.has(binding.functionName.toLowerCase())) unsupported('Missing route or duplicate/invalid Function name.', at)
    names.add(binding.functionName.toLowerCase())
    analyzeFunction(id, [{ type: 'httprequest' }, ...(binding.output ? [{ type: 'httpout' }] : [])], {}, at)
    const fn = program.functions[id]
    if (fn.params[0] !== binding.argName || fn.annotations[binding.argName]?.type !== 'httprequestType'
      || fn.params.length !== (binding.output ? 2 : 1) || binding.output && (fn.params[1] !== binding.output.argName || fn.annotations[binding.output.argName]?.type !== 'httpoutstrType')
      || fn.returnType?.name !== 'HttpResponse') unsupported('HTTP request, response and optional Out[str] annotations must match registration.', fn.loc)
    handlers.push(binding)
  }
  if (!handlers.length) unsupported('The HTTP entry must register a route.')
  if (!validateHttpRoutes(handlers.map(({ route, methods, authLevel, functionId, functionName, path }) => ({ route, methods, authLevel, functionId, functionName, path })))) unsupported('Invalid, overlapping or excessive HTTP routes.')
  program.httpHandlers = handlers
}
