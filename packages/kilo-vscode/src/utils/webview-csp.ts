export interface WebviewCspInput {
  cspSource: string
  nonce: string
}

export function buildWebviewCsp(input: WebviewCspInput): string {
  return [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${input.cspSource}`,
    `script-src 'nonce-${input.nonce}' 'wasm-unsafe-eval'`,
    `font-src ${input.cspSource}`,
    `connect-src ${input.cspSource}`,
    `img-src ${input.cspSource} data: blob:`,
  ].join("; ")
}
