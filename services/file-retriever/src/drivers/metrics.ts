import { config } from '../config'

interface Metric {
  measurement: string
  tag: string
  fields: Record<string, string | number | bigint>
  timestamp?: number
}

export const sendMetricToVictoria = async (metric: Metric): Promise<void> => {
  const data = `${metric.measurement},${metric.tag} ${Object.entries(
    metric.fields,
  )
    .map(([key, value]) => `${key}=${value}`)
    .join(',')} ${metric.timestamp}`

  const response = await fetch(config.monitoring.victoriaEndpoint, {
    method: 'POST',
    body: data,
    headers: config.monitoring.victoriaToken
      ? {
          Authorization: `Bearer ${config.monitoring.victoriaToken}`,
        }
      : {},
  })
  if (!response.ok) {
    throw new Error(`Failed to send metric to Victoria: ${response.statusText}`)
  }
}
