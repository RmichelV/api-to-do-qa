// Thin HTTP adapter for the saved-QA API (PLAN F2/F3, SPEC steps 3 and 4):
// parse the request, delegate to the service, serialize the response. No
// business logic here (§4.5). requireAuth already ran in app.js (§6 step 6),
// so req.user is the session owner of the record.
export function createQaRecordController({ service }) {
  return {
    async create(req, res) {
      const record = await service.createQaRecord({
        body: req.body,
        ownerId: req.user?.id ?? null,
      });
      res.status(201).json({ record });
    },

    // F3 "Mis QA": the session user's own records of the current month.
    async listMine(req, res) {
      const records = await service.listMine({ ownerId: req.user?.id ?? null });
      res.json({ records });
    },

    // F3: correct the Task ID of one of the user's own records.
    async patch(req, res) {
      const record = await service.updateTaskId({
        id: req.params.id,
        ownerId: req.user?.id ?? null,
        body: req.body,
      });
      res.json({ record });
    },
  };
}
