declare module "tar-fs" {
  import { Writable } from "node:stream"

  export interface ExtractOptions {
    strip?: number
  }

  export function extract(cwd: string, options?: ExtractOptions): Writable
}
