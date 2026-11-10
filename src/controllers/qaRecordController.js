// Thin HTTP adapter for the saved-QA API (PLAN F2 / SPEC step 3): parse the
// request, delegate to the service, serialize the response. No business
// logic here (§4.5). requireAuth already ran in app.js (§6 step 6), so
// req.user is the session owner of the record.
export function createQaRecordController({ service }) {
  return {
    async create(req, res) {
      const record = await service.createQaRecord({
        body: req.body,
        ownerId: req.user?.id ?? null,
      });
      res.status(201).json({ record });
    },
  };
}
