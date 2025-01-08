import { config } from '../config.js'
import { logger } from './logger.js'
import { createWS, WS } from './ws/client.js'
import z from 'zod'

type SubstrateSubscription = {
  id: string
  callbacks: ((event: unknown) => void)[]
}

type SubstrateEventListenerState = {
  subscriptions: Record<string, SubstrateSubscription>
  ws: WS
}

export const createSubstrateEventListener = () => {
  const state: SubstrateEventListenerState = {
    subscriptions: {},
    ws: createWS(config.nodeRpcUrl),
  }

  const subscribe = async (
    subscribingEventName: string,
    callback: (event: unknown) => void,
  ) => {
    if (!state.subscriptions[subscribingEventName]) {
      const response = await state.ws.send({
        jsonrpc: '2.0',
        method: subscribingEventName,
        params: [],
      })

      const { data } = z
        .object({
          result: z.string(),
        })
        .safeParse(response)

      if (!data?.result) {
        logger.error(
          `Failed to subscribe to event ${subscribingEventName}. No result field in response.`,
        )
        throw new Error(
          `Failed to subscribe to event: ${JSON.stringify(response, null, 2)}`,
        )
      }

      logger.info(
        `Subscribed to event ${subscribingEventName} with id ${data.result}.`,
      )
      state.subscriptions[subscribingEventName] = {
        id: data.result,
        callbacks: [callback],
      }
    } else {
      state.subscriptions[subscribingEventName].callbacks.push(callback)
    }
  }

  state.ws.on((event) => {
    logger.debug(
      `Received event for method ${event.method} (${JSON.stringify(event.params)}).`,
    )

    const { data, success } = z
      .object({
        params: z.object({
          subscription: z.string(),
          result: z.unknown(),
        }),
      })
      .safeParse(event)

    if (!success) {
      logger.warn(
        `Received event for method ${event.method} but failed to parse.`,
      )
      return
    }

    const subscription = Object.values(state.subscriptions).find(
      (subscription) => subscription.id === data.params.subscription,
    )

    if (!subscription) {
      logger.debug(
        `Received event for method ${event.method} but no subscription found.`,
      )
      return
    }

    subscription.callbacks.forEach((callback) => callback(data.params.result))
  })

  return { subscribe }
}
