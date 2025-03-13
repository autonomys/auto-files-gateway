// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const groupBy = <T extends Record<string, any>, K extends keyof T>(
  array: T[],
  key: K,
) => {
  return array.reduce(
    (acc, item) => {
      acc[item[key]] = [...(acc[item[key]] || []), item]
      return acc
    },
    {} as Record<T[K], T[]>,
  )
}

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
