export const CLI_SERVER_AUTH_USERNAME = "kilo"

export function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}
