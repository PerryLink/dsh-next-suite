export async function checkEndpoint(url) {
  const response = await fetch(url)
  return response.status
}
