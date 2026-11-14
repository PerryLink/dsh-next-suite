import https from "node:https"

export function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      response.resume()
      response.on("end", () => resolve(response.statusCode ?? 0))
    })
    request.on("error", reject)
  })
}
