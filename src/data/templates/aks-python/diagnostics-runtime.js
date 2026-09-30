// A readable Python adapter for the teaching files. The browser projects its
// bounded request context; it never launches this source or a Python process.
export const DIAGNOSTICS_RUNTIME_SOURCE = `from contextvars import ContextVar

_request_id = ContextVar("assistant_request_id", default=None)

def current_request_id():
    return _request_id.get()

def set_request_id(request_id):
    return _request_id.set(request_id)

def reset_request_id(token):
    _request_id.reset(token)
`
