/// <reference types="@solidjs/start/env" />

export declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
}

// kilocode_change start
declare module "solid-js/web" {
  interface RequestEvent {
    locals: Record<string | number | symbol, any>
  }
}
// kilocode_change end
