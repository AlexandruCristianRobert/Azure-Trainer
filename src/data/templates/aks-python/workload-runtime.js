export const WORKLOAD_RUNTIME_SOURCE = `"""Training-only adapter for declared local work. It does not measure CPU or allocate memory."""

def process_batch(units, scratch_mib):
    checksum = sum(index * 17 for index in range(units)) % 1000003
    return {"status": 200, "body": {"checksum": checksum, "units": units, "scratch_mib": scratch_mib}}
`
