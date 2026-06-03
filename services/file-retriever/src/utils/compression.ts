/**
 * Detects whether a buffer begins with a valid zlib stream header.
 *
 * `@autonomys/auto-dag-data` compresses with fflate's `Zlib`, which produces a
 * proper zlib wrapper (RFC 1950): a 2-byte header (CMF + FLG) followed by a
 * deflate stream and an adler32 checksum. Some stored objects are flagged
 * `compression: ZLIB` in their metadata while their actual node bytes are
 * uncompressed (see autonomys/auto-files-gateway#169). Trusting the metadata
 * flag alone makes the gateway advertise `Content-Encoding: deflate` (or attempt
 * a server-side inflate) over plaintext, which corrupts the response.
 *
 * This validates the zlib header so callers can verify the bytes before
 * treating them as compressed:
 *  - CM (low nibble of CMF) must be 8 (the deflate compression method).
 *  - CINFO (high nibble of CMF) must be <= 7 (window size <= 32K).
 *  - The 16-bit value (CMF << 8 | FLG) must be a multiple of 31 (FCHECK).
 *
 * @param buffer - The leading bytes of the (claimed) compressed stream.
 * @returns true only if the bytes are a structurally valid zlib stream header.
 */
export const isZlibCompressed = (buffer: Buffer): boolean => {
  if (buffer.length < 2) {
    return false
  }

  const cmf = buffer[0]
  const flg = buffer[1]

  const compressionMethod = cmf & 0x0f
  const compressionInfo = cmf >> 4

  if (compressionMethod !== 8 || compressionInfo > 7) {
    return false
  }

  // FCHECK: the header is valid only when (CMF*256 + FLG) is a multiple of 31.
  return (((cmf << 8) | flg) & 0xffff) % 31 === 0
}
