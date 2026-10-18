"""Simplified production logic; investigate without modifying it."""
def cache_key(tenant_id, sku):
    return f"price:{sku}"

def quote(cache, catalog, tenant_id, sku, shared):
    cache_space = cache.shared if shared else cache.for_tenant(tenant_id)
    key = cache_key(tenant_id, sku)
    value = cache_space.get(key)
    if value is None:
        value = catalog.lookup(tenant_id, sku)
        cache_space.set(key, value, ttl_seconds=300)
    return value
