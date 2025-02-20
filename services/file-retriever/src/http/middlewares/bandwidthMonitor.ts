import { NextFunction, Request, Response } from 'express'
import { sendMetricToVictoria } from '../../drivers/metrics.js'
import { logger } from '../../drivers/logger.js'
import { config } from '../../config.js'

export const bandwidthTracker = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestReceivedAt = Date.now()
  res.on('finish', () => {
    const contentLengthHeader = res.getHeader('Content-Length')
    const invalidOrMissingContentLength =
      !contentLengthHeader ||
      (typeof contentLengthHeader !== 'string' &&
        typeof contentLengthHeader !== 'number')
    if (invalidOrMissingContentLength) {
      return
    }
    const isGateway = res.getHeader('x-file-origin') === 'gateway'
    const contentLength = BigInt(contentLengthHeader)
    const requestDuration = Date.now() - requestReceivedAt

    const measurement = isGateway ? 'gateway_bandwidth' : 'cache_bandwidth'
    const tag = config.monitoring.metricEnvironmentTag

    // Ignore errors sending metrics to Victoria
    sendMetricToVictoria({
      measurement,
      tag,
      fields: {
        bytes: contentLength,
        duration: requestDuration,
      },
    }).catch((error) => {
      logger.warn(`Failed to send metric to Victoria: ${error}`)
    })
  })

  next()
}
