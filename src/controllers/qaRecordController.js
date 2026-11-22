// Thin HTTP adapter for the saved-QA API (PLAN F2/F3, steps 3 and 4) and
// the QA Shadow's review (PLAN F5, step 6): parse the request, delegate to
// the service, serialize the response. No business logic here (§4.5).
// requireAuth already ran in app.js (§6 step 6), so req.user is the
// session owner of the record; the Shadow routes also sit behind
// requireRole('qa_shadow') in the router.
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

    // F5: the Shadow's pending queue (D14), with the optional Task ID
    // search. The role guard already ran in the route.
    async listPending(req, res) {
      const records = await service.listPending({
        reviewerId: req.user?.id ?? null,
        taskId: req.query?.taskId,
      });
      res.json({ records });
    },

    // F5: the QAs this Shadow reviewed and closed (D14), searchable too.
    async listHistory(req, res) {
      const records = await service.listHistory({
        reviewerId: req.user?.id ?? null,
        taskId: req.query?.taskId,
      });
      res.json({ records });
    },

    // F5: claim a QA (D10). 409 already_taken when somebody else was first.
    async take(req, res) {
      const record = await service.takeQa({
        id: req.params.id,
        reviewerId: req.user?.id ?? null,
      });
      res.json({ record });
    },

    // F5: save the review in progress without closing it (D9 clears it if
    // the Shadow loses the role).
    async saveReview(req, res) {
      const record = await service.saveReview({
        id: req.params.id,
        reviewerId: req.user?.id ?? null,
        body: req.body,
      });
      res.json({ record });
    },

    // F5: close the QA with the generated status/comment (D7, D20, D21),
    // edited by the Shadow if they want to (D8).
    async closeReview(req, res) {
      const record = await service.closeReview({
        id: req.params.id,
        reviewerId: req.user?.id ?? null,
        body: req.body,
      });
      res.json({ record });
    },
  };
}
