// Bounded JSON request bodies (RT-12, docs/15 § Web hardening): read in chunks and stop at the cap, so an
// unauthenticated client can't make the server buffer a body of any size.
export const TOO_LARGE = Symbol("too large");
export const tooLarge = () => Response.json({ error: "Request body too large" }, { status: 413 });

/** The parsed JSON body; undefined when empty or malformed; TOO_LARGE (reading stopped) past `max` bytes. */
export async function readJson(req: Request, max = 64 * 1024): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > max) return TOO_LARGE;
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
