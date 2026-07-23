declare module 'heic-decode' {
  interface DecodedHeicImage {
    width: number
    height: number
    /** RGBA pixels, 4 bytes per pixel. */
    data: ArrayBuffer
  }
  function decode(input: { buffer: Buffer | Uint8Array }): Promise<DecodedHeicImage>
  export default decode
}
