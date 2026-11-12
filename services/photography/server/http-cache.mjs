// If-None-Match uses weak comparison for GET/HEAD revalidation.
export function matchesEntityTag(value,etag) {
  if(typeof value!=='string'||!etag)return false
  const normalized=etag.replace(/^W\//,'')
  return value.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===normalized)
}
