// This file is used to polyfill the globalThis object with the TextDecoder and TextEncoder
// objects from the util package. This is necessary because the SubQuery environment
// does not have these objects available.

import { TextDecoder, TextEncoder } from 'util'
import { Buffer } from 'buffer'
;(globalThis as any).Buffer = Buffer
;(globalThis as any).TextDecoder = TextDecoder
;(globalThis as any).TextEncoder = TextEncoder
;(globalThis as any).Uint8Array = Uint8Array
;(globalThis as any).ArrayBuffer = ArrayBuffer
global.console = logger
