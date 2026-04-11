export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const secret = process.env.CONTRACT_RENDERER_SECRET;
  if (secret && req.headers["x-renderer-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!req.body?.html) {
    return res.status(400).json({ error: "html obbligatorio" });
  }

  return res.status(501).json({
    error: "PDF renderer scaffold presente ma runtime headless non configurato in questo repo.",
    renderer_version: "contract-renderer-stub@phase0",
  });
}
