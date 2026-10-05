import { HTTP_PROFILE } from './contracts.js'
import { SDK_SIGNATURES, SDK_EXPORTS } from '../messaging/python.js'
export { HTTP_PROFILE }
export const HTTP_SIGNATURES = Object.freeze({
  FunctionApp: [['http_auth_level'], 0, 'functionapp'],
  HttpResponse: [['body', 'status_code', 'headers', 'mimetype'], 1, 'httpresponse'],
  OrderStatusRepository: [[], 0, 'orderrepository'],
  'orderrepository.get': [['order_id'], 1, 'orderrecord'],
  'os.getenv': [['key', 'default'], 1, 'data'],
  'functionapp.route': [['route', 'methods', 'auth_level', 'trigger_arg_name'], 1, 'data'],
  'functionapp.service_bus_queue_output': [['arg_name', 'queue_name', 'connection'], 3, 'data'],
  'httprequest.get_json': [[], 0, 'data'], 'httprequest.get_body': [[], 0, 'bytes'],
  'httpout.set': [['value'], 1, 'data'], 'data.get': [['key', 'default'], 1, 'data'],
  isinstance: [['object', 'classinfo'], 2, 'data'],
})
// Resolve the base lazily: the parser imports this extension during module setup.
export function httpSdkContract(profile, base = { signatures: SDK_SIGNATURES, exports: SDK_EXPORTS }) {
  return profile !== HTTP_PROFILE ? base : { signatures: { ...base.signatures, ...HTTP_SIGNATURES },
    exports: { ...base.exports, 'azure.functions': [...base.exports['azure.functions'], 'HttpRequest', 'HttpResponse', 'AuthLevel', 'Out'],
      order_store: ['OrderStatusRepository'], os: ['getenv'] } }
}
export function httpImport(module, name) {
  if (module === 'azure.functions') {
    const type = { HttpRequest: 'httprequestType', Out: 'httpoutType', AuthLevel: 'httpauth' }[name]
    if (type) return { type }
    if (name === 'HttpResponse') return { type: 'callable', name }
  }
  if (module === 'os' && name === 'getenv') return { type: 'callable', name: 'os.getenv' }
  return null
}
export function httpMember(type, name) {
  if (type === 'httpauth' && ['ANONYMOUS', 'FUNCTION'].includes(name)) return { type: 'data', constant: name.toLowerCase() }
  if (type === 'httprequest' && ['method', 'url', 'params', 'route_params', 'headers'].includes(name)) return { type: 'data' }
  if (type === 'orderrecord' && ['id', 'region', 'quantity', 'status'].includes(name)) return { type: 'data' }
  return null
}
