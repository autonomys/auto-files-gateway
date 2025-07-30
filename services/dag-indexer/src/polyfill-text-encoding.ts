// This file is used to polyfill the globalThis object with the TextDecoder and TextEncoder
// objects from the util package. This is necessary because the SubQuery environment
// does not have these objects available.

global.TextEncoder = require('util').TextEncoder
global.TextDecoder = require('util').TextDecoder
global.Buffer = require('buffer/').Buffer
