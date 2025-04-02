// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const values = <T extends Record<string, any>>(
  obj: Record<string, T>,
): T[] => {
  return Object.values(obj)
}

export const promiseAll = async <T>(array: T[]) => {
  return await Promise.all(array)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fromEntries = <K extends PropertyKey, T extends [K, any]>(
  array: T[],
) => {
  return Object.fromEntries(array) as Record<K, T[1]>
}
