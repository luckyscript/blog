// Sequential iteration keeps transaction failures from leaving queued writes behind.
export async function mapAsync(items,fn) {
  const result=[]
  for (let i=0;i<items.length;i++) result.push(await fn(items[i],i))
  return result
}
